import { ChemfigError, resolveLimits } from './error.js';
import type {
  AtomLabel,
  BondOptions,
  BondSyntax,
  ChainSyntax,
  LayoutAtom,
  LayoutBond,
  LayoutRing,
  LayoutRun,
  MoleculeLayout,
  MoleculeSyntax,
  Point,
  RenderOptions,
  RingSyntax,
} from './types.js';

export interface ResolvedRenderOptions {
  bondLength: number;
  fontSize: number;
  strokeWidth: number;
  bondSpacing: number;
  padding: number;
}

export function resolveRenderOptions(options: RenderOptions = {}): ResolvedRenderOptions {
  const result = {
    bondLength: options.bondLength ?? 42,
    fontSize: options.fontSize ?? 17,
    strokeWidth: options.strokeWidth ?? 1.5,
    bondSpacing: options.bondSpacing ?? 4,
    padding: options.padding ?? 12,
  };
  for (const [key, value] of Object.entries(result)) {
    const min = key === 'padding' ? 0 : 0.1;
    if (!Number.isFinite(value) || value < min || value > 500) {
      throw new ChemfigError('OPTIONS', `${key} must be a finite number from ${min} to 500`, '', 0);
    }
  }
  return result;
}

const rad = (angle: number) => (angle * Math.PI) / 180;
const normalAngle = (angle: number) => ((angle % 360) + 360) % 360;
const forward = (angle: number) => {
  const a = normalAngle(angle);
  return a < 90 || a > 270;
};
const move = (p: Point, angle: number, length: number): Point => ({
  x: p.x + Math.cos(rad(angle)) * length,
  y: p.y - Math.sin(rad(angle)) * length,
});

interface State {
  current: LayoutAtom;
  previousAngle: number;
  hasIncoming: boolean;
  defaults: BondOptions & { angle: { mode: 'absolute'; degrees: number }; length: number };
  ring?: { turn: number; nextAngle: number; center: Point };
}

/** Deterministic, DOM-free layout. Text widths are estimates, not TeX font metrics. */
export function layoutChemfig(syntax: MoleculeSyntax, options: RenderOptions = {}): MoleculeLayout {
  return new Layout(syntax, options).build();
}

class Layout {
  private atoms: LayoutAtom[] = [];
  private bonds: LayoutBond[] = [];
  private rings: LayoutRing[] = [];
  private hooks = new Map<string, { atom: LayoutAtom; count: number; offset: number }>();
  private config;
  private limits;

  constructor(
    private syntax: MoleculeSyntax,
    options: RenderOptions,
  ) {
    this.config = resolveRenderOptions(options);
    this.limits = resolveLimits(options.limits);
  }

