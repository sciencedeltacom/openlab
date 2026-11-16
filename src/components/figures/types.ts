/**
 * The figure document model.
 *
 * A figure is not a picture: it is a small vector document — a list of typed elements on a
 * fixed artboard — that can be edited, exported to SVG/PNG and regenerated. Everything a
 * renderer needs is in the document; a renderer is a pure function of one element.
 *
 * The artboard is the print frame: its units are the units of the export, so a 1280×800
 * document is a 1280×800 SVG. Nothing here knows about pixels on screen; the canvas applies
 * its own zoom.
 */

/** The element kinds the document can hold. */
export type ElementKind =
  'shape' | 'text' | 'math' | 'icon' | 'plot' | 'molecule' | 'sequence' | 'mermaid' | 'table';

/** The shapes one `shape` element can be. */
export type ShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'line'
  | 'arrow'
  | 'doubleArrow'
  | 'bracket'
  | 'brace';

/** Line-like shapes take `w` and `h` as a delta from the origin, not a size. */
export const LINE_SHAPES: readonly ShapeKind[] = ['line', 'arrow', 'doubleArrow'];

export function isLineShape(shape: ShapeKind): boolean {
  return LINE_SHAPES.includes(shape);
}

/** Fields every element carries. */
export interface BaseElement {
  id: string;
  kind: ElementKind;
  /** What the layer list calls it. */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, about the box centre. */
  rotation: number;
  /** 0–1. */
  opacity: number;
  locked: boolean;
  hidden: boolean;
  /** The study a mark is attributable to, when the element encodes a source. */
  source?: string;
}

export interface ShapeElement extends BaseElement {
  kind: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Corner radius for `roundRect`. */
  radius: number;
  dashed: boolean;
}

export interface TextElement extends BaseElement {
  kind: 'text';
  text: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  color: string;
  font: 'sans' | 'serif' | 'mono';
}

export interface MathElement extends BaseElement {
  kind: 'math';
  latex: string;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  display: boolean;
}

export interface IconElement extends BaseElement {
  kind: 'icon';
  /** An id from the icon catalogue. */
  iconId: string;
  color: string;
  strokeWidth: number;
}

export type PlotKind = 'bar' | 'line' | 'area' | 'scatter' | 'pie';

export interface PlotElement extends BaseElement {
  kind: 'plot';
  plotKind: PlotKind;
  series: { label: string; value: number }[];
  color: string;
  /** A second colour, for pies and two-tone series. */
  accent: string;
  axes: boolean;
  grid: boolean;
  legend: boolean;
  title: string;
  xLabel: string;
  yLabel: string;
}

export interface Atom {
  id: string;
  /** Element symbol: C, N, O, S, P, F, Cl, Br, I, … */
  el: string;
  /** Local coordinates, relative to the element origin. */
  x: number;
  y: number;
  /** Formal charge, drawn as a superscript. */
  charge: number;
}

export interface Bond {
  id: string;
  /** Atom ids. */
  a: string;
  b: string;
  /** 1 single, 2 double, 3 triple. */
  order: 1 | 2 | 3;
}

export interface MoleculeElement extends BaseElement {
  kind: 'molecule';
  atoms: Atom[];
  bonds: Bond[];
  color: string;
  /** Draw carbons, which a chemists' drawing leaves implicit. Off by default. */
  showCarbons: boolean;
}

export interface SeqFeature {
  id: string;
  start: number;
  end: number;
  label: string;
  color: string;
  /** Translation arrow (CDS) rather than a plain box. */
  strand: 1 | -1 | 0;
}

export interface SequenceElement extends BaseElement {
  kind: 'sequence';
  sequence: string;
  seqType: 'dna' | 'protein';
  features: SeqFeature[];
  color: string;
  /** Lines of residues per row. */
  wrap: number;
}

export interface MermaidElement extends BaseElement {
  kind: 'mermaid';
  source: string;
  /** `neutral` leaves mermaid's own palette; `theme` recolours it to the figure's. */
  tone: 'neutral' | 'ink';
}

export interface TableElement extends BaseElement {
  kind: 'table';
  columns: string[];
  rows: string[][];
  headerFill: string;
  color: string;
  fontSize: number;
  zebra: boolean;
}

export type FigureElement =
  | ShapeElement
  | TextElement
  | MathElement
  | IconElement
  | PlotElement
  | MoleculeElement
  | SequenceElement
  | MermaidElement
  | TableElement;

/** A document: the artboard and its elements, in z-order. */
export interface FigureDoc {
  width: number;
  height: number;
  background: string;
  elements: FigureElement[];
}

/** The kinds a figure is filed under. */
export type FigureKind = 'Plot' | 'Diagram' | 'Micrograph' | 'Schematic' | 'Structure' | 'Sequence' | 'Panel';

/** Export format a journal would receive. */
export type FigureFormat = 'PDF' | 'SVG' | 'PNG' | 'TIFF';

