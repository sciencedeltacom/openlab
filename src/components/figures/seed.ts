/**
 * Seed figures and the template library.
 *
 * The app opens with figures already in it — one per kind the studio can build — so the
 * gallery is a place you can read, and the studio is a place with something to open. Each
 * seed is a real document, not a placeholder: its elements are what the canvas draws.
 *
 * The templates are the same documents, emptied of a subject: a starting point per domain,
 * inserted wholesale and edited from there.
 */

import {
  PALETTE,
  blankDoc,
  moleculeExtent,
  newIcon,
  newMath,
  newMermaid,
  newMolecule,
  newPlot,
  newSequence,
  newShape,
  newTable,
  newText,
  uid,
  type Atom,
  type Bond,
  type Figure,
  type FigureDoc,
  type FigureElement,
  type MoleculeElement,
} from './types';

/** A ring of atoms, for the chemistry seeds and templates. */
function ring(cx: number, cy: number, radius: number, count: number, element = 'C'): Atom[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return {
      id: `a${index}`,
      el: element,
      x: Math.round(cx + radius * Math.cos(angle)),
      y: Math.round(cy + radius * Math.sin(angle)),
      charge: 0,
    };
  });
}

function ringBonds(count: number, orders: (1 | 2 | 3)[] = []): Bond[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `b${index}`,
    a: `a${index}`,
    b: `a${(index + 1) % count}`,
    order: orders[index % orders.length] ?? 1,
  }));
}

/**
 * Place a molecule so its box hugs its atoms.
 *
 * A structure is built in whatever coordinates the ring helper produces; this re-houses it
 * at `(ox, oy)` with a box that matches the drawing, so the selection outline and the
 * structure are the same rectangle.
 */
function placedMolecule(
  atoms: Atom[],
  bonds: Bond[],
  ox: number,
  oy: number,
  over: Partial<MoleculeElement> = {},
): MoleculeElement {
  const extent = moleculeExtent(atoms);
  return newMolecule({
    ...over,
    x: ox + extent.x,
    y: oy + extent.y,
    w: extent.w,
    h: extent.h,
    atoms: atoms.map((atom) => ({ ...atom, x: atom.x - extent.x, y: atom.y - extent.y })),
    bonds,
  });
}

/** A benzene ring with two heteroatom substituents: the default chemistry figure. */
function benzeneDoc(): FigureDoc {
  const atoms = ring(300, 220, 78, 6);
  const bonds = ringBonds(6, [2, 1, 2, 1, 2, 1]);
  atoms.push({ id: 'o1', el: 'O', x: 300, y: 90, charge: 0 });
  atoms.push({ id: 'n1', el: 'N', x: 300, y: 350, charge: 0 });
  bonds.push({ id: 'bo', a: 'a0', b: 'o1', order: 1 });
  bonds.push({ id: 'bn', a: 'a3', b: 'n1', order: 1 });

  return {
    ...blankDoc(640, 480),
    background: PALETTE.paper,
    elements: [
      newText('Phenol precursor', {
        x: 300,
        y: 30,
        w: 300,
        h: 32,
        fontSize: 20,
        fontWeight: 600,
        align: 'center',
      }),
      placedMolecule(atoms, bonds, 140, 110),
    ],
  };
}

/** A gene with two annotated features, for the genomics seed. */
function geneDoc(): FigureDoc {
  const sequence =
    'ATGGCTAGCTAGCTAGGCTAACCGTTAAGGCTTAGCTAGCTAGCATCGATCGGATCCGATTACGCGTAGCTAGCTAGGCTAACCGTTAAGGCTTAGCTAGCATCGATCG';
  return {
    ...blankDoc(),
    elements: [
      newText('TP53 locus, exon 4 to exon 6', {
        x: 60,
        y: 60,
        w: 560,
        h: 34,
        fontSize: 26,
        fontWeight: 600,
      }),
      newSequence({
        x: 60,
        y: 120,
        w: 760,
        h: 220,
        sequence,
        wrap: 60,
        features: [
          { id: uid(), start: 1, end: 40, label: 'Exon 4', color: PALETTE.blue, strand: 1 },
          { id: uid(), start: 61, end: 110, label: 'Exon 5', color: PALETTE.teal, strand: 1 },
        ],
      }),
      newText('Scale: 10 bp per character', {
        x: 60,
        y: 360,
        w: 400,
        h: 26,
        fontSize: 16,
        color: PALETTE.muted,
      }),
    ],
  };
}

