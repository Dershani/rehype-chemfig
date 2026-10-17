import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { remarkChemfig } from '../src/index.js';
import { examples } from './examples.js';

const output = new URL('./public/', import.meta.url);
await mkdir(output, { recursive: true });
const processor = unified()
  .use(remarkParse)
  .use(remarkChemfig, { errorMode: 'throw' })
  .use(remarkRehype)
  .use(rehypeStringify);
const render = (source: string, caption = '') =>
  String(processor.processSync(`\`\`\`chemfig${caption ? ` ${caption}` : ''}\n${source}\n\`\`\``));
const escape = (source: string) =>
  source
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const first = examples[0];
const template = await readFile(new URL('./template.html', import.meta.url), 'utf8');
const html = template
  .replace(
    '<!-- EXAMPLE_BUTTONS -->',
    examples
      .map(
        (example, i) =>
          `<button type="button" class="example-button" data-example="${i}" aria-pressed="${i === 0}">${escape(example.name)}</button>`,
      )
      .join(''),
  )
  .replace('<!-- INITIAL_SOURCE -->', escape(first.source))
  .replace('<!-- INITIAL_RENDER -->', render(first.source))
  .replace(
    '<!-- INLINE_EXAMPLE -->',
    String(
      processor.processSync('An alcohol group, `chemfig: H_3C-CH_2-OH`, right where you need it.'),
    ),
  )
  .replace(
    '<!-- GALLERY -->',
    [
      {
        title: 'Angles & branches',
        source: '[:30]--[:-30](=[6]O)--[:-30](-[6]NH_2)-(=[2]O)-[:-30]OH',
        detail: 'Predefined, absolute, and relative angles. Defaults stay scoped to each chain.',
      },
      {
        title: 'Rings & aromaticity',
        source: '*6(-=-(-**6(------))=-=)',
        detail: 'Regular rings, connected rings, nested rings, and explicit aromatic circles.',
      },
      {
        title: 'Labels & stereochemistry',
        source: examples[2].source,
        detail: 'Subscripts, superscripts, and all six solid, hashed, and hollow Cram bonds.',
      },
    ]
      .map(
        (example) =>
          `<article class="specimen"><h3>${escape(example.title)}</h3><div class="specimen-drawing">${render(example.source)}</div><p>${escape(example.detail)}</p><code>${escape(example.source)}</code></article>`,
      )
      .join(''),
  );
await writeFile(new URL('index.html', output), html);
await Promise.all([
  copyFile(new URL('./style.css', import.meta.url), new URL('demo.css', output)),
  copyFile(new URL('../src/styles.css', import.meta.url), new URL('chemfig.css', output)),
  copyFile(new URL('../README.md', import.meta.url), new URL('README.md', output)),
  copyFile(new URL('../assets/icon.svg', import.meta.url), new URL('icon.svg', output)),
  build({
    entryPoints: [new URL('./client.ts', import.meta.url).pathname],
    outfile: new URL('client.js', output).pathname,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: true,
  }),
]);
console.log(`Generated ${output.pathname}index.html using remarkChemfig.`);
