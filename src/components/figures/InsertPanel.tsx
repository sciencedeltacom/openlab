/**
 * The insert panel.
 *
 * A rail of categories down the left, and that category's shelf beside it: Canva's shape,
 * with the shelves filled from this lab's own material — templates, shapes, text, equations,
 * bio icons, structures, sequences, diagrams, plots and tables.
 *
 * Every item draws a real preview from the element it will place, so the shelf shows the
 * figure rather than a word for it. One search field sits above the shelf and narrows every
 * category at once.
 */

import { useMemo, useState, type ReactNode } from 'react';
import katex from 'katex';
import {
  Atom,
  Dna,
  LayoutTemplate,
  Search,
  Sigma,
  Sprout,
  Square,
  Table2,
  Type,
  Workflow,
  ChartColumn,
  type LucideIcon,
} from 'lucide-react';

import { Input, ScrollShadow, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { IconGlyph, ICON_CATEGORIES, searchIcons, type IconCategory } from './icons';
import { Artboard, ElementView } from './render';
import { FRAGMENTS, MERMAID_SAMPLES, TEMPLATES } from './seed';
import {
  PALETTE,
  newIcon,
  newMath,
  newMermaid,
  newPlot,
  newSequence,
  newShape,
  newTable,
  newText,
  type FigureDoc,
  type FigureElement,
  type ShapeKind,
} from './types';

/* ================================================================================================
 * Previews
 * ============================================================================================== */

/** An element drawn small, as its own thumbnail. */
export function ElementThumb({ element, className }: { element: FigureElement; className?: string }) {
  const w = Math.max(40, element.w || 40);
  const h = Math.max(30, element.h || 30);
  return (
    <svg
      viewBox={`-6 -6 ${w + 12} ${h + 12}`}
      className={cn('size-full', className)}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <ElementView
        element={{ ...element, x: 0, y: 0, rotation: 0, opacity: 1, hidden: false }}
        context={{}}
      />
    </svg>
  );
}

/** A whole document drawn small. */
function DocThumb({ doc }: { doc: FigureDoc }) {
  return (
    <svg
      viewBox={`0 0 ${doc.width} ${doc.height}`}
      className="size-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <Artboard doc={doc} context={{}} />
    </svg>
  );
}

/* ================================================================================================
 * The shelves
 * ============================================================================================== */

type CategoryId =
  | 'templates'
  | 'shapes'
  | 'text'
  | 'equations'
  | 'icons'
  | 'structure'
  | 'sequence'
  | 'diagram'
  | 'plot'
  | 'table';

interface Category {
  id: CategoryId;
  label: string;
  icon: LucideIcon;
}

const CATEGORIES: Category[] = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'shapes', label: 'Shapes', icon: Square },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'equations', label: 'Equation', icon: Sigma },
  { id: 'icons', label: 'Icons', icon: Sprout },
  { id: 'structure', label: 'Structure', icon: Atom },
  { id: 'sequence', label: 'Sequence', icon: Dna },
  { id: 'diagram', label: 'Diagram', icon: Workflow },
  { id: 'plot', label: 'Plot', icon: ChartColumn },
  { id: 'table', label: 'Table', icon: Table2 },
];

/** One thing to place: what it is called, how it looks, and what it makes. */
interface Item {
  id: string;
  label: string;
  preview: ReactNode;
  /** A tall preview, for a whole document. */
  wide?: boolean;
  /** Place it. The preview comes back with it, for the studio to announce. */
  insert: (preview: ReactNode) => void;
}

const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'roundRect', label: 'Panel' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Decision' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'line', label: 'Line' },
  { kind: 'arrow', label: 'Arrow' },
  { kind: 'doubleArrow', label: 'Double arrow' },
  { kind: 'bracket', label: 'Bracket' },
  { kind: 'brace', label: 'Brace' },
];

const TEXTS: { label: string; sample: string; over: Parameters<typeof newText>[1] }[] = [
  { label: 'Heading', sample: 'Heading', over: { fontSize: 32, fontWeight: 700, w: 380, h: 46 } },
  { label: 'Subheading', sample: 'Subheading', over: { fontSize: 24, fontWeight: 600, w: 320, h: 38 } },
  { label: 'Body', sample: 'Body text', over: { fontSize: 18, fontWeight: 400, w: 320, h: 34 } },
  {
    label: 'Caption',
    sample: 'Caption',
    over: { fontSize: 14, fontWeight: 400, color: PALETTE.muted, w: 260, h: 28 },
  },
  { label: 'Panel label', sample: 'a', over: { fontSize: 30, fontWeight: 700, w: 40, h: 34 } },
  {
    label: 'Axis label',
    sample: 'Axis',
    over: { fontSize: 16, fontWeight: 500, align: 'center' as const, w: 160, h: 30 },
  },
];