export const SEED_FIGURES: Figure[] = [
  {
    id: 'F-101',
    caption:
      'Median tumour volume falls 42% on the combination arm by day 21 (n = 12 per arm; bars are interquartile range).',
    kind: 'Plot',
    format: 'PDF',
    size: '180 mm',
    script: 'results/figures/tumour-volume.py',
    data: 'figure-data/tumour-volume.csv',
    dpi: null,
    palette: 'Okabe–Ito',
    vector: true,
    updatedAt: Date.now() - 1000 * 60 * 60 * 26,
    doc: {
      ...blankDoc(),
      elements: [
        newShape('roundRect', {
          x: 40,
          y: 40,
          w: 1200,
          h: 720,
          fill: PALETTE.paper,
          stroke: PALETTE.line,
          strokeWidth: 1,
        }),
        newPlot({
          x: 90,
          y: 100,
          w: 560,
          h: 420,
          plotKind: 'bar',
          title: 'Tumour volume, day 21',
          yLabel: 'Volume (mm³)',
          xLabel: 'Arm',
          legend: true,
          series: [
            { label: 'Control', value: 620 },
            { label: 'Combination', value: 360 },
          ],
        }),
        newText('a', { x: 60, y: 52, w: 40, h: 34, fontSize: 30, fontWeight: 700 }),
        newText(
          'Bars show median with interquartile range. The combination arm is 42% below control after three weeks of dosing.',
          { x: 700, y: 110, w: 500, h: 200, fontSize: 24, fontWeight: 400, color: PALETTE.ink },
        ),
        newText('n = 12 per arm · two-sided Mann–Whitney, p = 0.004', {
          x: 700,
          y: 560,
          w: 520,
          h: 30,
          fontSize: 18,
          color: PALETTE.muted,
        }),
      ],
    },
  },
  {
    id: 'F-102',
    caption:
      'The variant-calling pipeline: raw reads are aligned, deduplicated and called, with a review gate before release.',
    kind: 'Diagram',
    format: 'SVG',
    size: '160 mm',
    script: '—',
    data: '—',
    dpi: null,
    palette: 'openlab',
    vector: true,
    updatedAt: Date.now() - 1000 * 60 * 60 * 50,
    doc: {
      ...blankDoc(),
      elements: [
        newMermaid({
          x: 80,
          y: 60,
          w: 1120,
          h: 640,
          source: [
            'flowchart LR',
            '  A[Raw reads] --> B[Align]',
            '  B --> C[Mark duplicates]',
            '  C --> D[Call variants]',
            '  D --> E{Pass QC?}',
            '  E -- yes --> F[Release]',
            '  E -- no --> G[Re-run]',
            '  G --> C',
          ].join('\n'),
        }),
      ],
    },
  },
  {
    id: 'F-103',
    caption:
      'Representative field of view: treated cells show enlarged nuclei and three mitotic figures per 10 µm field.',
    kind: 'Micrograph',
    format: 'TIFF',
    size: '85 mm',
    script: 'results/figures/field-of-view.py',
    data: 'figure-data/field-counts.csv',
    dpi: 600,
    palette: 'greyscale',
    vector: false,
    updatedAt: Date.now() - 1000 * 60 * 60 * 74,
    doc: {
      ...blankDoc(900, 620),
      background: '#FBFBFC',
      elements: [
        newShape('rect', {
          x: 0,
          y: 0,
          w: 900,
          h: 620,
          fill: '#EEF2F7',
          stroke: PALETTE.none,
          strokeWidth: 0,
        }),
        newIcon('cell', { x: 120, y: 120, w: 150, h: 150, color: PALETTE.blue, strokeWidth: 1.4 }),
        newIcon('cell', { x: 320, y: 200, w: 190, h: 190, color: '#5B7FB8', strokeWidth: 1.4 }),
        newIcon('cell', { x: 560, y: 120, w: 140, h: 140, color: PALETTE.blue, strokeWidth: 1.4 }),
        newIcon('cell', { x: 220, y: 380, w: 160, h: 160, color: '#5B7FB8', strokeWidth: 1.4 }),
        newIcon('nucleus', { x: 560, y: 360, w: 120, h: 120, color: PALETTE.violet, strokeWidth: 1.4 }),
        newShape('line', { x: 640, y: 540, w: 180, h: 0, stroke: PALETTE.ink, strokeWidth: 4 }),
        newText('10 µm', {
          x: 640,
          y: 556,
          w: 180,
          h: 26,
          fontSize: 18,
          align: 'center',
          color: PALETTE.ink,
        }),
        newText('a', { x: 24, y: 20, w: 40, h: 34, fontSize: 30, fontWeight: 700 }),
      ],
    },
  },
  {
    id: 'F-104',
    caption:
      'Ligand binding at the receptor drives nuclear translocation of the transcription factor within 30 minutes.',
    kind: 'Schematic',
    format: 'PDF',
    size: '180 mm',
    script: '—',
    data: '—',
    dpi: null,
    palette: 'openlab',
    vector: true,
    updatedAt: Date.now() - 1000 * 60 * 60 * 98,
    doc: {
      ...blankDoc(1200, 620),
      elements: [
        newText('Ligand', { x: 60, y: 120, w: 120, h: 30, fontSize: 22, fontWeight: 600, align: 'center' }),
        newIcon('receptor', { x: 60, y: 160, w: 120, h: 120, color: PALETTE.blue, strokeWidth: 1.6 }),
        newShape('arrow', { x: 200, y: 220, w: 160, h: 0, stroke: PALETTE.ink, strokeWidth: 3 }),
        newIcon('protein', { x: 380, y: 160, w: 120, h: 120, color: PALETTE.teal, strokeWidth: 1.6 }),
        newShape('arrow', { x: 520, y: 220, w: 160, h: 0, stroke: PALETTE.ink, strokeWidth: 3 }),
        newIcon('nucleus', { x: 700, y: 150, w: 150, h: 150, color: PALETTE.violet, strokeWidth: 1.6 }),
        newText('Nucleus', { x: 700, y: 320, w: 150, h: 30, fontSize: 20, align: 'center' }),
        newText('Transcription', { x: 890, y: 190, w: 260, h: 30, fontSize: 22, fontWeight: 600 }),
        newMath('\\mathrm{TF}_{n} \\rightarrow \\mathrm{mRNA}', {
          x: 890,
          y: 230,
          w: 260,
          h: 60,
          fontSize: 30,
        }),
        newText('within 30 min', { x: 890, y: 310, w: 260, h: 28, fontSize: 18, color: PALETTE.muted }),
      ],
    },
  },
  {
    id: 'F-105',
    caption: 'The phenol precursor, drawn with explicit heteroatoms; the ring is rendered aromatic.',
    kind: 'Structure',
    format: 'SVG',
    size: '90 mm',
    script: '—',
    data: '—',
    dpi: null,
    palette: 'monochrome',
    vector: true,
    updatedAt: Date.now() - 1000 * 60 * 60 * 120,
    doc: benzeneDoc(),
  },
  {
    id: 'F-106',
    caption: 'The TP53 locus with exons 4 and 5 annotated; the scale bar is ten base pairs per character.',
    kind: 'Sequence',
    format: 'PDF',
    size: '170 mm',
    script: '—',
    data: 'library/sources/tp53.fa',
    dpi: null,
    palette: 'base colours',
    vector: true,
    updatedAt: Date.now() - 1000 * 60 * 60 * 150,
    doc: geneDoc(),
  },
  {
    id: 'F-107',
    caption:
      'Model performance across the three holdout splits: the ensemble leads on AUROC while staying calibrated.',
    kind: 'Panel',
    format: 'PDF',
    size: '180 mm',
    script: 'results/figures/model-panel.py',
    data: 'figure-data/holdout-metrics.csv',
    dpi: null,
    palette: 'Okabe–Ito',
    vector: true,
    updatedAt: Date.now() - 1000 * 60 * 60 * 190,
    doc: {
      ...blankDoc(1280, 720),
      elements: [
        newPlot({
          x: 60,
          y: 90,
          w: 540,
          h: 360,
          plotKind: 'line',
          title: 'AUROC by split',
          xLabel: 'Split',
          yLabel: 'AUROC',
          series: [
            { label: 'S1', value: 0.71 },
            { label: 'S2', value: 0.76 },
            { label: 'S3', value: 0.74 },
          ],
        }),
        newPlot({
          x: 660,
          y: 90,
          w: 540,
          h: 360,
          plotKind: 'scatter',
          title: 'Calibration',
          xLabel: 'Predicted',
          yLabel: 'Observed',
          color: PALETTE.violet,
          accent: PALETTE.amber,
          series: [
            { label: '0.2', value: 0.18 },
            { label: '0.4', value: 0.42 },
            { label: '0.6', value: 0.57 },
            { label: '0.8', value: 0.79 },
          ],
        }),
        newText('a', { x: 30, y: 40, w: 40, h: 34, fontSize: 30, fontWeight: 700 }),
        newText('b', { x: 632, y: 40, w: 40, h: 34, fontSize: 30, fontWeight: 700 }),
        newTable({
          x: 60,
          y: 480,
          w: 1140,
          h: 180,
          columns: ['Model', 'AUROC', 'Calibration slope', 'Rank'],
          rows: [
            ['CRISPR-ensemble', '0.79', '0.96', '1'],
            ['Sequence-only', '0.72', '0.88', '2'],
            ['Chromatin-only', '0.68', '0.91', '3'],
          ],
          fontSize: 20,
        }),
      ],
    },
  },
  {
    id: 'F-108',
    caption: 'The review workflow as a sequence: submission, screening, and the two possible verdicts.',
    kind: 'Diagram',
    format: 'SVG',
    size: '160 mm',
    script: '—',
    data: '—',
    dpi: null,
    palette: 'openlab',
    vector: true,
    updatedAt: Date.now() - 1000 * 60 * 60 * 210,
    doc: {
      ...blankDoc(1160, 640),
      elements: [
        newMermaid({
          x: 60,
          y: 60,
          w: 1040,
          h: 520,
          source: [
            'sequenceDiagram',
            '  participant R as Reviewer',
            '  participant S as Screening',
            '  participant D as Data',
            '  R->>S: Submit manuscript',
            '  S->>D: Request source data',
            '  D-->>S: Data package',
            '  S-->>R: Verdict + notes',
          ].join('\n'),
        }),
      ],
    },
  },
];