  build(): MoleculeLayout {
    const first = this.atom(this.syntax.chain.initial, { x: 0, y: 0 }, 1);
    const defaults: State['defaults'] = { angle: { mode: 'absolute', degrees: 0 }, length: 1 };
    this.chain(
      this.syntax.chain,
      { current: first, previousAngle: 0, hasIncoming: false, defaults },
      0,
    );
    for (const [name, hook] of this.hooks) {
      if (hook.count === 1)
        this.fail(`Hook ${JSON.stringify(name)} has no matching occurrence`, hook.offset);
    }
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const atom of this.atoms) {
      left = Math.min(left, atom.bounds.left);
      right = Math.max(right, atom.bounds.right);
      top = Math.min(top, atom.bounds.top);
      bottom = Math.max(bottom, atom.bounds.bottom);
    }
    for (const ring of this.rings) {
      if (!ring.aromatic) continue;
      left = Math.min(left, ring.center.x - ring.radius);
      right = Math.max(right, ring.center.x + ring.radius);
      top = Math.min(top, ring.center.y - ring.radius);
      bottom = Math.max(bottom, ring.center.y + ring.radius);
    }
    // Room for multiple-bond offsets, wedge bases and antialiased strokes even at zero padding.
    const margin =
      this.config.padding + Math.max(this.config.bondSpacing * 2, this.config.strokeWidth, 5);
    const width = Math.max(1, right - left + 2 * margin);
    const height = Math.max(1, bottom - top + 2 * margin);
    return {
      atoms: this.atoms,
      bonds: this.bonds,
      rings: this.rings,
      width,
      height,
      viewBox: [left - margin, top - margin, width, height],
    };
  }

  private chain(chain: ChainSyntax, incoming: State, depth: number) {
    if (depth > this.limits.maxDepth)
      this.fail('Layout nesting limit exceeded', chain.start, 'LIMIT');
    const defaults = this.defaults(incoming, chain.defaults);
    const state: State = { ...incoming, defaults };
    if (!state.hasIncoming || chain.explicitDefaults || chain.defaults.angle)
      state.previousAngle = defaults.angle.degrees;
    for (const item of chain.items) {
      if (item.type === 'bond') {
        const angle = item.options.angle
          ? item.options.angle.degrees +
            (item.options.angle.mode === 'relative' ? state.previousAngle : 0)
          : state.defaults.angle.degrees;
        this.bond(item, state, angle);
      } else if (item.type === 'branch') {
        const branchDefaults = state.ring
          ? {
              ...state.defaults,
              angle: {
                mode: 'absolute' as const,
                degrees: state.ring.nextAngle - 90 - state.ring.turn / 2,
              },
            }
          : state.defaults;
        // No ring context inside a branch: only its initial default is the outward bisector.
        this.chain(
          item.chain,
          {
            current: state.current,
            previousAngle: state.previousAngle,
            hasIncoming: state.hasIncoming,
            defaults: branchDefaults,
          },
          depth + 1,
        );
      } else if (item.type === 'ring') {
        this.ring(item, state, depth + 1);
      } else {
        if (state.current.anchors.length !== 1)
          this.fail(
            'Hooks on multi-atom labels are not supported; group the label in braces',
            item.start,
            'UNSUPPORTED',
          );
        const hook = this.hooks.get(item.name);
        if (!hook) this.hooks.set(item.name, { atom: state.current, count: 1, offset: item.start });
        else {
          if (hook.atom.id === state.current.id)
            this.fail('A hook cannot connect an atom to itself', item.start);
          this.addBond({
            from: state.current.id,
            to: hook.atom.id,
            departure: 1,
            arrival: 1,
            kind: item.kind,
            invisible: false,
          });
          hook.count++;
        }
      }
    }
  }

  private defaults(state: State, overrides: BondOptions): State['defaults'] {
    const degrees = overrides.angle
      ? overrides.angle.degrees + (overrides.angle.mode === 'relative' ? state.previousAngle : 0)
      : state.defaults.angle.degrees;
    return {
      ...state.defaults,
      ...overrides,
      angle: { mode: 'absolute', degrees },
      length: overrides.length ?? state.defaults.length,
    };
  }

  private bond(
    item: BondSyntax,
    state: State,
    angle: number,
    ring?: { size: number; close?: LayoutAtom; closeArrival?: number },
  ) {
    const opts = { ...state.defaults, ...item.options };
    const departure = opts.departure ?? (forward(angle) ? state.current.anchors.length : 1);
    const from = this.anchor(state.current, departure, item.start);
    const arrival =
      ring?.closeArrival ?? opts.arrival ?? (forward(angle) ? 1 : item.label.atoms.length);
    const to =
      ring?.close ??
      this.atom(
        item.label,
        move(from, angle, this.config.bondLength * opts.length),
        arrival,
        !!ring,
        item.start,
      );
    this.anchor(to, arrival, item.start);
    this.addBond({
      from: state.current.id,
      to: to.id,
      departure,
      arrival,
      kind: item.kind,
      ...(item.shift ? { shift: item.shift } : ring && item.kind === '=' ? { shift: 'left' } : {}),
      invisible: opts.invisible ?? false,
      ...(ring ? { ringSize: ring.size } : {}),
    });
    state.current = to;
    state.previousAngle = normalAngle(angle);
    state.hasIncoming = true;
  }

  private ring(item: RingSyntax, outer: State, depth: number) {
    const turn = 360 / item.size;
    const firstAngle = outer.ring
      ? // A fused ring's closing side coincides with the enclosing ring's next side.
        outer.ring.nextAngle - 180 + turn
      : outer.hasIncoming
        ? outer.previousAngle - 90 + turn / 2
        : outer.defaults.angle.degrees - 90 + turn;
    const length = this.config.bondLength * outer.defaults.length;
    // Chemfig saves the attachment subatom before entering the ring. The closing
    // bond returns to that exact anchor, not an anchor selected by its direction.
    const attachmentAngle = outer.hasIncoming ? outer.previousAngle : outer.defaults.angle.degrees;
    const departure =
      outer.defaults.departure ?? (forward(attachmentAngle) ? outer.current.anchors.length : 1);
    const startPoint = this.anchor(outer.current, departure, item.start);
    const center = move(
      startPoint,
      firstAngle + 90 - turn / 2,
      length / (2 * Math.sin(rad(turn / 2))),
    );
    this.rings.push({
      center,
      radius: (length / (2 * Math.tan(rad(turn / 2)))) * 0.75,
      aromatic: item.aromatic,
    });
    const state: State = {
      ...outer,
      hasIncoming: true,
      previousAngle: outer.hasIncoming ? outer.previousAngle : firstAngle - turn,
      ring: { turn, nextAngle: firstAngle, center },
    };
    let edge = 0;
    for (const child of item.chain.items) {
      if (child.type === 'bond') {
        const angle = firstAngle + edge * turn;
        edge++;
        this.bond(child, state, angle, {
          size: item.size,
          ...(edge === item.size ? { close: outer.current, closeArrival: departure } : {}),
        });
        state.ring = { turn, nextAngle: angle + turn, center };
      } else {
        this.chain(
          { ...item.chain, defaults: {}, explicitDefaults: false, items: [child] },
          state,
          depth,
        );
      }
    }
  }

  private atom(
    label: AtomLabel,
    point: Point,
    reference: number,
    reuse = false,
    offset = 0,
  ): LayoutAtom {
    const measured = measureLabel(label, this.config.fontSize);
    if (!measured.anchors[reference - 1])
      this.fail(
        `Arrival atom index ${reference} does not exist in label ${JSON.stringify(label.source)}`,
        offset,
      );
    const dx = point.x - measured.anchors[reference - 1]!.x;
    const dy = point.y;
    if (
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      Math.abs(dx) > 10_000_000 ||
      Math.abs(dy) > 10_000_000
    )
      this.fail('Molecule coordinates exceed the geometry limit', 0, 'LIMIT');
    if (reuse) {
      const existing = this.atoms.find(
        (a) =>
          a.anchors.length === 1 &&
          label.atoms.length === 1 &&
          Math.hypot(a.x - dx, a.y - dy) < 0.001 &&
          a.label.source === label.source,
      );
      if (existing) return existing;
    }
    if (this.atoms.length >= this.limits.maxAtoms)
      this.fail('Atom group limit exceeded', 0, 'LIMIT');
    const atom: LayoutAtom = {
      id: this.atoms.length,
      label,
      x: dx,
      y: dy,
      anchors: measured.anchors.map((a) => ({ x: a.x + dx, y: a.y + dy })),
      runs: measured.runs.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
      bounds: {
        left: measured.left + dx,
        right: measured.right + dx,
        top: measured.top + dy,
        bottom: measured.bottom + dy,
      },
    };
    this.atoms.push(atom);
    return atom;
  }

  private anchor(atom: LayoutAtom, index: number, offset: number): Point {
    const anchor = atom.anchors[index - 1];
    if (!anchor)
      this.fail(
        `Atom index ${index} does not exist in label ${JSON.stringify(atom.label.source)}`,
        offset,
      );
    return anchor;
  }

  private addBond(bond: LayoutBond) {
    if (this.bonds.length >= this.limits.maxBonds) this.fail('Bond limit exceeded', 0, 'LIMIT');
    this.bonds.push(bond);
  }
  private fail(
    message: string,
    offset: number,
    code: 'GEOMETRY' | 'LIMIT' | 'UNSUPPORTED' = 'GEOMETRY',
  ): never {
    throw new ChemfigError(code, message, this.syntax.source, offset);
  }
}