const EQUATIONS: { label: string; latex: string }[] = [
  { label: 'Mass–energy', latex: 'E = mc^{2}' },
  { label: 'Fraction', latex: '\\frac{a}{b}' },
  { label: 'Sum', latex: '\\sum_{i=1}^{n} x_i' },
  { label: 'Integral', latex: '\\int_0^{\\infty} e^{-x^2}\\,dx' },
  { label: 'Mean', latex: '\\bar{x} = \\frac{1}{n}\\sum x_i' },
  { label: 'Hypothesis', latex: 'H_0 : \\mu_1 = \\mu_2' },
  { label: 'Matrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: 'Blank', latex: '' },
];

const SEQUENCES: { label: string; over: Parameters<typeof newSequence>[0] }[] = [
  { label: 'DNA', over: { seqType: 'dna', wrap: 60 } },
  {
    label: 'Protein',
    over: {
      seqType: 'protein',
      wrap: 50,
      sequence: 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKA',
    },
  },
  {
    label: 'Gene + features',
    over: {
      seqType: 'dna',
      wrap: 60,
      sequence:
        'ATGGCTAGCTAGCTAGGCTAACCGTTAAGGCTTAGCTAGCTAGCATCGATCGGATCCGATTACGCGTAGCTAGCTAGGCTAACCGTTAAGGCTTAGCTAGCATCGATCG',
      features: [
        { id: 'f1', start: 1, end: 40, label: 'Exon 1', color: PALETTE.blue, strand: 1 as const },
        { id: 'f2', start: 61, end: 110, label: 'Exon 2', color: PALETTE.teal, strand: 1 as const },
      ],
    },
  },
];

const TABLES: { label: string; over: Parameters<typeof newTable>[0] }[] = [
  {
    label: 'Comparison',
    over: {
      columns: ['Group', 'n', 'Effect'],
      rows: [
        ['Control', '24', '—'],
        ['Treated', '26', '1.8×'],
      ],
    },
  },
  {
    label: 'Metrics',
    over: {
      columns: ['Metric', 'Value'],
      rows: [
        ['AUROC', '0.79'],
        ['Calibration', '0.96'],
        ['Sensitivity', '0.82'],
      ],
    },
  },
  {
    label: 'Dose groups',
    over: {
      columns: ['Dose', 'Response', 'n'],
      rows: [
        ['0 mg/kg', '12', '8'],
        ['5 mg/kg', '38', '8'],
        ['20 mg/kg', '61', '8'],
      ],
    },
  },
];

/** The icon library, as a searchable grid — used to change the icon of a selected element. */
export function IconPicker({
  query,
  onQuery,
  selectedId,
  onPick,
}: {
  query: string;
  onQuery: (query: string) => void;
  selectedId?: string;
  onPick: (id: string) => void;
}) {
  const [category, setCategory] = useState<IconCategory | 'All'>('All');
  const results = useMemo(() => searchIcons(query, category), [query, category]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted" aria-hidden />
        <Input
          fullWidth
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search icons"
          aria-label="Search icons"
          className="pl-8"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {(['All', ...ICON_CATEGORIES] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setCategory(name as IconCategory | 'All')}
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[10px] transition-colors',
              category === name
                ? 'bg-accent text-accent-foreground'
                : 'bg-surface text-muted hover:text-foreground',
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <ScrollShadow style={{ maxHeight: 200 }}>
        <div className="grid grid-cols-6 gap-0.5 pr-0.5">
          {results.slice(0, 120).map((icon) => (
            <button
              key={icon.id}
              type="button"
              title={`${icon.name} · ${icon.category}`}
              onClick={() => onPick(icon.id)}
              className={cn(
                'grid aspect-square place-items-center rounded-md border p-1.5 transition-colors',
                selectedId === icon.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-transparent text-foreground hover:bg-surface',
              )}
            >
              <IconGlyph id={icon.id} className="size-full" strokeWidth={1.6} />
            </button>
          ))}
        </div>
        {results.length === 0 && (
          <p className="px-1 py-4 text-center text-meta text-muted">No icon matches.</p>
        )}
      </ScrollShadow>
    </div>
  );
}

export interface InsertPanelProps {
  /** Insert a whole document's elements into the current figure. */
  onInsertTemplate: (build: () => FigureDoc, name: string, preview?: ReactNode) => void;
  /** Place a single element at the centre of the view. */
  onInsertElement: (element: FigureElement, preview?: ReactNode) => void;
  onInsertFragment: (build: () => FigureElement, name: string, preview?: ReactNode) => void;
  /** The icon the Icon tool will place, kept in step with the library. */
  iconId: string;
  onIconId: (id: string) => void;
}

export function InsertPanel({
  onInsertTemplate,
  onInsertElement,
  onInsertFragment,
  iconId,
  onIconId,
}: InsertPanelProps) {
  const [category, setCategory] = useState<CategoryId>('templates');
  const [query, setQuery] = useState('');
  const [iconCategory, setIconCategory] = useState<IconCategory | 'All'>('All');
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  // The shelves are built once: a preview is a drawing, and a template is a document.
  const templates = useMemo(() => TEMPLATES.map((template) => ({ ...template, doc: template.build() })), []);
  const fragments = useMemo(
    () => FRAGMENTS.map((fragment) => ({ ...fragment, element: fragment.build() })),
    [],
  );
  const icons = useMemo(() => searchIcons(needle, iconCategory), [needle, iconCategory]);

  /** The items of one shelf. Icons are their own block, so they are not here. */
  const itemsFor = (id: CategoryId): Item[] => {
    switch (id) {
      case 'templates':
        return templates.map((template) => ({
          id: template.id,
          label: template.name,
          wide: true,
          preview: <DocThumb doc={template.doc} />,
          insert: (preview) => onInsertTemplate(() => template.doc, template.name, preview),
        }));
      case 'shapes':
        return SHAPES.map((shape) => {
          const element = newShape(shape.kind, { w: 200, h: 130 });
          return {
            id: shape.kind,
            label: shape.label,
            preview: <ElementThumb element={element} />,
            insert: (preview) => onInsertElement(element, preview),
          };
        });
      case 'text':
        return TEXTS.map((preset) => {
          const element = newText(preset.sample, preset.over);
          return {
            id: preset.label,
            label: preset.label,
            preview: (
              <span
                className="px-1 text-foreground"
                style={{
                  fontSize: Math.min(26, preset.over?.fontSize ?? 18),
                  fontWeight: preset.over?.fontWeight ?? 400,
                  color: preset.over?.color,
                }}
              >
                {preset.sample}
              </span>
            ),
            insert: (preview) => onInsertElement(element, preview),
          };
        });
      case 'equations':
        return EQUATIONS.map((equation) => ({
          id: equation.label,
          label: equation.label,
          preview: (
            <span
              className="text-foreground"
              style={{ fontSize: 15 }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{
                __html: equation.latex
                  ? katex.renderToString(equation.latex, { throwOnError: false, output: 'html' })
                  : '<span style="color:var(--muted)">Custom…</span>',
              }}
            />
          ),
          insert: (preview) => onInsertElement(newMath(equation.latex || 'x = y'), preview),
        }));
      case 'structure':
        return fragments.map((fragment) => ({
          id: fragment.id,
          label: fragment.name,
          preview: <ElementThumb element={fragment.element} />,
          insert: (preview) => onInsertFragment(() => fragment.element, fragment.name, preview),
        }));
      case 'sequence':
        return SEQUENCES.map((preset) => {
          const element = newSequence(preset.over);
          return {
            id: preset.label,
            label: preset.label,
            wide: true,
            preview: <ElementThumb element={element} />,
            insert: (preview) => onInsertElement(element, preview),
          };
        });
      case 'diagram':
        return MERMAID_SAMPLES.map((sample) => {
          const element = newMermaid({ source: sample.source });
          return {
            id: sample.id,
            label: sample.name,
            preview: <ElementThumb element={{ ...element, w: 320, h: 200 }} />,
            insert: (preview) =>
              onInsertElement(newMermaid({ source: sample.source, w: 640, h: 400 }), preview),
          };
        });
      case 'plot':
        return (['bar', 'line', 'area', 'scatter', 'pie'] as const).map((kind) => {
          const element = newPlot({
            plotKind: kind,
            title: '',
            legend: false,
            series: [
              { label: 'A', value: 42 },
              { label: 'B', value: 68 },
              { label: 'C', value: 55 },
              { label: 'D', value: 81 },
            ],
          });
          return {
            id: kind,
            label: kind.charAt(0).toUpperCase() + kind.slice(1),
            preview: <ElementThumb element={{ ...element, w: 300, h: 190 }} />,
            insert: (preview) => onInsertElement(newPlot({ plotKind: kind, w: 480, h: 320 }), preview),
          };
        });
      case 'table':
        return TABLES.map((preset) => {
          const element = newTable(preset.over);
          return {
            id: preset.label,
            label: preset.label,
            preview: <ElementThumb element={element} />,
            insert: (preview) => onInsertElement(element, preview),
          };
        });
      case 'icons':
        return [];
    }
  };

  const matches = (id: CategoryId): Item[] => {
    const items = itemsFor(id);
    if (!searching) return items;
    return items.filter((item) => item.label.toLowerCase().includes(needle));
  };

  const shelves: { id: CategoryId; items: Item[] }[] = searching
    ? CATEGORIES.map((entry) => ({ id: entry.id, items: matches(entry.id) })).filter(
        (shelf) => shelf.items.length > 0,
      )
    : [{ id: category, items: itemsFor(category) }];

  const showIcons = category === 'icons' || (searching && icons.length > 0);

  return (
    <div className="flex h-full min-h-0">
      {/* The rail: one category per stop, the way a shelf is chosen before it is browsed. */}
      <nav
        aria-label="Library"
        className="flex w-[64px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-separator py-2"
      >
        {CATEGORIES.map((entry) => {
          const Icon = entry.icon;
          const active = !searching && category === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setQuery('');
                setCategory(entry.id);
              }}
              className="flex w-full flex-col items-center gap-0.5 py-0.5"
            >
              <span
                className={cn(
                  'grid size-9 place-items-center rounded-xl transition-colors',
                  active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className={cn('text-[10px] leading-tight', active ? 'text-foreground' : 'text-muted')}>
                {entry.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex shrink-0 items-center p-2.5 pb-1.5">
          <Search className="pointer-events-none absolute left-5 size-3.5 text-muted" aria-hidden />
          <Input
            fullWidth
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the library"
            aria-label="Search the library"
            className="pl-8"
          />
        </div>

        <ScrollShadow className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-2.5 pt-1.5">
            {shelves.map((shelf) => (
              <section key={shelf.id} className="flex flex-col gap-1.5">
                <SectionLabel>{CATEGORIES.find((entry) => entry.id === shelf.id)?.label}</SectionLabel>
                <div
                  className={cn(
                    'grid gap-1.5',
                    shelf.items.some((item) => item.wide) ? 'grid-cols-2' : 'grid-cols-3',
                  )}
                >
                  {shelf.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      title={item.label}
                      onClick={() => item.insert(item.preview)}
                      className="group flex flex-col gap-1 text-left"
                    >
                      <span
                        className={cn(
                          'grid place-items-center overflow-hidden rounded-lg bg-surface p-1.5 transition-colors group-hover:bg-surface-secondary',
                          item.wide ? 'aspect-[4/3]' : 'aspect-square',
                        )}
                      >
                        <span className="grid size-full place-items-center">{item.preview}</span>
                      </span>
                      <span className="truncate px-0.5 text-[10px] text-muted group-hover:text-foreground">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {showIcons && (
              <section className="flex flex-col gap-1.5">
                <SectionLabel>Icons</SectionLabel>
                <div className="flex flex-wrap gap-1">
                  {(['All', ...ICON_CATEGORIES] as const).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setIconCategory(name as IconCategory | 'All')}
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[10px] transition-colors',
                        iconCategory === name
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-surface text-muted hover:text-foreground',
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <ScrollShadow style={{ maxHeight: 320 }}>
                  <div className="grid grid-cols-6 gap-0.5 pr-0.5">
                    {icons.slice(0, 140).map((icon) => (
                      <button
                        key={icon.id}
                        type="button"
                        title={`${icon.name} · ${icon.category}`}
                        onClick={() => {
                          onIconId(icon.id);
                          onInsertElement(
                            newIcon(icon.id, { color: PALETTE.blue }),
                            <span className="text-accent">
                              <IconGlyph id={icon.id} className="size-full" strokeWidth={1.6} />
                            </span>,
                          );
                        }}
                        className={cn(
                          'grid aspect-square place-items-center rounded-md border p-1.5 transition-colors',
                          iconId === icon.id
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-transparent text-foreground hover:bg-surface',
                        )}
                      >
                        <IconGlyph id={icon.id} className="size-full" strokeWidth={1.6} />
                      </button>
                    ))}
                  </div>
                  {icons.length === 0 && (
                    <p className="px-1 py-4 text-center text-meta text-muted">No icon matches.</p>
                  )}
                </ScrollShadow>
              </section>
            )}

            {searching && shelves.length === 0 && !showIcons && (
              <p className="px-1 py-8 text-center text-meta text-muted">Nothing matches “{query}”.</p>
            )}
          </div>
        </ScrollShadow>
      </div>
    </div>
  );
}