/* ================================================================================================
 * Templates
 * ============================================================================================== */

export interface FigureTemplate {
  id: string;
  name: string;
  /** The domain it is aimed at, shown as the group heading. */
  domain: string;
  summary: string;
  /** Built fresh on insert, so two inserts are two documents. */
  build: () => FigureDoc;
}

export const TEMPLATES: FigureTemplate[] = [
  {
    id: 'blank',
    name: 'Blank sheet',
    domain: 'General',
    summary: 'A 1280×800 canvas with nothing on it.',
    build: () => ({ ...blankDoc(), elements: [] }),
  },
  {
    id: 'cell',
    name: 'Cell diagram',
    domain: 'Cell biology',
    summary: 'A cell with a nucleus, ready to label.',
    build: () => ({
      ...blankDoc(900, 640),
      elements: [
        newIcon('cell', { x: 260, y: 130, w: 380, h: 380, color: PALETTE.blue, strokeWidth: 1.2 }),
        newIcon('nucleus', { x: 380, y: 250, w: 140, h: 140, color: PALETTE.violet, strokeWidth: 1.4 }),
        newIcon('mitochondrion', { x: 300, y: 320, w: 110, h: 80, color: PALETTE.coral, strokeWidth: 1.4 }),
        newShape('line', { x: 640, y: 300, w: 120, h: -60, stroke: PALETTE.muted, strokeWidth: 1.5 }),
        newText('Nucleus', { x: 770, y: 230, w: 160, h: 30, fontSize: 20 }),
        newShape('line', { x: 410, y: 360, w: -160, h: 90, stroke: PALETTE.muted, strokeWidth: 1.5 }),
        newText('Mitochondrion', { x: 90, y: 450, w: 220, h: 30, fontSize: 20 }),
      ],
    }),
  },
  {
    id: 'pipeline',
    name: 'Analysis pipeline',
    domain: 'Bioinformatics',
    summary: 'A flowchart stub with three steps and a QC gate.',
    build: () => ({
      ...blankDoc(),
      elements: [
        newMermaid({
          x: 120,
          y: 120,
          w: 1040,
          h: 520,
          source:
            'flowchart LR\n  A[Input] --> B{Pass QC?}\n  B -- yes --> C[Analysis]\n  B -- no --> D[Reject]',
        }),
      ],
    }),
  },
  {
    id: 'consort',
    name: 'Consort flow',
    domain: 'Clinical',
    summary: 'Screening, allocation and follow-up as a flowchart.',
    build: () => ({
      ...blankDoc(),
      elements: [
        newMermaid({
          x: 60,
          y: 60,
          w: 1160,
          h: 680,
          source: [
            'flowchart TD',
            '  A[Assessed for eligibility] --> B{Excluded?}',
            '  B -- yes --> C[Record reasons]',
            '  B -- no --> D[Randomised]',
            '  D --> E[Treatment arm]',
            '  D --> F[Control arm]',
          ].join('\n'),
        }),
      ],
    }),
  },
  {
    id: 'timeseries',
    name: 'Time series',
    domain: 'General',
    summary: 'A line plot with axes and a legend.',
    build: () => ({
      ...blankDoc(900, 620),
      elements: [
        newPlot({
          x: 90,
          y: 90,
          w: 720,
          h: 420,
          plotKind: 'line',
          title: 'Signal over time',
          xLabel: 'Time (h)',
          yLabel: 'Response',
          legend: true,
          series: [
            { label: 'T0', value: 12 },
            { label: 'T1', value: 28 },
            { label: 'T2', value: 46 },
            { label: 'T3', value: 40 },
            { label: 'T4', value: 58 },
          ],
        }),
      ],
    }),
  },
  {
    id: 'chemistry',
    name: 'Benzene ring',
    domain: 'Chemistry',
    summary: 'An aromatic ring with an oxygen and a nitrogen substituent.',
    build: () => benzeneDoc(),
  },
  {
    id: 'gene',
    name: 'Gene track',
    domain: 'Genomics',
    summary: 'A sequence with two annotated features.',
    build: () => geneDoc(),
  },
  {
    id: 'quad',
    name: 'Four-panel',
    domain: 'General',
    summary: 'A 2×2 grid with a, b, c, d labels.',
    build: () => ({
      ...blankDoc(1200, 860),
      elements: [
        newPlot({ x: 70, y: 80, w: 480, h: 320, plotKind: 'bar' }),
        newPlot({ x: 650, y: 80, w: 480, h: 320, plotKind: 'line', color: PALETTE.teal }),
        newPlot({ x: 70, y: 480, w: 480, h: 320, plotKind: 'scatter', color: PALETTE.violet }),
        newPlot({ x: 650, y: 480, w: 480, h: 320, plotKind: 'area', color: PALETTE.amber }),
        newText('a', { x: 30, y: 34, w: 40, h: 34, fontSize: 30, fontWeight: 700 }),
        newText('b', { x: 610, y: 34, w: 40, h: 34, fontSize: 30, fontWeight: 700 }),
        newText('c', { x: 30, y: 434, w: 40, h: 34, fontSize: 30, fontWeight: 700 }),
        newText('d', { x: 610, y: 434, w: 40, h: 34, fontSize: 30, fontWeight: 700 }),
      ],
    }),
  },
];

