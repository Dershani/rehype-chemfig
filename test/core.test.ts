import test from 'node:test';
import assert from 'node:assert/strict';
import { ChemfigError, layoutChemfig, parseChemfig, renderChemfig } from '../src/core.js';
import type { Element } from 'hast';

const layout = (source: string) => layoutChemfig(parseChemfig(source));
const close = (a: number, b: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const angles = (source: string) => {
  const graph = layout(source);
  return graph.bonds.map((bond) => {
    const a = graph.atoms[bond.from]!.anchors[bond.departure - 1]!;
    const b = graph.atoms[bond.to]!.anchors[bond.arrival - 1]!;
    return ((((Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI) % 360) + 360) % 360;
  });
};
function elements(node: Element, name: string): Element[] {
  return [
    ...(node.tagName === name ? [node] : []),
    ...node.children.flatMap((child) => (child.type === 'element' ? elements(child, name) : [])),
  ];
}

test('parses bare code and the actual chemfig macro wrapper', () => {
  assert.equal(parseChemfig('H-O-H').chain.items.length, 2);
  assert.equal(parseChemfig(String.raw`\chemfig{H-O-H}`).chain.items.length, 2);
  assert.equal(parseChemfig('% start\n H - O % comment\n - H').chain.items.length, 2);
});

test('preserves all nine official bond kinds, matching longest tokens first', () => {
  const syntax = parseChemfig('A-B=C~D>E<F>:G<:H>|I<|J');
  assert.deepEqual(
    syntax.chain.items.map((item) => (item.type === 'bond' ? item.kind : '')),
    ['-', '=', '~', '>', '<', '>:', '<:', '>|', '<|'],
  );
});

test('omitted angles use defaults, not the preceding angle', () => {
  const values = angles('A-[1]B-C-[::30]D');
  [45, 0, 30].forEach((a, i) => close(values[i]!, a));
});

test('absolute, negative predefined, and relative angles are counterclockwise', () => {
  const values = angles('A-[:30]-[-1]-[::60]B');
  [30, 315, 15].forEach((a, i) => close(values[i]!, a));
});

test('ignores whitespace and comments in numerical bond fields', () => {
  close(angles('A-[:: -60 % angle\n, 1.5]B')[0]!, 300);
});

test('one-bond overrides do not mutate molecule defaults', () => {
  const source = '[:20,1.5]A-B-[:-80,0.7]C-D';
  const graph = layout(source);
  [20, 280, 20].forEach((a, i) => close(angles(source)[i]!, a));
  [1.5, 0.7, 1.5].forEach((length, i) => {
    const b = graph.bonds[i]!;
    const a1 = graph.atoms[b.from]!.anchors[b.departure - 1]!;
    const a2 = graph.atoms[b.to]!.anchors[b.arrival - 1]!;
    close(Math.hypot(a2.x - a1.x, a2.y - a1.y), length * 42);
  });
});

test('branches restore attachment and incoming angle, including siblings', () => {
  const source = 'A-[:30]B(-[::60]C)(-[::-60]D)-[::0]E';
  [30, 90, 330, 30].forEach((a, i) => close(angles(source)[i]!, a));
  const graph = layout(source);
  assert.deepEqual(
    graph.bonds.map((b) => b.from),
    [0, 1, 1, 1],
  );
});

test('leading branch defaults are resolved once and remain local', () => {
  [0, 60, 60, 0].forEach((a, i) => close(angles('A-B([:60]-C-D)-E')[i]!, a));
  [30, 0, 0, 30].forEach((a, i) => close(angles('[:30]A-B([::-30]-C-D)-E')[i]!, a));
});

test('a leading branch angle becomes the reference for its first relative bond', () => {
  [30, 105, 90, 30].forEach((a, i) => close(angles('[:30]A-B([:90]-[::15]C-D)-[::0]E')[i]!, a));
  [30, 75, 90, 30].forEach((a, i) => close(angles('[:30]A-B([::60]-[::-15]C-D)-[::0]E')[i]!, a));
});

test('leading branch options reset the angular reference even when the angle field is omitted', () => {
  for (const defaults of ['[]', '[,2]', '[,,,,draw=none]']) {
    [30, 15, 30].forEach((a, i) => close(angles(`A-[:30]B(${defaults}-[::15]C)-[::0]D`)[i]!, a));
  }
});

test('nested branches attach to the correct group', () => {
  const graph = layout('A-B([1]-X([2]-Z)-Y)(-[7]D)-C');
  assert.equal(graph.atoms.length, 7);
  assert.deepEqual(
    graph.bonds.map((b) => b.from),
    [0, 1, 2, 2, 1, 1],
  );
});

test('standalone hexagon reuses its first vertex and has authentic orientation', () => {
  const graph = layout('*6(-=-=-=)');
  assert.equal(graph.atoms.length, 6);
  assert.equal(graph.bonds.length, 6);
  [330, 30, 90, 150, 210, 270].forEach((a, i) => close(angles('*6(-=-=-=)')[i]!, a));
  assert.equal(graph.bonds.at(-1)!.to, 0);
  assert.equal(graph.bonds.filter((b) => b.kind === '=').length, 3);
  assert.ok(graph.bonds.filter((b) => b.kind === '=').every((b) => b.shift === 'left'));
});

test('molecule defaults rotate standalone rings', () => {
  [0, 60, 120, 180, 240, 300].forEach((a, i) => close(angles('[:30]*6(------)')[i]!, a));
});

test('attached ring bisects incoming direction and shares the attachment', () => {
  const graph = layout('A-[:25]B*4(----)');
  assert.equal(graph.atoms.length, 5);
  assert.equal(graph.bonds.length, 5);
  close(angles('A-[:25]B*4(----)')[1]!, 340);
  assert.equal(graph.bonds.at(-1)!.to, 1);
});

test('rotated rings close onto their saved attachment subatom, not the direction-selected subatom', () => {
  for (const source of [
    '[:30]CH_3*6(------)',
    '[:30,,,1]CH_3*6(------)',
    'A-[:70]CH_3*6(------)',
  ]) {
    const graph = layout(source);
    const closing = graph.bonds.at(-1)!;
    assert.equal(closing.arrival, 2);
    assert.equal(closing.to, source.startsWith('A') ? 1 : 0);
    const a = graph.atoms[closing.from]!.anchors[closing.departure - 1]!;
    const b = graph.atoms[closing.to]!.anchors[closing.arrival - 1]!;
    close(Math.hypot(b.x - a.x, b.y - a.y), 42);
  }
  // The saved anchor is selected before the ring, even if its first side's
  // direction selects a different subatom (the upstream typographic behavior).
  assert.equal(layout('[:100]CH_3*6(------)').bonds.at(-1)!.arrival, 1);
});

test('incomplete rings do not silently auto-close', () => {
  const graph = layout('*5(-B=C-D)');
  assert.equal(graph.bonds.length, 3);
  assert.equal(graph.atoms.length, 4);
  assert.equal(graph.bonds.at(-1)!.to, 3);
  assert.equal(elements(renderChemfig('*5(---)').tree, 'line').length, 3);
});

test('aromatic rings add a circle, not invented double bonds', () => {
  const result = renderChemfig('**6(------)');
  assert.equal(result.layout.atoms.length, 6);
  assert.equal(result.layout.bonds.length, 6);
  assert.ok(result.layout.bonds.every((b) => b.kind === '-'));
  assert.equal(elements(result.tree, 'circle').length, 1);
});

test('ring branches follow outward bisectors', () => {
  const values = angles('*6(-(-OH)-----)');
  close(values[0]!, 330);
  close(values[1]!, 270);
  close(values[2]!, 30);
});

test('ring substituent angles do not depend on the width or arrival anchor of a label', () => {
  for (let edge = 1; edge < 6; edge++) {
    const source = `*6(${'-'.repeat(edge)}CH_3(-X)${'-'.repeat(6 - edge)})`;
    close(angles(source)[edge]!, (270 + (edge - 1) * 60) % 360);
  }
});

test('a bond-specific branch angle does not rotate subsequent branch bonds', () => {
  const values = angles('*6(-(-[:90]A-B)-----)');
  close(values[1]!, 90);
  close(values[2]!, 270);
});

test('a relative branch on the first ring vertex references the theoretical incoming side', () => {
  close(angles('*6((-[::0]A)------)')[0]!, 270);
});

test('nested fused rings are placed on the outside and reuse coincident skeletal vertices', () => {
  const graph = layout('*6(--*5(----)----)');
  assert.equal(graph.rings.length, 2);
  assert.equal(graph.atoms.length, 9);
  assert.equal(graph.bonds.length, 10);
});

test('group splitting follows uppercase boundaries, braces, and explicit |', () => {
  assert.equal(parseChemfig('H_3C').chain.initial.atoms.length, 2);
  assert.equal(parseChemfig('CH_3CH_2').chain.initial.atoms.length, 4);
  assert.equal(parseChemfig('{CH_3CH_2}').chain.initial.atoms.length, 1);
  assert.equal(parseChemfig('C|{(CH_3)_3}').chain.initial.atoms.length, 2);
  assert.equal(parseChemfig('Na').chain.initial.atoms.length, 1);
});

test('1-based departure/arrival fields select typographic atoms, not graph vertices', () => {
  const graph = layout('ABCD-[:75,,2,3]EFG');
  assert.equal(graph.bonds[0]!.departure, 2);
  assert.equal(graph.bonds[0]!.arrival, 3);
  close(angles('ABCD-[:75,,2,3]EFG')[0]!, 75);
  const b = graph.bonds[0]!;
  const p = graph.atoms[b.from]!.anchors[1]!;
  const q = graph.atoms[b.to]!.anchors[2]!;
  close(Math.hypot(p.x - q.x, p.y - q.y), 42);
});

test('automatic group anchoring depends on bond direction including vertical bonds', () => {
  assert.equal(layout('H_3C-C').bonds[0]!.departure, 2);
  assert.equal(layout('C-[4]H_3C').bonds[0]!.arrival, 2);
  assert.equal(layout('CH_3-[2]OH').bonds[0]!.departure, 1);
  assert.equal(layout('CH_3-[2]OH').bonds[0]!.arrival, 2);
});

test('subscripts, superscripts, protected parentheses and charge signs are text, not bonds', () => {
  const result = renderChemfig('H_3C-C(=[:90]O)-O^{-}');
  assert.equal(result.layout.atoms.length, 4);
  assert.equal(result.layout.bonds.length, 3);
  assert.match(result.svg, /data-script="sub"/);
  assert.match(result.svg, /data-script="super"/);
  assert.match(result.svg, /−/);
  assert.equal(parseChemfig('{(CH_3)_3}').chain.items.length, 0);
  const scripts = renderChemfig('N_2^{+}').layout.atoms[0]!.runs;
  close(scripts.find((r) => r.script === 'sub')!.x, scripts.find((r) => r.script === 'super')!.x);
});

test('literal numbers do not gain invented subscripts', () => {
  assert.ok(
    parseChemfig('CH3')
      .chain.initial.atoms.flat()
      .every((r) => r.script === 'normal'),
  );
});

test('supports small, explicit label command allowlist and literal Unicode', () => {
  const result = renderChemfig(String.raw`\mathrm{NH}_{4}^{\oplus}-R^{\prime}`);
  assert.match(result.svg, /⊕/);
  assert.match(result.svg, /′/);
  assert.match(renderChemfig('R^{δ+}').svg, /δ/);
});

test('astral Unicode remains whole in ordinary, grouped, command, and script labels', () => {
  for (const source of ['𝒞-𝛼', '{𝒞}', '\\mathrm{𝒞}', 'R^𝛼', 'R^{𝛼}']) {
    const result = renderChemfig(source);
    const runs = result.layout.atoms.flatMap((atom) => atom.runs);
    assert.ok(runs.every((run) => !/[\uD800-\uDFFF]/u.test(run.text)));
    assert.match(result.svg, /𝒞|𝛼/);
  }
  assert.throws(
    () => parseChemfig('𝒞-[:foo]N'),
    (error) => error instanceof ChemfigError && error.offset === 3,
  );
});

test('prototype properties are not accepted as label commands', () => {
  for (const command of Object.getOwnPropertyNames(Object.prototype).filter((name) =>
    /^[a-zA-Z]+$/.test(name),
  )) {
    assert.throws(
      () => renderChemfig(`\\${command}`),
      (error) => error instanceof ChemfigError && error.code === 'UNSUPPORTED',
    );
  }
});

test('distant hooks share the first named occurrence and do not create vertices', () => {
  const graph = layout('A?[a]-[:30]B-C?[a,2]');
  assert.equal(graph.atoms.length, 3);
  assert.equal(graph.bonds.length, 3);
  assert.equal(graph.bonds.at(-1)!.kind, '=');
  assert.equal(graph.bonds.at(-1)!.to, 0);
  assert.equal(layout('?-[:-50]-[:10]-[:-10]-[:130]O-[:190]?').bonds.length, 6);
});

test('invisible bonds advance layout but do not draw', () => {
  const result = renderChemfig('A-[,,,,draw=none]B-C');
  assert.equal(result.layout.atoms.length, 3);
  assert.equal(result.layout.bonds.length, 2);
  assert.equal(elements(result.tree, 'line').length, 1);
});

test('double and triple bonds render parallel lines, shifted doubles shift only secondary line', () => {
  assert.equal(elements(renderChemfig('A=B').tree, 'line').length, 2);
  assert.equal(elements(renderChemfig('A~B').tree, 'line').length, 3);
  const line = elements(renderChemfig('A=^B').tree, 'line');
  close(Number(line[0]!.properties.y1), 0);
  close(Number(line[1]!.properties.y1), -4);
});

for (const kind of ['>', '<', '>|', '<|']) {
  test(`${kind} wedge direction follows Chemfig, including rotation`, () => {
    for (const angle of [0, 30, 90, 180, 270]) {
      const result = renderChemfig(`A${kind}[:${angle}]B`);
      const triangle = elements(result.tree, 'polygon')[0]!;
      const points = String(triangle.properties.points)
        .split(' ')
        .map((p) => p.split(',').map(Number));
      const midpoint = {
        x: (points[0]![0]! + points[1]![0]!) / 2,
        y: (points[0]![1]! + points[1]![1]!) / 2,
      };
      const tip = { x: points[2]![0]!, y: points[2]![1]! };
      const along =
        (tip.x - midpoint.x) * Math.cos((angle * Math.PI) / 180) -
        (tip.y - midpoint.y) * Math.sin((angle * Math.PI) / 180);
      assert.equal(along > 0, kind.startsWith('>'));
      assert.equal(triangle.properties.fill, kind.endsWith('|') ? 'none' : 'currentColor');
    }
  });
}

test('hashed wedges taper in the correct direction', () => {
  for (const kind of ['>:', '<:']) {
    const lines = elements(renderChemfig(`A${kind}B`).tree, 'line');
    const length = (el: Element) => Math.abs(Number(el.properties.y2) - Number(el.properties.y1));
    assert.equal(length(lines[0]!) > length(lines.at(-1)!), kind === '>:');
  }
});

test('bonds are trimmed away from labels and empty vertices remain joined', () => {
  const result = renderChemfig('A-B');
  const line = elements(result.tree, 'line')[0]!;
  assert.ok(Number(line.properties.x1) > result.layout.atoms[0]!.bounds.right);
  assert.ok(Number(line.properties.x2) < result.layout.atoms[1]!.bounds.left);
  const skeletal = elements(renderChemfig('--').tree, 'line');
  assert.equal(skeletal[0]!.properties.x2, skeletal[1]!.properties.x1);
});

test('SVG has a descriptive accessible name, scalable viewport and no conflicting IDs', () => {
  const result = renderChemfig('*6(------)', { title: 'Cyclohexane' });
  assert.equal(result.tree.properties.role, 'img');
  assert.equal(result.tree.properties.ariaLabel, 'Cyclohexane');
  assert.match(result.svg, /viewBox=/);
  assert.doesNotMatch(result.svg, /\sid=|foreignObject|<script/);
});

test('source, labels, and title cannot inject HTML, scripts, attributes or URLs', () => {
  const result = renderChemfig('{<script>alert(1)</script>}', {
    title: '"><img src=x onerror=alert(1)>',
  });
  assert.doesNotMatch(result.svg, /<script|<img|onerror="|href=/);
  assert.ok(
    elements(result.tree, 'tspan').every((node) => node.children.every((n) => n.type === 'text')),
  );
});

test('rendering is deterministic and works without browser globals', () => {
  const source = '*6(-(-OH)=(-OCH_3)-=(-=[::-60]O)-=)';
  assert.equal(renderChemfig(source).svg, renderChemfig(source).svg);
  for (const number of renderChemfig(source).layout.viewBox) assert.ok(Number.isFinite(number));
});

const invalid = [
  ['', 'SYNTAX'],
  ['A(-B', 'SYNTAX'],
  ['A)', 'SYNTAX'],
  ['A-[:foo]B', 'SYNTAX'],
  ['A-[1.5]B', 'SYNTAX'],
  ['A-[,0]B', 'LIMIT'],
  ['A-[,,0]B', 'SYNTAX'],
  ['A-[,,9]B', 'GEOMETRY'],
  ['A^{', 'SYNTAX'],
  ['A^-', 'SYNTAX'],
  ['*2(--)', 'LIMIT'],
  ['*6(-------)', 'SYNTAX'],
  ['*6(------N)', 'SYNTAX'],
  ['**6(---)', 'UNSUPPORTED'],
  ['*6(-[:20]-----)', 'UNSUPPORTED'],
  ['*6([]------)', 'UNSUPPORTED'],
  [String.raw`\chemfig[atom sep=3em]{A-B}`, 'UNSUPPORTED'],
  [String.raw`\input{test}`, 'UNSUPPORTED'],
  [String.raw`\charge{90=+}{N}`, 'UNSUPPORTED'],
  ['$H-O-H$', 'UNSUPPORTED'],
  ['A-[,,,,red]B', 'UNSUPPORTED'],
  ['!{foo}', 'UNSUPPORTED'],
  ['@{a}A', 'UNSUPPORTED'],
  ['A-#(2pt)B', 'UNSUPPORTED'],
  ['A?', 'GEOMETRY'],
  ['A??', 'GEOMETRY'],
  ['A?[foo bar]-B', 'SYNTAX'],
] as const;
for (const [source, code] of invalid) {
  test(`diagnoses ${JSON.stringify(source)} as ${code}`, () => {
    assert.throws(
      () => renderChemfig(source),
      (error) =>
        error instanceof ChemfigError &&
        error.code === code &&
        error.line >= 1 &&
        error.column >= 1,
    );
  });
}

test('resource limits reject excess source, bonds, groups, and nesting predictably', () => {
  for (const [source, limits] of [
    ['A-B', { maxLength: 2 }],
    ['---', { maxBonds: 2 }],
    ['---', { maxAtoms: 2 }],
    ['A(-B(-C(-D)))', { maxDepth: 2 }],
    ['{{{{A}}}}', { maxDepth: 2 }],
  ] as const)
    assert.throws(
      () => renderChemfig(source, { limits }),
      (error) => error instanceof ChemfigError && error.code === 'LIMIT',
    );
});

test('closed rings do not charge an extra atom against the input limit', () => {
  assert.equal(
    renderChemfig('*6(------)', { limits: { maxAtoms: 6, maxBonds: 6 } }).layout.atoms.length,
    6,
  );
  assert.equal(renderChemfig('A?-[:30]B-C?', { limits: { maxBonds: 3 } }).layout.bonds.length, 3);
});

test('rejects control characters that cannot appear in standalone XML SVG', () => {
  assert.throws(() => renderChemfig('C\u0000'), ChemfigError);
  for (const source of ['C\uD800', '\uDC00', '\uFFFE', '\uFFFF']) {
    assert.throws(
      () => renderChemfig(source),
      (error) => error instanceof ChemfigError && error.code === 'SYNTAX',
    );
  }
});

test('allowed long grouped labels do not exceed the JavaScript argument stack limit', () => {
  const text = 'a'.repeat(150_000);
  for (const source of [`{${text}}`, `R^{${text}}`, `\\text{${text}}`]) {
    const syntax = parseChemfig(source, { limits: { maxLength: 200_000 } });
    assert.equal(
      syntax.chain.initial.atoms
        .flat()
        .map((run) => run.text)
        .join(''),
      source.startsWith('R') ? `R${text}` : text,
    );
  }
});

test('invalid configuration cannot create NaN, infinite or unbounded SVG geometry', () => {
  for (const options of [
    { fontSize: NaN },
    { bondLength: Infinity },
    { strokeWidth: -1 },
    { padding: -1 },
    { limits: { maxDepth: 1_000 } },
  ]) {
    assert.throws(
      () => renderChemfig('A-B', options),
      (error) => error instanceof ChemfigError && error.code === 'OPTIONS',
    );
  }
});

test('diagnostic offsets refer to the original source, including wrapper and newlines', () => {
  try {
    parseChemfig('\\chemfig{A-\n[:foo]B}');
    assert.fail('expected error');
  } catch (error) {
    assert.ok(error instanceof ChemfigError);
    assert.equal(error.line, 2);
    assert.equal(error.column, 1);
    assert.equal(error.offset, 12);
  }
});