function glyphWidth(text: string, size: number): number {
  let width = 0;
  for (const ch of text) {
    const factor = /[ilI1′.,]/.test(ch)
      ? 0.29
      : /[MW⊕⊖]/.test(ch)
        ? 0.85
        : /[a-z]/.test(ch)
          ? 0.52
          : /[()]/.test(ch)
            ? 0.36
            : 0.66;
    width += size * factor;
  }
  return width;
}

function measureLabel(label: AtomLabel, fontSize: number) {
  const runs: LayoutRun[] = [];
  const anchors: Point[] = [];
  let cursor = 0,
    top = 0,
    bottom = 0;
  for (const atom of label.atoms) {
    const start = cursor;
    let lastScript: 'sub' | 'super' | undefined;
    let scriptStart = 0,
      subEnd = 0,
      superEnd = 0;
    for (const run of atom) {
      const size = run.script === 'normal' ? fontSize : fontSize * 0.7;
      const width = glyphWidth(run.text, size);
      if (run.script === 'normal') {
        lastScript = undefined;
      } else {
        if (!lastScript) {
          scriptStart = cursor;
          subEnd = cursor;
          superEnd = cursor;
        }
        cursor = run.script === 'sub' ? subEnd : superEnd;
      }
      const baseline =
        fontSize * 0.35 +
        (run.script === 'sub' ? fontSize * 0.27 : run.script === 'super' ? -fontSize * 0.45 : 0);
      runs.push({ ...run, x: cursor, y: baseline, width, fontSize: size });
      top = Math.min(top, baseline - size * 0.85);
      bottom = Math.max(bottom, baseline + size * 0.22);
      cursor += width;
      if (run.script !== 'normal') {
        if (run.script === 'sub') subEnd = cursor;
        else superEnd = cursor;
        lastScript = run.script;
        cursor = Math.max(scriptStart, subEnd, superEnd);
      }
    }
    anchors.push({ x: (start + cursor) / 2, y: 0 });
  }
  // Anchor the first typographic atom at the origin.
  const offset = anchors[0]?.x ?? 0;
  for (const anchor of anchors) anchor.x -= offset;
  for (const run of runs) run.x -= offset;
  return { anchors, runs, left: -offset, right: cursor - offset, top, bottom };
}