/** Elements a figure of this kind starts with, when the user creates one. */
export function starterElements(kind: Figure['kind']): FigureElement[] {
  switch (kind) {
    case 'Plot':
      return [newPlot({ x: 120, y: 120, w: 520, h: 360 })];
    case 'Diagram':
      return [newMermaid({ x: 120, y: 120, w: 900, h: 520 })];
    case 'Schematic':
      return [
        newShape('roundRect', { x: 120, y: 160, w: 260, h: 140 }),
        newText('Step', { x: 150, y: 210, w: 200, h: 40 }),
      ];
    case 'Structure':
      return [placedMolecule(ring(160, 150, 78, 6), ringBonds(6, [2, 1, 2, 1, 2, 1]), 260, 180)];
    case 'Sequence':
      return [newSequence({ x: 100, y: 160, w: 760, h: 200 })];
    case 'Micrograph':
      return [
        newShape('rect', {
          x: 0,
          y: 0,
          w: 1280,
          h: 800,
          fill: '#EEF2F7',
          stroke: PALETTE.none,
          strokeWidth: 0,
        }),
        newIcon('cell', { x: 300, y: 240, w: 240, h: 240, color: PALETTE.blue }),
      ];
    default:
      return [newText('Panel a', { x: 80, y: 80, w: 320, h: 44, fontSize: 32, fontWeight: 700 })];
  }
}

