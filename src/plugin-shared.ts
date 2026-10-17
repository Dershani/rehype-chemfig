import type { Element, ElementContent } from 'hast';
import type { Node } from 'unist';
import type { VFile } from 'vfile';
import { ChemfigError } from './error.js';
import { renderChemfig } from './renderer.js';
import type { ChemfigOptions } from './types.js';

export function inlineSource(value: string): string | undefined {
  return /^chemfig:\s*/.test(value) ? value.replace(/^chemfig:\s*/, '') : undefined;
}

export function figure(
  source: string,
  display: boolean,
  options: ChemfigOptions,
  file: VFile,
  node: Node,
  caption?: string,
): Element {
  const tagName = display ? 'figure' : 'span';
  try {
    const result = renderChemfig(source, { ...options, ...(caption ? { title: caption } : {}) });
    const children: ElementContent[] = [result.tree];
    if (caption && display)
      children.push({
        type: 'element',
        tagName: 'figcaption',
        properties: {},
        children: [{ type: 'text', value: caption }],
      });
    return {
      type: 'element',
      tagName,
      properties: { className: ['chemfig', display ? 'chemfig-display' : 'chemfig-inline'] },
      children,
    };
  } catch (error) {
    if (!(error instanceof ChemfigError)) throw error;
    if (options.errorMode === 'throw') throw error;
    const message = file.message(error.message, {
      ...(node.position ? { place: node.position } : {}),
      source: 'chemfig',
      ruleId: error.code,
    });
    message.cause = error;
    const content: ElementContent[] = [
      {
        type: 'element',
        tagName: display ? 'p' : 'span',
        properties: { className: ['chemfig-error-message'] },
        children: [{ type: 'text', value: `Chemfig: ${error.message}` }],
      },
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [{ type: 'text', value: source }],
      },
    ];
    return {
      type: 'element',
      tagName: display ? 'div' : 'span',
      properties: { className: ['chemfig-error'], 'data-chemfig-error': error.code },
      children: content,
    };
  }
}
