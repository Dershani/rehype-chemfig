import { ChemfigError, resolveLimits } from './error.js';
import type {
  Angle,
  AtomLabel,
  BondKind,
  BondOptions,
  ChainSyntax,
  LabelRun,
  MoleculeSyntax,
  ParseOptions,
} from './types.js';

const BONDS = new Set(['-', '=', '~', '>', '<']);
const EMPTY_LABEL = (): AtomLabel => ({ source: '', atoms: [[]] });
const SYMBOLS: Record<string, string> = {
  oplus: '⊕',
  ominus: '⊖',
  cdot: '·',
  bullet: '•',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  Delta: 'Δ',
  pi: 'π',
  prime: '′',
  circ: '°',
  pm: '±',
  times: '×',
};
// Avoid argument spreading: a valid label can exceed the engine's argument limit.
function appendRuns(target: LabelRun[], runs: LabelRun[]) {
  for (const run of runs) target.push(run);
}

/** Parse Chemfig's drawing syntax, not TeX or a chemically validated molecule. */
export function parseChemfig(source: string, options: ParseOptions = {}): MoleculeSyntax {
  if (typeof source !== 'string') throw new TypeError('Chemfig source must be a string');
  return new Parser(source, options).parse();
}

class Parser {
  private pos = 0;
  private bondCount = 0;
  private hookNames = new Set<string>();
  private limits;