export interface Figure {
  id: string;
  caption: string;
  kind: FigureKind;
  format: FigureFormat;
  /** Width at final print size. */
  size: string;
  /** The generating script, for a generated output. Empty for a hand-built figure. */
  script: string;
  /** The data the figure reads. `—` when there is no data dependency. */
  data: string;
  /** Raster resolution; null for vector output. */
  dpi: number | null;
  palette: string;
  vector: boolean;
  /** Epoch ms, for the list's order and its "edited" line. */
  updatedAt: number;
  doc: FigureDoc;
}

/** The document as a file-safe name: the id and the first words of the caption. */
export function figureSlug(figure: Figure): string {
  const words = figure.caption
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join('-');
  return `${figure.id.toLowerCase()}-${words || 'figure'}`;
}

export const FIGURE_KINDS: readonly FigureKind[] = [
  'Plot',
  'Diagram',
  'Micrograph',
  'Schematic',
  'Structure',
  'Sequence',
  'Panel',
];

export const FIGURE_FORMATS: readonly FigureFormat[] = ['PDF', 'SVG', 'PNG', 'TIFF'];

/**
 * The drawing palette.
 *
 * Journal-safe and colour-blind-checked: distinguishable in greyscale and by hue. The two
 * blues are the brand's; the rest are the standard qualitative set a figure can live in.
 */
export const PALETTE = {
  ink: '#1F2933',
  muted: '#7B8794',
  line: '#CBD2D9',
  paper: '#FFFFFF',
  none: 'transparent',
  blue: '#1E5DB3',
  blueLight: '#94B2DB',
  teal: '#2FBF8F',
  amber: '#F2A93B',
  coral: '#E5534B',
  violet: '#7C5CFC',
  pink: '#E0679C',
  olive: '#8AA62F',
} as const;

export const SWATCHES: string[] = [
  PALETTE.ink,
  PALETTE.muted,
  PALETTE.line,
  PALETTE.blue,
  PALETTE.blueLight,
  PALETTE.teal,
  PALETTE.amber,
  PALETTE.coral,
  PALETTE.violet,
  PALETTE.pink,
  PALETTE.olive,
  PALETTE.paper,
];

/** A fresh id for an element, atom or bond. */
export function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** The default artboard. */
export const ARTBOARD = { width: 1280, height: 800 } as const;

/* ================================================================================================
 * Geometry
 * ============================================================================================== */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box an element occupies, with line deltas normalised to a positive extent. */
export function boundsOf(element: FigureElement): Box {
  if (element.kind === 'shape' && isLineShape(element.shape)) {
    const x = Math.min(element.x, element.x + element.w);
    const y = Math.min(element.y, element.y + element.h);
    return { x, y, w: Math.abs(element.w), h: Math.abs(element.h) };
  }
  return { x: element.x, y: element.y, w: element.w, h: element.h };
}

/** The eight resize handles, named by the corner or edge they sit on. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Where a handle sits in a box, in box-local 0–1 fractions. */
export const HANDLE_ANCHOR: Record<HandleId, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

/** Do two boxes overlap? */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** The union box of several elements, or null when there are none. */
export function unionBounds(elements: readonly FigureElement[]): Box | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const box = boundsOf(element);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Resize an element from one handle by a delta in artboard units.
 *
 * A line keeps its two endpoints; the handle moves whichever end it names, so dragging the
 * start is a different operation from dragging the box. Everything else moves the named
 * edges and keeps the opposite edge fixed.
 */
export function resizeElement(
  element: FigureElement,
  handle: HandleId,
  dx: number,
  dy: number,
): FigureElement {
  const min = 8;
  if (element.kind === 'shape' && isLineShape(element.shape)) {
    const start = handle === 'nw' || handle === 'w' || handle === 'sw';
    const end = handle === 'ne' || handle === 'e' || handle === 'se';
    if (start) {
      return { ...element, x: element.x + dx, y: element.y + dy, w: element.w - dx, h: element.h - dy };
    }
    if (end) {
      return { ...element, w: element.w + dx, h: element.h + dy };
    }
    return element;
  }

  const box = boundsOf(element);
  let { x, y, w, h } = box;
  const anchor = HANDLE_ANCHOR[handle];

  if (anchor.x === 1) w = Math.max(min, w + dx);
  if (anchor.x === 0) {
    const next = Math.max(min, w - dx);
    x += w - next;
    w = next;
  }
  if (anchor.y === 1) h = Math.max(min, h + dy);
  if (anchor.y === 0) {
    const next = Math.max(min, h - dy);
    y += h - next;
    h = next;
  }
  return { ...element, x, y, w, h };
}

