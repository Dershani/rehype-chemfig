import type { Element } from 'hast';

export interface ParseLimits {
  /** UTF-16 code units; default 20,000, hard maximum 200,000. */
  maxLength?: number;
  /** Branch, ring and label group nesting; default 32, hard maximum 64. */
  maxDepth?: number;
  /** Atom groups (including empty skeletal vertices); default 1,000, hard maximum 10,000.
   * Coincident fused-ring vertices may count separately while parsing. */
  maxAtoms?: number;
  /** Bonds, including distant connections; default 2,000, hard maximum 20,000. */
  maxBonds?: number;
}

export interface ParseOptions {
  limits?: ParseLimits;
}
export interface SourceRange {
  start: number;
  end: number;
}
export interface LabelRun {
  text: string;
  script: 'normal' | 'sub' | 'super';
}
/** Chemfig atoms are typographic pieces, not chemically validated elements. */
export interface AtomLabel {
  source: string;
  atoms: LabelRun[][];
}
export interface Angle {
  mode: 'absolute' | 'relative';
  degrees: number;
}
export interface BondOptions {
  angle?: Angle;
  length?: number;
  departure?: number;
  arrival?: number;
  invisible?: boolean;
}
export type BondKind = '-' | '=' | '~' | '>' | '<' | '>:' | '<:' | '>|' | '<|';
export interface BondSyntax extends SourceRange {
  type: 'bond';
  kind: BondKind;
  shift?: 'left' | 'right';
  options: BondOptions;
  label: AtomLabel;
}
export interface BranchSyntax extends SourceRange {
  type: 'branch';
  chain: ChainSyntax;
}
export interface RingSyntax extends SourceRange {
  type: 'ring';
  size: number;
  aromatic: boolean;
  chain: ChainSyntax;
}
export interface HookSyntax extends SourceRange {
  type: 'hook';
  name: string;
  kind: BondKind;
}
export type ChainItem = BondSyntax | BranchSyntax | RingSyntax | HookSyntax;
export interface ChainSyntax extends SourceRange {
  defaults: BondOptions;
  /** A leading options block was present, even if its fields were empty. */
  explicitDefaults?: boolean;
  initial: AtomLabel;
  items: ChainItem[];
}
export interface MoleculeSyntax {
  type: 'chemfig';
  source: string;
  chain: ChainSyntax;
}
export interface Point {
  x: number;
  y: number;
}
export interface LayoutRun extends LabelRun {
  x: number;
  y: number;
  width: number;
  fontSize: number;
}
export interface LayoutAtom extends Point {
  id: number;
  label: AtomLabel;
  /** Absolute centers of the typographic atoms within this group. */
  anchors: Point[];
  runs: LayoutRun[];
  bounds: { left: number; right: number; top: number; bottom: number };
}
export interface LayoutBond {
  from: number;
  to: number;
  departure: number;
  arrival: number;
  kind: BondKind;
  shift?: 'left' | 'right';
  invisible: boolean;
  ringSize?: number;
}
export interface LayoutRing {
  center: Point;
  radius: number;
  aromatic: boolean;
}
export interface MoleculeLayout {
  atoms: LayoutAtom[];
  bonds: LayoutBond[];
  rings: LayoutRing[];
  width: number;
  height: number;
  viewBox: [number, number, number, number];
}
export interface RenderOptions extends ParseOptions {
  /** Distance between connected typographic atom centers, in SVG units. Default 42. */
  bondLength?: number;
  fontSize?: number;
  strokeWidth?: number;
  bondSpacing?: number;
  padding?: number;
  /** Accessible description; source is used when omitted. */
  title?: string;
}
export interface RenderResult {
  tree: Element;
  svg: string;
  syntax: MoleculeSyntax;
  layout: MoleculeLayout;
}
export interface ChemfigOptions extends RenderOptions {
  /** Default: 'render' (visible error + original source). */
  errorMode?: 'render' | 'throw';
  /** Render inline code beginning with `chemfig:`, default true. */
  inline?: boolean;
}
