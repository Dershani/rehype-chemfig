import { toHtml } from 'hast-util-to-html';
import type { Element, ElementContent, Properties } from 'hast';
import { layoutChemfig, resolveRenderOptions } from './layout.js';
import { parseChemfig } from './parser.js';
import type { LayoutAtom, MoleculeLayout, Point, RenderOptions, RenderResult } from './types.js';

const round = (value: number) => String(Number(value.toFixed(3)));
const el = (
  tagName: string,
  properties: Properties = {},
  children: ElementContent[] = [],
): Element => ({ type: 'element', tagName, properties, children });
const text = (value: string): ElementContent => ({ type: 'text', value });

export function renderChemfig(source: string, options: RenderOptions = {}): RenderResult {
  const syntax = parseChemfig(source, options);
  const layout = layoutChemfig(syntax, options);
  const tree = layoutToSvg(layout, options.title ?? `Chemfig structure: ${source}`, options);
  // HTML permits literal < inside quoted attributes, XML SVG does not.
  // The trusted serializer already escapes quotes and ampersands.
  const svg = toHtml(tree, { space: 'svg' }).replace(/="[^"]*"/g, (attr) =>
    attr.replace(/</g, '&#x3C;'),
  );
  return { syntax, layout, tree, svg };
}

/** Render an existing layout to a real HAST SVG element. No HTML is parsed or injected. */
export function layoutToSvg(
  layout: MoleculeLayout,
  title: string,
  options: RenderOptions = {},
): Element {
  const config = resolveRenderOptions(options);
  const paths: ElementContent[] = [];
  const line = (a: Point, b: Point) =>
    el('line', { x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y) });
  for (const bond of layout.bonds) {
    if (bond.invisible) continue;
    const from = layout.atoms[bond.from]!;
    const to = layout.atoms[bond.to]!;
    const a0 = from.anchors[bond.departure - 1]!;
    const b0 = to.anchors[bond.arrival - 1]!;
    const length = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    if (length < 0.001) continue;
    const u = { x: (b0.x - a0.x) / length, y: (b0.y - a0.y) / length };
    const normal = { x: u.y, y: -u.x };
    const t1 = trim(from, a0, u);
    const t2 = trim(to, b0, { x: -u.x, y: -u.y });
    if (t1 + t2 >= length - 0.2) continue;
    const a = { x: a0.x + u.x * t1, y: a0.y + u.y * t1 };
    const b = { x: b0.x - u.x * t2, y: b0.y - u.y * t2 };
    const shifted = (distance: number, shorten = 0) =>
      line(
        {
          x: a.x + normal.x * distance + u.x * shorten,
          y: a.y + normal.y * distance + u.y * shorten,
        },
        {
          x: b.x + normal.x * distance - u.x * shorten,
          y: b.y + normal.y * distance - u.y * shorten,
        },
      );
    const marks: ElementContent[] = [];
    if (bond.kind === '-') marks.push(line(a, b));
    else if (bond.kind === '=') {
      if (bond.shift) {
        marks.push(line(a, b));
        const shorten = Math.min(
          (length - t1 - t2) * 0.2,
          config.bondSpacing * (bond.ringSize ? Math.tan(Math.PI / bond.ringSize) : 0.7),
        );
        marks.push(shifted(config.bondSpacing * (bond.shift === 'left' ? 1 : -1), shorten));
      } else marks.push(shifted(config.bondSpacing / 2), shifted(-config.bondSpacing / 2));
    } else if (bond.kind === '~') {
      marks.push(line(a, b), shifted(config.bondSpacing), shifted(-config.bondSpacing));
    } else {
      const wideAtStart = bond.kind.startsWith('>');
      const half = Math.max(config.bondSpacing, 3.5);
      if (bond.kind.endsWith(':')) {
        const count = Math.max(3, Math.min(12, Math.ceil((length - t1 - t2) / 4)));
        for (let i = 0; i <= count; i++) {
          const t = i / count;
          const width = half * (wideAtStart ? 1 - t : t);
          if (width < 0.3) continue;
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          marks.push(
            line(
              { x: p.x + normal.x * width, y: p.y + normal.y * width },
              { x: p.x - normal.x * width, y: p.y - normal.y * width },
            ),
          );
        }
      } else {
        const wide = wideAtStart ? a : b;
        const tip = wideAtStart ? b : a;
        marks.push(
          el('polygon', {
            points: `${round(wide.x + normal.x * half)},${round(wide.y + normal.y * half)} ${round(wide.x - normal.x * half)},${round(wide.y - normal.y * half)} ${round(tip.x)},${round(tip.y)}`,
            fill: bond.kind.endsWith('|') ? 'none' : 'currentColor',
            strokeWidth: String(bond.kind.endsWith('|') ? config.strokeWidth : 0),
          }),
        );
      }
    }
    paths.push(el('g', { className: ['chemfig-bond'], 'data-bond': bond.kind }, marks));
  }
  for (const ring of layout.rings) {
    if (ring.aromatic)
      paths.push(
        el('circle', {
          cx: round(ring.center.x),
          cy: round(ring.center.y),
          r: round(ring.radius),
          className: ['chemfig-aromatic'],
        }),
      );
  }
  const labels = layout.atoms
    .filter((a) => a.runs.length)
    .map((atom) =>
      el(
        'text',
        { className: ['chemfig-atom'], 'data-atom': atom.id },
        atom.runs.map((run) =>
          el(
            'tspan',
            {
              x: round(run.x),
              y: round(run.y),
              fontSize: round(run.fontSize),
              ...(run.script !== 'normal' ? { 'data-script': run.script } : {}),
            },
            [text(run.text)],
          ),
        ),
      ),
    );
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      role: 'img',
      ariaLabel: title,
      viewBox: layout.viewBox.map(round).join(' '),
      width: round(layout.width),
      height: round(layout.height),
      className: ['chemfig-svg'],
      focusable: 'false',
    },
    [
      el('title', {}, [text(title)]),
      el(
        'g',
        {
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: String(config.strokeWidth),
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          ariaHidden: 'true',
        },
        paths,
      ),
      el(
        'g',
        {
          fill: 'currentColor',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: String(config.fontSize),
          ariaHidden: 'true',
        },
        labels,
      ),
    ],
  );
}

function trim(atom: LayoutAtom, p: Point, direction: Point): number {
  if (!atom.runs.length) return 0;
  const b = atom.bounds;
  const tx =
    Math.abs(direction.x) > 1e-9
      ? ((direction.x > 0 ? b.right : b.left) - p.x) / direction.x
      : Infinity;
  const ty =
    Math.abs(direction.y) > 1e-9
      ? ((direction.y > 0 ? b.bottom : b.top) - p.y) / direction.y
      : Infinity;
  return Math.max(0, Math.min(tx, ty)) + 3;
}
