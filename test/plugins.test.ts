import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import rehypeSanitize from 'rehype-sanitize';
import defaultPlugin, { remarkChemfig, rehypeChemfig, ChemfigError } from '../src/index.js';
import type { ChemfigOptions } from '../src/types.js';
import type { Root, Element } from 'hast';

const markdown = 'Before `chemfig: H-O-H` after.\n\n```chemfig Benzene\n*6(-=-=-=)\n```';
const processor = (options: ChemfigOptions = {}) =>
  unified().use(remarkParse).use(remarkChemfig, options).use(remarkRehype).use(rehypeStringify);

test('the package default is the rehype plugin', () => {
  assert.equal(defaultPlugin, rehypeChemfig);
});

test('remark integrates with standard remark-rehype with no unsafe HTML flags or custom handlers', async () => {
  const file = await processor().process(markdown);
  const html = String(file);
  assert.equal((html.match(/<svg /g) ?? []).length, 2);
  assert.match(html, /<p>Before <span class="chemfig chemfig-inline">/);
  assert.match(html, /<figure class="chemfig chemfig-display">/);
  assert.match(html, /<figcaption>Benzene<\/figcaption>/);
  assert.doesNotMatch(html, /<pre>|language-chemfig/);
  assert.equal(file.messages.length, 0);
});

test('rehype independently transforms fenced code from Markdown', async () => {
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeChemfig)
    .use(rehypeStringify)
    .process(markdown);
  assert.equal((String(file).match(/<svg /g) ?? []).length, 2);
});

test('rehype supports HTML ASTs and escaped < wedge syntax', async () => {
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeChemfig)
    .use(rehypeStringify)
    .process(
      '<pre><code class="language-chemfig">A&lt;B</code></pre><p><code>chemfig: N_2</code></p>',
    );
  assert.match(String(file), /<polygon/);
  assert.equal((String(file).match(/<svg /g) ?? []).length, 2);
});

test('remark + rehype together do not render twice', async () => {
  const file = await unified()
    .use(remarkParse)
    .use(remarkChemfig)
    .use(remarkRehype)
    .use(rehypeChemfig)
    .use(rehypeStringify)
    .process(markdown);
  assert.equal((String(file).match(/<svg /g) ?? []).length, 2);
});

test('emits actual HAST element/text nodes, never raw HTML nodes', async () => {
  const p = unified().use(remarkParse).use(remarkChemfig).use(remarkRehype);
  const tree = (await p.run(p.parse(markdown))) as Root;
  const check = (node: Root | Element) => {
    for (const child of node.children) {
      assert.notEqual(child.type, 'raw');
      if (child.type === 'element') check(child);
    }
  };
  check(tree);
});

test('ordinary code, fenced examples, escaped prose, and other languages are untouched', async () => {
  const input = '`A-B`\n\n```js\nchemfig: A-B\n```\n\n\\chemfig{A-B}';
  const file = await processor().process(input);
  assert.doesNotMatch(String(file), /<svg/);
  assert.match(String(file), /language-js/);
});

test('inline rendering can be disabled', async () => {
  const file = await processor({ inline: false }).process(markdown);
  assert.equal((String(file).match(/<svg /g) ?? []).length, 1);
  assert.match(String(file), /<code>chemfig: H-O-H<\/code>/);
});

test('rehype does not interpret ordinary preformatted code or highlighted child elements', async () => {
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeChemfig)
    .use(rehypeStringify)
    .process(
      '<pre><code>chemfig: A-B</code></pre><pre><code class="language-chemfig"><span>A-B</span></code></pre>',
    );
  assert.doesNotMatch(String(file), /<svg/);
});

test('default failure mode preserves source and adds a nonfatal VFile diagnostic', async () => {
  const file = await processor().process('```chemfig\nA-[:bad]B\n```\n\n`chemfig: A?`');
  assert.equal(file.messages.length, 2);
  assert.equal(file.messages[0]!.source, 'chemfig');
  assert.equal(file.messages[0]!.ruleId, 'SYNTAX');
  assert.equal(file.messages[0]!.line, 1);
  assert.ok(file.messages[0]!.cause instanceof ChemfigError);
  assert.match(String(file), /class="chemfig-error"/);
  assert.match(String(file), /<code>A-\[:bad\]B<\/code>/);
});

test('strict error mode fails the build instead of swallowing the error', async () => {
  await assert.rejects(
    processor({ errorMode: 'throw' }).process('```chemfig\n\\charge{90=+}{N}\n```'),
    ChemfigError,
  );
});

test('prototype command names produce recoverable diagnostics in both plugins', async () => {
  const input = '```chemfig\n\\constructor\n```';
  const files = await Promise.all([
    processor().process(input),
    unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeChemfig)
      .use(rehypeStringify)
      .process(input),
  ]);
  for (const file of files) {
    assert.equal(file.messages.length, 1);
    assert.equal(file.messages[0]!.ruleId, 'UNSUPPORTED');
    assert.ok(file.messages[0]!.cause instanceof ChemfigError);
    assert.match(String(file), /<code>\\constructor<\/code>/);
  }
});

test('untrusted error source and captions are escaped as text', async () => {
  const file = await processor().process(
    '```chemfig <img src=x onerror=alert(1)>\nA-B\n```\n\n```chemfig\n\\input{<script>}\n```',
  );
  const parsed = unified().use(rehypeParse, { fragment: true }).parse(String(file)) as Root;
  const check = (node: Root | Element) => {
    for (const child of node.children)
      if (child.type === 'element') {
        assert.ok(!['script', 'img'].includes(child.tagName));
        assert.ok(!Object.keys(child.properties).some((p) => p.toLowerCase().startsWith('on')));
        check(child);
      }
  };
  check(parsed);
});

test('sanitization should precede rendering when Markdown is untrusted', async () => {
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeChemfig)
    .use(rehypeStringify)
    .process(markdown);
  assert.equal((String(file).match(/<svg /g) ?? []).length, 2);
});