/* ================================================================================================
 * Chemistry fragments and mermaid samples
 * ============================================================================================== */

export interface Fragment {
  id: string;
  name: string;
  summary: string;
  build: () => MoleculeElement;
}

export const FRAGMENTS: Fragment[] = [
  {
    id: 'benzene',
    name: 'Benzene',
    summary: 'Aromatic six-ring',
    build: () => placedMolecule(ring(100, 100, 62, 6), ringBonds(6, [2, 1, 2, 1, 2, 1]), 200, 180),
  },
  {
    id: 'pyridine',
    name: 'Pyridine',
    summary: 'Six-ring with one nitrogen',
    build: () => {
      const atoms = ring(100, 100, 62, 6);
      atoms[0] = { ...atoms[0]!, el: 'N' };
      return placedMolecule(atoms, ringBonds(6, [2, 1, 2, 1, 2, 1]), 200, 180);
    },
  },
  {
    id: 'cyclopentane',
    name: 'Cyclopentane',
    summary: 'Five-membered ring',
    build: () => placedMolecule(ring(100, 100, 62, 5), ringBonds(5), 200, 180),
  },
  {
    id: 'chain',
    name: 'Hexane chain',
    summary: 'A straight six-carbon chain',
    build: () => {
      const atoms = Array.from({ length: 6 }, (_, index) => ({
        id: `a${index}`,
        el: 'C',
        x: 30 + index * 56,
        y: 100 + (index % 2) * 28,
        charge: 0,
      }));
      const bonds = Array.from({ length: 5 }, (_, index) => ({
        id: `b${index}`,
        a: `a${index}`,
        b: `a${index + 1}`,
        order: 1 as const,
      }));
      return placedMolecule(atoms, bonds, 200, 180);
    },
  },
  {
    id: 'peptide',
    name: 'Peptide bond',
    summary: 'A dipeptide backbone fragment',
    build: () => {
      const atoms = [
        { id: 'c1', el: 'C', x: 40, y: 120, charge: 0 },
        { id: 'o1', el: 'O', x: 40, y: 200, charge: 0 },
        { id: 'n1', el: 'N', x: 140, y: 120, charge: 0 },
        { id: 'c2', el: 'C', x: 240, y: 120, charge: 0 },
        { id: 'o2', el: 'O', x: 320, y: 120, charge: 0 },
      ];
      const bonds = [
        { id: 'b1', a: 'c1', b: 'o1', order: 2 as const },
        { id: 'b2', a: 'c1', b: 'n1', order: 1 as const },
        { id: 'b3', a: 'n1', b: 'c2', order: 1 as const },
        { id: 'b4', a: 'c2', b: 'o2', order: 2 as const },
      ];
      return placedMolecule(atoms, bonds, 200, 180);
    },
  },
];

