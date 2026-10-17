import type { Root, Code, InlineCode, Data } from 'mdast';
import type { Node, Parent } from 'unist';
import type { Plugin } from 'unified';
import type { ElementContent, Properties } from 'hast';
import { figure, inlineSource } from './plugin-shared.js';
import type { ChemfigOptions } from './types.js';

declare module 'unist' {
  interface Data {
    chemfigProcessed?: boolean;
  }
}

export interface ChemfigMdastNode extends Node {
  type: 'chemfig';
  data: Data & { hName: string; hProperties: Properties; hChildren: ElementContent[] };
}

declare module 'mdast' {
  interface BlockContentMap {
    chemfig: ChemfigMdastNode;
  }
  interface PhrasingContentMap {
    chemfig: ChemfigMdastNode;
  }
  interface RootContentMap {
    chemfig: ChemfigMdastNode;
  }
}

/** Converts Chemfig code nodes to SVG through mdast's hName/hChildren bridge. */
export const remarkChemfig: Plugin<[ChemfigOptions?], Root> = function (options = {}) {
  return (tree, file) => {
    const visit = (node: Node, parent?: Parent, index?: number) => {
      if (node.type === 'code' || node.type === 'inlineCode') {
        const code = node as Code | InlineCode;
        if (code.data?.chemfigProcessed) return;
        const display = code.type === 'code';
        const source = display
          ? code.lang === 'chemfig'
            ? code.value
            : undefined
          : options.inline !== false
            ? inlineSource(code.value)
            : undefined;
        if (source !== undefined) {
          const rendered = figure(
            source,
            display,
            options,
            file,
            node,
            display ? (code.meta ?? undefined) : undefined,
          );
          if (parent && index !== undefined)
            parent.children[index] = {
              type: 'chemfig',
              ...(node.position ? { position: node.position } : {}),
              data: {
                ...code.data,
                chemfigProcessed: true,
                hName: rendered.tagName,
                hProperties: rendered.properties,
                hChildren: rendered.children,
              },
            } as ChemfigMdastNode;
          return;
        }
      }
      if ('children' in node)
        (node as Parent).children.forEach((child, i) => visit(child, node as Parent, i));
    };
    visit(tree);
  };
};

export default remarkChemfig;
