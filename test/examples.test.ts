import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { examples } from '../demo/examples.js';
import rehypeChemfig, { renderChemfig, remarkChemfig } from '../src/index.js';

test('example names are unique and safe to use as image filenames', () => {
  const names = examples.map((example) => example.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[A-Za-z]+(?: [A-Za-z]+)*$/);
});

for (const example of examples) {
  test(`${example.name} renders through the core, remark, and rehype APIs`, async () => {
    const result = renderChemfig(example.source, { title: example.name });
    assert.match(result.svg, /<svg /);
    assert.ok(result.layout.bonds.length > 0);
    assert.doesNotMatch(result.svg, /NaN|Infinity/);

    const markdown = `\`\`\`chemfig ${example.name}\n${example.source}\n\`\`\``;
    const files = await Promise.all([
      unified()
        .use(remarkParse)
        .use(remarkChemfig, { errorMode: 'throw' })
        .use(remarkRehype)
        .use(rehypeStringify)
        .process(markdown),
      unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypeChemfig, { errorMode: 'throw' })
        .use(rehypeStringify)
        .process(markdown),
    ]);
    for (const file of files) {
      assert.equal(file.messages.length, 0);
      assert.equal((String(file).match(/<svg /g) ?? []).length, 1);
      assert.ok(String(file).includes(`viewBox="${result.tree.properties.viewBox}"`));
    }
  });
}