/** The local bounding box of a molecule's atoms, padded a little for labels. */
export function moleculeExtent(atoms: readonly Atom[], pad = 18): Box {
  if (atoms.length === 0) return { x: pad, y: pad, w: pad * 2, h: pad * 2 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const atom of atoms) {
    minX = Math.min(minX, atom.x);
    minY = Math.min(minY, atom.y);
    maxX = Math.max(maxX, atom.x);
    maxY = Math.max(maxY, atom.y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/* ================================================================================================
 * Constructors — one per kind, with the defaults the insert tools use
 * ============================================================================================== */

function base(kind: ElementKind, name: string, over: Partial<BaseElement> = {}): BaseElement {
  return {
    id: uid(),
    kind,
    name,
    x: 80,
    y: 80,
    w: 200,
    h: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    ...over,
  };
}

export function newShape(shape: ShapeKind, over: Partial<ShapeElement> = {}): ShapeElement {
  const line = isLineShape(shape);
  return {
    ...base('shape', SHAPE_NAME[shape], over),
    kind: 'shape',
    shape,
    fill: line ? PALETTE.none : PALETTE.paper,
    stroke: PALETTE.ink,
    strokeWidth: 2,
    radius: 12,
    dashed: false,
    ...(line ? { w: 160, h: 0 } : {}),
    ...over,
  };
}

const SHAPE_NAME: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  roundRect: 'Panel',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  diamond: 'Decision',
  hexagon: 'Hexagon',
  line: 'Line',
  arrow: 'Arrow',
  doubleArrow: 'Double arrow',
  bracket: 'Bracket',
  brace: 'Brace',
};

export function newText(text = 'Label', over: Partial<TextElement> = {}): TextElement {
  return {
    ...base('text', text.slice(0, 24) || 'Text'),
    kind: 'text',
    text,
    fontSize: 28,
    fontWeight: 500,
    italic: false,
    align: 'left',
    color: PALETTE.ink,
    font: 'sans',
    w: Math.max(120, text.length * 16),
    h: 40,
    ...over,
  };
}

export function newMath(latex = 'E = mc^2', over: Partial<MathElement> = {}): MathElement {
  return {
    ...base('math', 'Equation'),
    kind: 'math',
    latex,
    fontSize: 32,
    color: PALETTE.ink,
    align: 'center',
    display: false,
    w: 220,
    h: 56,
    ...over,
  };
}

export function newIcon(iconId: string, over: Partial<IconElement> = {}): IconElement {
  return {
    ...base('icon', 'Icon'),
    kind: 'icon',
    iconId,
    color: PALETTE.blue,
    strokeWidth: 1.5,
    w: 96,
    h: 96,
    ...over,
  };
}

export function newPlot(over: Partial<PlotElement> = {}): PlotElement {
  return {
    ...base('plot', 'Plot'),
    kind: 'plot',
    plotKind: 'bar',
    series: [
      { label: 'A', value: 42 },
      { label: 'B', value: 68 },
      { label: 'C', value: 55 },
      { label: 'D', value: 81 },
    ],
    color: PALETTE.blue,
    accent: PALETTE.coral,
    axes: true,
    grid: true,
    legend: false,
    title: '',
    xLabel: '',
    yLabel: '',
    w: 360,
    h: 240,
    ...over,
  };
}

export function newMolecule(over: Partial<MoleculeElement> = {}): MoleculeElement {
  return {
    ...base('molecule', 'Structure'),
    kind: 'molecule',
    atoms: [],
    bonds: [],
    color: PALETTE.ink,
    showCarbons: false,
    w: 220,
    h: 200,
    ...over,
  };
}

export function newSequence(over: Partial<SequenceElement> = {}): SequenceElement {
  return {
    ...base('sequence', 'Sequence'),
    kind: 'sequence',
    sequence: 'ATGGCTAGCTAGCTAGGCTAACCGTTAAGGCTTAGCTAGCTAGCATCGATCGGATC',
    seqType: 'dna',
    features: [],
    color: PALETTE.blue,
    wrap: 60,
    w: 520,
    h: 120,
    ...over,
  };
}

export function newMermaid(over: Partial<MermaidElement> = {}): MermaidElement {
  return {
    ...base('mermaid', 'Diagram'),
    kind: 'mermaid',
    source: 'flowchart LR\n  A[Sample] --> B[Align]\n  B --> C[Call peaks]\n  C --> D[Figure]',
    tone: 'neutral',
    w: 520,
    h: 320,
    ...over,
  };
}

export function newTable(over: Partial<TableElement> = {}): TableElement {
  return {
    ...base('table', 'Table'),
    kind: 'table',
    columns: ['Group', 'n', 'Effect'],
    rows: [
      ['Control', '24', '—'],
      ['Treated', '26', '1.8×'],
    ],
    headerFill: PALETTE.blue,
    color: PALETTE.ink,
    fontSize: 18,
    zebra: true,
    w: 360,
    h: 160,
    ...over,
  };
}

/** A blank document with a background like the paper. */
export function blankDoc(width: number = ARTBOARD.width, height: number = ARTBOARD.height): FigureDoc {
  return { width, height, background: PALETTE.paper, elements: [] };
}
