import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import type { Root, RootContent } from 'hast';
import { VFile } from 'vfile';
import { remarkChemfig, renderChemfig } from '../src/index.js';
import { examples } from './examples.js';

const processor = unified().use(remarkParse).use(remarkChemfig).use(remarkRehype);
const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const preview = document.querySelector<HTMLElement>('#preview')!;
const status = document.querySelector<HTMLElement>('#status')!;
const download = document.querySelector<HTMLButtonElement>('#download')!;
const name = document.querySelector<HTMLElement>('#structure-name')!;
const note = document.querySelector<HTMLElement>('#structure-note')!;
let currentSvg = '';
let currentName = 'Aspirin';

// Build DOM nodes directly from the plugin's HAST; source never becomes innerHTML.
function dom(node: RootContent, svg = false): Node {
  if (node.type === 'text') return document.createTextNode(node.value);
  if (node.type !== 'element') return document.createTextNode('');
  const isSvg = svg || node.tagName === 'svg';
  const element = isSvg
    ? document.createElementNS('http://www.w3.org/2000/svg', node.tagName)
    : document.createElement(node.tagName);
  const names: Record<string, string> = {
    className: 'class',
    ariaLabel: 'aria-label',
    ariaHidden: 'aria-hidden',
    fontFamily: 'font-family',
    fontSize: 'font-size',
    strokeWidth: 'stroke-width',
    strokeLinecap: 'stroke-linecap',
    strokeLinejoin: 'stroke-linejoin',
  };
  for (const [key, value] of Object.entries(node.properties)) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(names[key] ?? key, Array.isArray(value) ? value.join(' ') : String(value));
  }
  for (const child of node.children) element.appendChild(dom(child, isSvg));
  return element;
}

function update() {
  // Keep every edit inside one code node, including pasted Markdown fences.
  const fence = '`'.repeat(
    (source.value.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length + 1), 3),
  );
  const file = new VFile(`${fence}chemfig\n${source.value}\n${fence}`);
  const tree = processor.runSync(processor.parse(file), file) as Root;
  preview.replaceChildren(...tree.children.map((child) => dom(child)));
  const error = file.messages[0];
  status.dataset.error = String(!!error);
  download.disabled = !!error;
  if (error) {
    status.textContent = `${error.ruleId}: check the source above`;
    currentSvg = '';
  } else {
    const rendered = renderChemfig(source.value, {
      title: currentName === 'Custom structure' ? `Chemfig: ${source.value}` : currentName,
    });
    currentSvg = rendered.svg;
    status.textContent = `Rendered with remarkChemfig · ${rendered.layout.atoms.length} atom groups · ${rendered.layout.bonds.length} bonds`;
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    const example = examples[Number(button.dataset.example)]!;
    source.value = example.source;
    currentName = example.name;
    name.textContent = example.name;
    note.textContent = example.note;
    document
      .querySelectorAll('[data-example]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    update();
  });
});

source.addEventListener('input', () => {
  currentName = 'Custom structure';
  name.textContent = currentName;
  note.textContent = 'Your drawing, rendered from a Markdown fence in this browser.';
  document
    .querySelectorAll('[data-example]')
    .forEach((b) => b.setAttribute('aria-pressed', 'false'));
  update();
});

download.addEventListener('click', () => {
  if (!currentSvg) return;
  const url = URL.createObjectURL(new Blob([currentSvg], { type: 'image/svg+xml' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${currentName.toLowerCase().replace(/\s+/g, '-')}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
});

update();