  constructor(
    private source: string,
    options: ParseOptions,
  ) {
    this.limits = resolveLimits(options.limits);
    if (source.length > this.limits.maxLength)
      this.fail('LIMIT', `Source exceeds ${this.limits.maxLength} characters`, 0);
    // Reject control characters and lone surrogates before emitting XML-safe SVG.
    // oxlint-disable-next-line no-control-regex
    const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF\uFFFE\uFFFF]/u.exec(
      source,
    );
    if (control)
      this.fail(
        'SYNTAX',
        'Control characters and invalid Unicode are not supported',
        control.index,
      );
  }

  parse(): MoleculeSyntax {
    this.space();
    let wrapped = false;
    if (
      this.source.startsWith('\\chemfig', this.pos) &&
      !/[a-zA-Z]/.test(this.source[this.pos + 8] ?? '')
    ) {
      this.pos += 8;
      this.space();
      if (this.peek() === '[')
        this.fail('UNSUPPORTED', 'TeX \\chemfig settings are not supported; use renderer options');
      if (this.peek() !== '{') this.fail('SYNTAX', 'Expected { after \\chemfig');
      this.pos++;
      wrapped = true;
    }
    const chain = this.chain(wrapped ? '}' : '', 0, false);
    if (wrapped) this.pos++;
    this.space();
    if (this.pos !== this.source.length)
      this.fail('SYNTAX', 'Unexpected content after the molecule');
    if (!chain.initial.source && chain.items.length === 0)
      this.fail('SYNTAX', 'The molecule is empty', chain.start);
    this.countAtoms(chain, 1);
    return { type: 'chemfig', source: this.source, chain };
  }

  private chain(stop: string, depth: number, attached: boolean): ChainSyntax {
    this.depth(depth);
    this.space();
    const start = this.pos;
    const explicitDefaults = this.peek() === '[';
    const defaults = explicitDefaults ? this.options() : {};
    const initial = this.label(depth);
    if (attached && initial.source)
      this.fail('SYNTAX', 'A branch or ring must begin with a bond, branch, or ring', start);
    const items: ChainSyntax['items'] = [];
    while (true) {
      this.space();
      const ch = this.peek();
      if (!ch || (stop && ch === stop)) break;
      const itemStart = this.pos;
      if (BONDS.has(ch)) {
        const kind = this.bondKind();
        let shift: 'left' | 'right' | undefined;
        if (kind === '=' && (this.peek() === '^' || this.peek() === '_')) {
          shift = this.peek() === '^' ? 'left' : 'right';
          this.pos++;
        }
        this.space();
        const options = this.peek() === '[' ? this.options() : {};
        const label = this.label(depth);
        this.countBond();
        items.push({
          type: 'bond',
          kind,
          ...(shift ? { shift } : {}),
          options,
          label,
          start: itemStart,
          end: this.pos,
        });
      } else if (ch === '(') {
        this.pos++;
        const chain = this.chain(')', depth + 1, true);
        if (!chain.items.length) this.fail('SYNTAX', 'A branch cannot be empty', itemStart);
        if (this.peek() !== ')') this.fail('SYNTAX', 'Unclosed branch; expected )', itemStart);
        this.pos++;
        items.push({ type: 'branch', chain, start: itemStart, end: this.pos });
      } else if (ch === '*') {
        this.pos++;
        const aromatic = this.peek() === '*';
        if (aromatic) this.pos++;
        this.space();
        if (this.peek() === '[') this.fail('UNSUPPORTED', 'Aromatic arc options are not supported');
        const match = /^\d+/.exec(this.source.slice(this.pos));
        if (!match) this.fail('SYNTAX', 'Expected a ring size after *');
        const size = Number(match[0]);
        if (size < 3 || size > 24) this.fail('LIMIT', 'Ring size must be from 3 to 24');
        this.pos += match[0].length;
        this.space();
        if (this.peek() !== '(') this.fail('SYNTAX', 'Expected ( after the ring size');
        this.pos++;
        const chain = this.chain(')', depth + 1, true);
        if (this.peek() !== ')') this.fail('SYNTAX', 'Unclosed ring; expected )', itemStart);
        this.pos++;
        const edges = chain.items.filter((item) => item.type === 'bond');
        if (!edges.length) this.fail('SYNTAX', 'A ring needs at least one bond', itemStart);
        if (edges.length > size)
          this.fail(
            'SYNTAX',
            `A ${size}-ring cannot contain ${edges.length} perimeter bonds`,
            itemStart,
          );
        if (aromatic && edges.length !== size)
          this.fail('UNSUPPORTED', 'An aromatic ring must have a complete perimeter', itemStart);
        if (chain.explicitDefaults)
          this.fail(
            'UNSUPPORTED',
            'Defaults inside ring parentheses are not supported',
            chain.start,
          );
        for (const edge of edges) {
          if (edge.options.angle || edge.options.length !== undefined)
            this.fail(
              'UNSUPPORTED',
              'Perimeter angles and lengths are fixed by the regular ring',
              edge.start,
            );
        }
        if (edges.length === size && edges.at(-1)!.label.source)
          this.fail(
            'SYNTAX',
            'The closing ring bond must not introduce a new label',
            edges.at(-1)!.start,
          );
        items.push({ type: 'ring', size, aromatic, chain, start: itemStart, end: this.pos });
      } else if (ch === '?') {
        this.pos++;
        let name = 'a';
        let kind: BondKind = '-';
        if (this.peek() === '[') {
          const fields = this.fields();
          name = fields[0] || 'a';
          if (!/^[a-zA-Z0-9]+$/.test(name))
            this.fail('SYNTAX', 'Hook names must be alphanumeric', itemStart);
          if (fields[1]) {
            const token = fields[1].replace(/^\{(.*)\}$/, '$1');
            const kinds: BondKind[] = ['-', '=', '~', '>', '<', '>:', '<:', '>|', '<|'];
            const value = /^\d$/.test(token)
              ? kinds[Number(token) - 1]
              : kinds.find((k) => k === token);
            if (!value) this.fail('SYNTAX', 'Invalid distant bond type', itemStart);
            kind = value;
          }
          if (fields.slice(2).some(Boolean))
            this.fail('UNSUPPORTED', 'TikZ hook styles are not supported', itemStart);
        }
        if (this.hookNames.has(name)) this.countBond();
        else this.hookNames.add(name);
        items.push({ type: 'hook', name, kind, start: itemStart, end: this.pos });
      } else if ('!@#'.includes(ch)) {
        this.fail(
          'UNSUPPORTED',
          { '!': 'Submolecule aliases', '@': 'TikZ node references', '#': 'Per-bond shortening' }[
            ch
          ]! + ' are not supported',
        );
      } else {
        this.fail(
          'SYNTAX',
          `Unexpected ${JSON.stringify(ch)}; expected a bond, branch, ring, or hook`,
        );
      }
    }
    if (stop && this.peek() !== stop)
      this.fail('SYNTAX', `Unclosed group; expected ${stop}`, start);
    return {
      start,
      end: this.pos,
      defaults,
      ...(explicitDefaults ? { explicitDefaults: true } : {}),
      initial,
      items,
    };
  }

  private label(depth: number): AtomLabel {
    this.space();
    const start = this.pos;
    const atoms: LabelRun[][] = [];
    let runs: LabelRun[] = [];
    const push = () => {
      if (runs.length) atoms.push(runs);
      runs = [];
    };
    while (this.pos < this.source.length) {
      this.space();
      const ch = this.peek();
      if (!ch || '-=~()!*<>@?[]#}'.includes(ch)) break;
      if (ch === '$')
        this.fail(
          'UNSUPPORTED',
          'Math delimiters are not supported; write atom labels and scripts directly',
        );
      if (ch === '|') {
        push();
        this.pos++;
        continue;
      }
      if (/[A-Z]/.test(ch) && runs.length) push();
      if (ch === '{') {
        this.pos++;
        appendRuns(runs, this.labelGroup(depth + 1, 'normal'));
      } else if (ch === '_' || ch === '^') {
        this.pos++;
        appendRuns(runs, this.script(depth + 1, ch === '_' ? 'sub' : 'super'));
      } else if (ch === '\\') {
        appendRuns(runs, this.command(depth + 1, 'normal'));
      } else {
        const text = this.character();
        this.pos += text.length;
        runs.push({ text, script: 'normal' });
      }
    }
    push();
    return {
      source: this.source.slice(start, this.pos).trim(),
      atoms: atoms.length ? atoms : EMPTY_LABEL().atoms,
    };
  }

  private labelGroup(depth: number, script: LabelRun['script']): LabelRun[] {
    this.depth(depth);
    const start = this.pos - 1;
    const runs: LabelRun[] = [];
    while (this.pos < this.source.length) {
      this.space();
      const ch = this.peek();
      if (ch === '}') {
        this.pos++;
        return runs;
      }
      if (!ch) break;
      if (ch === '$')
        this.fail(
          'UNSUPPORTED',
          'Math delimiters are not supported; write atom labels and scripts directly',
        );
      if (ch === '{') {
        this.pos++;
        appendRuns(runs, this.labelGroup(depth + 1, script));
      } else if (ch === '\\') appendRuns(runs, this.command(depth + 1, script));
      else if (ch === '_' || ch === '^') {
        if (script !== 'normal')
          this.fail('UNSUPPORTED', 'Nested subscripts or superscripts are not supported');
        this.pos++;
        appendRuns(runs, this.script(depth + 1, ch === '_' ? 'sub' : 'super'));
      } else {
        const text = this.character();
        this.pos += text.length;
        runs.push({ text: text === '-' ? '−' : text, script });
      }
    }
    this.fail('SYNTAX', 'Unclosed atom label; expected }', start);
  }

  private script(depth: number, kind: LabelRun['script']): LabelRun[] {
    this.depth(depth);
    this.space();
    const ch = this.peek();
    if (ch === '{') {
      this.pos++;
      return this.labelGroup(depth + 1, kind);
    }
    if (ch === '\\') return this.command(depth + 1, kind);
    if (!ch || '-=~()*<>?[]#}_^'.includes(ch))
      this.fail('SYNTAX', 'Expected a script token; put bond characters inside braces, e.g. ^{-}');
    const text = this.character();
    this.pos += text.length;
    return [{ text, script: kind }];
  }

  private command(depth: number, script: LabelRun['script']): LabelRun[] {
    this.depth(depth);
    const start = this.pos++;
    const match = /^[a-zA-Z]+/.exec(this.source.slice(this.pos));
    if (!match) {
      const ch = this.peek();
      if ('{}_%#& '.includes(ch) && ch) {
        this.pos++;
        return [{ text: ch, script }];
      }
      this.fail('UNSUPPORTED', 'Unsupported TeX escape', start);
    }
    const name = match[0];
    this.pos += name.length;
    if (Object.hasOwn(SYMBOLS, name)) return [{ text: SYMBOLS[name]!, script }];
    if (['mathrm', 'mathsf', 'textrm', 'text'].includes(name)) {
      this.space();
      if (this.peek() !== '{') this.fail('SYNTAX', `Expected { after \\${name}`);
      this.pos++;
      return this.labelGroup(depth + 1, script);
    }
    this.fail('UNSUPPORTED', `Unsupported TeX command \\${name}`, start);
  }

  private options(): BondOptions {
    const start = this.pos;
    const fields = this.fields();
    const result: BondOptions = {};
    if (fields[0]) {
      const token = fields[0].replace(/\s/g, '');
      const mode = token.startsWith('::') ? 'relative' : 'absolute';
      const value = token.replace(/^:{1,2}/, '');
      const degrees = this.number(value, 'angle', start);
      if (!token.startsWith(':') && !Number.isInteger(degrees))
        this.fail('SYNTAX', 'Predefined angles must be integers; use : for degrees', start);
      result.angle = {
        mode,
        degrees: token.startsWith(':') ? degrees : degrees * 45,
      } satisfies Angle;
    }
    if (fields[1]) {
      const value = this.number(fields[1], 'bond length multiplier', start);
      if (value < 0.05 || value > 10)
        this.fail('LIMIT', 'Bond length multiplier must be from 0.05 to 10', start);
      result.length = value;
    }
    for (const [index, key] of [
      [2, 'departure'],
      [3, 'arrival'],
    ] as const) {
      if (fields[index]) {
        const value = this.number(fields[index], `${key} atom index`, start);
        if (!Number.isSafeInteger(value) || value < 1)
          this.fail('SYNTAX', 'Atom indices must be positive integers', start);
        result[key] = value;
      }
    }
    const style = fields
      .slice(4)
      .filter(Boolean)
      .join(',')
      .replace(/^\{(.*)\}$/, '$1')
      .replace(/\s/g, '');
    if (style && style !== 'draw=none')
      this.fail('UNSUPPORTED', 'Only draw=none is supported in the TikZ bond-style field', start);
    if (style) result.invisible = true;
    return result;
  }

  private fields(): string[] {
    const start = this.pos++;
    let braces = 0;
    let field = '';
    const fields: string[] = [];
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos++]!;
      if (ch === '%') {
        while (this.pos < this.source.length && this.peek() !== '\n') this.pos++;
        continue;
      }
      if (ch === '{') braces++;
      if (ch === '}') braces--;
      if (braces > this.limits.maxDepth)
        this.fail('LIMIT', 'Option group nesting limit exceeded', start);
      if (braces < 0) this.fail('SYNTAX', 'Unmatched } in options', this.pos - 1);
      if (ch === ']' && braces === 0) {
        fields.push(field.trim());
        return fields;
      }
      if (ch === ',' && braces === 0) {
        fields.push(field.trim());
        field = '';
      } else field += ch;
    }
    this.fail('SYNTAX', 'Unclosed options; expected ]', start);
  }

  private number(value: string, name: string, offset: number): number {
    value = value.replace(/\s/g, '');
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ||
      !Number.isFinite(Number(value)) ||
      Math.abs(Number(value)) > 1_000_000
    ) {
      this.fail(
        'SYNTAX',
        `Invalid ${name}: ${JSON.stringify(value)} (numeric literals only)`,
        offset,
      );
    }
    return Number(value);
  }

  private bondKind(): BondKind {
    let kind = this.source[this.pos++]!;
    if ((kind === '<' || kind === '>') && (this.peek() === ':' || this.peek() === '|'))
      kind += this.source[this.pos++]!;
    return kind as BondKind;
  }

  private countBond() {
    if (++this.bondCount > this.limits.maxBonds)
      this.fail('LIMIT', `Molecule exceeds ${this.limits.maxBonds} bonds`);
  }
  private countAtoms(chain: ChainSyntax, count: number, ringSize?: number): number {
    let edges = 0;
    for (const item of chain.items) {
      if (item.type === 'bond') {
        edges++;
        if (edges !== ringSize) count++;
      } else if (item.type === 'branch') count = this.countAtoms(item.chain, count);
      else if (item.type === 'ring') count = this.countAtoms(item.chain, count, item.size);
      if (count > this.limits.maxAtoms)
        this.fail('LIMIT', `Molecule exceeds ${this.limits.maxAtoms} atom groups`, item.start);
    }
    return count;
  }
  private depth(depth: number) {
    if (depth > this.limits.maxDepth)
      this.fail('LIMIT', `Nesting exceeds ${this.limits.maxDepth} levels`);
  }
  private space() {
    while (this.pos < this.source.length) {
      if (/\s/.test(this.peek())) this.pos++;
      else if (this.peek() === '%') {
        while (this.pos < this.source.length && this.peek() !== '\n') this.pos++;
      } else break;
    }
  }
  private peek(): string {
    return this.source[this.pos] ?? '';
  }
  private character(): string {
    return String.fromCodePoint(this.source.codePointAt(this.pos)!);
  }
  private fail(
    code: ConstructorParameters<typeof ChemfigError>[0],
    message: string,
    offset = this.pos,
  ): never {
    throw new ChemfigError(code, message, this.source, offset);
  }
}