export interface MermaidSample {
  id: string;
  name: string;
  source: string;
}

export const MERMAID_SAMPLES: MermaidSample[] = [
  {
    id: 'flow',
    name: 'Flowchart',
    source: 'flowchart LR\n  A[Input] --> B{Pass QC?}\n  B -- yes --> C[Analysis]\n  B -- no --> D[Reject]',
  },
  {
    id: 'sequence',
    name: 'Sequence',
    source:
      'sequenceDiagram\n  participant R as Reviewer\n  participant S as Screening\n  R->>S: Submit\n  S-->>R: Verdict',
  },
  {
    id: 'state',
    name: 'State',
    source: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Settled\n  Settled --> [*]',
  },
  {
    id: 'class',
    name: 'Class',
    source: 'classDiagram\n  class Sample {\n    +string id\n    +run()\n  }\n  Sample <|-- Tumour',
  },
  {
    id: 'er',
    name: 'Entity relationship',
    source: 'erDiagram\n  SAMPLE ||--o{ RUN : has\n  RUN ||--|{ METRIC : yields',
  },
  {
    id: 'gantt',
    name: 'Gantt',
    source:
      'gantt\n  title Study timeline\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Enrol :a1, 2026-01-01, 60d\n  Assay :after a1, 30d',
  },
  {
    id: 'pie',
    name: 'Pie',
    source: 'pie title Reads by class\n  "Aligned" : 82\n  "Unmapped" : 12\n  "Duplicates" : 6',
  },
  {
    id: 'timeline',
    name: 'Timeline',
    source: 'timeline\n  title Review history\n  2024 : Draft\n  2025 : Major revision\n  2026 : Accepted',
  },
];
