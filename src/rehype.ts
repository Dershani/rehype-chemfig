import type { Element, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';
import { figure, inlineSource } from './plugin-shared.js';
import type { ChemfigOptions } from './types.js';

function codeValue(node: Element): string | undefined {
  return node.children.every((child) => child.type === 'text')
    ? node.children.map((child) => (child as { value: string }).value).join('')
    : undefined;
}
function isChemfig(node: Element) {
  const classes = node.properties.className;
  return Array.isArray(classes) && classes.includes('language-chemfig');
}

/** Run before syntax highlighting; matches literal code children, never raw HTML. */
export const rehypeChemfig: Plugin<[ChemfigOptions?], Root> = function (options = {}) {
  return (tree, file) => {
    const visit = (parent: Root | Element) => {
      for (let i = 0; i < parent.children.length; i++) {
        const node = parent.children[i];
        if (!node || node.type !== 'element') continue;
        const classes = node.properties.className;
        if (
          Array.isArray(classes) &&
          (classes.includes('chemfig') || classes.includes('chemfig-error'))
        )
          continue;
        if (node.tagName === 'pre') {
          const meaningful = node.children.filter(
            (child) => !(child.type === 'text' && !child.value.trim()),
          );
          const code = meaningful.length === 1 ? meaningful[0] : undefined;
          if (code?.type === 'element' && code.tagName === 'code' && isChemfig(code)) {
            const source = codeValue(code);
            if (source !== undefined) {
              parent.children[i] = figure(source.replace(/\n$/, ''), true, options, file, node);
              continue;
            }
          }
          // Ordinary code blocks must not be treated as inline code.
          continue;
        }
        if (node.tagName === 'code' && options.inline !== false) {
          const value = codeValue(node);
          const source = value === undefined ? undefined : inlineSource(value);
          if (source !== undefined) {
            parent.children[i] = figure(source, false, options, file, node) as RootContent;
            continue;
          }
        }
        visit(node);
      }
    };
    visit(tree);
  };
};

export default rehypeChemfig;
