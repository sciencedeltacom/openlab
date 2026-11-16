/**
 * The figure gallery.
 *
 * A figure is a document — a caption, a provenance record and a vector body you can open in
 * the studio. The gallery is the index: search over the caption and the study, a facet
 * popover, cards grouped by kind, and a drawer that carries the provenance a reader opens a
 * figure for.
 *
 * Everything here is live: a figure created, renamed, duplicated or removed is kept, because
 * the studio writes to the same store this list reads.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Filter,
  FlaskConical,
  LayoutGrid,
  Microscope,
  Network,
  Pencil,
  PencilRuler,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Waypoints,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';

import {
  Button,
  Chip,
  Dialog,
  Drawer,
  IconButton,
  Input,
  Label,
  Popover,
  ScrollShadow,
  SectionLabel,
  Select,
  Tabs,
  TextArea,
} from '@/components/ui';
import { RenameModal, RowMenu, type RowAction } from '@/components/common/RowMenu';
import { useApp, usePageTitle } from '@/store/app';
import { useCopy } from '@/hooks/useCopy';
import { useDebounced } from '@/hooks/useDebounced';
import { useFacetFilter, type FacetDef } from '@/hooks/useFacetFilter';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { MOTION } from '@/theme/tokens';
import {
  addExampleFigures,
  createFigure,
  duplicateFigure,
  patchFigure,
  removeFigure,
  restoreFigure,
  useFigures,
} from './store';
import { FIGURE_FORMATS, FIGURE_KINDS, type Figure, type FigureFormat, type FigureKind } from './types';

/** The icon a kind wears in the group heading and the drawer. */
const KIND_ICON: Record<FigureKind, LucideIcon> = {
  Plot: Workflow,
  Diagram: Network,
  Micrograph: Microscope,
  Schematic: Waypoints,
  Structure: FlaskConical,
  Sequence: Waypoints,
  Panel: LayoutGrid,
};

/** The mono-ish chip that names an artefact path. */
function PathPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block max-w-full truncate rounded-sm bg-surface px-1.5 py-0.5 text-meta text-muted">
      {children}
    </span>
  );
}

/** One fact in the drawer: a label and a value. */
function DrawerFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-[92px] shrink-0 pt-0.5 text-meta text-muted">{label}</span>
      <span className="min-w-0 flex-1 text-body text-foreground">{children}</span>
    </div>
  );
}

/**
 * A stable number from a string.
 *
 * The preview is deterministic — the same figure draws the same shape every render — and
 * different between figures, which is the point: a gallery where every plot is one drawing
 * tells you nothing about which figure you are looking at.
 */
function seedOf(text: string): number {
  let value = 7;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) % 100_003;
  }
  return value;
}

/** A rising series with a per-figure wobble, in the plot's coordinate space. */
function plotPoints(seed: number): { x: number; y: number }[] {
  return Array.from({ length: 8 }, (_, index) => {
    const wobble = ((seed >> (index % 12)) % 13) - 6;
    const slope = (seed % 7) + 4;
    return {
      x: 24 + index * 17.4,
      y: Math.max(12, Math.min(80, 78 - index * slope + wobble)),
    };
  });
}

/**
 * A drawn preview for a figure.
 *
 * Not the artwork: a small shape that says what the figure is, so the gallery reads before
 * the drawer is opened. Colour comes from the surrounding text tone via `currentColor`, and
 * the shape from the figure's own id.
 */
function FigurePreview({ kind, seed = '' }: { kind: FigureKind; seed?: string }) {
  switch (kind) {
    case 'Plot': {
      const points = plotPoints(seedOf(seed));
      return (
        <svg
          viewBox="0 0 160 100"
          className="size-full text-accent"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Plot preview"
        >
          <g className="text-muted" opacity="0.45">
            <line x1="20" y1="12" x2="20" y2="82" stroke="currentColor" strokeWidth="1" />
            <line x1="20" y1="82" x2="150" y2="82" stroke="currentColor" strokeWidth="1" />
          </g>
          <polyline
            points={points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          {points.map((point) => (
            <circle key={point.x} cx={point.x} cy={point.y} r="2.6" fill="currentColor" />
          ))}
        </svg>
      );
    }
    case 'Diagram':
      return (
        <svg
          viewBox="0 0 160 100"
          className="size-full text-accent"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Diagram preview"
        >
          {[
            { x: 8, y: 38 },
            { x: 62, y: 14 },
            { x: 62, y: 62 },
            { x: 116, y: 38 },
          ].map((box) => (
            <rect
              key={`${box.x}-${box.y}`}
              x={box.x}
              y={box.y}
              width="36"
              height="24"
              rx="6"
              fill="currentColor"
              opacity="0.16"
            />
          ))}
          <g stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.7">
            <path d="M44 50 L62 26" />
            <path d="M44 50 L62 74" />
            <path d="M98 26 L116 50" />
            <path d="M98 74 L116 50" />
          </g>
          <g className="text-foreground" fill="currentColor" opacity="0.8">
            <rect x="12" y="46" width="20" height="3" rx="1.5" />
            <rect x="66" y="22" width="20" height="3" rx="1.5" />
            <rect x="66" y="70" width="20" height="3" rx="1.5" />
            <rect x="120" y="46" width="20" height="3" rx="1.5" />
          </g>
        </svg>
      );
    case 'Micrograph':
      return (
        <svg
          viewBox="0 0 160 100"
          className="size-full text-accent"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Micrograph preview"
        >
          <rect
            x="8"
            y="10"
            width="144"
            height="80"
            rx="8"
            className="text-foreground"
            fill="currentColor"
            opacity="0.08"
          />
          <g fill="currentColor" opacity="0.5">
            <ellipse cx="48" cy="42" rx="15" ry="10" />
            <ellipse cx="86" cy="58" rx="18" ry="11" />
            <ellipse cx="118" cy="38" rx="12" ry="8" />
            <ellipse cx="66" cy="72" rx="10" ry="7" />
          </g>
          <g className="text-foreground" fill="currentColor" opacity="0.7">
            <circle cx="48" cy="42" r="3" />
            <circle cx="86" cy="58" r="3" />
            <circle cx="118" cy="38" r="2.5" />
          </g>
          <line x1="118" y1="82" x2="146" y2="82" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'Schematic':
      return (
        <svg
          viewBox="0 0 160 100"
          className="size-full text-accent"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Schematic preview"
        >
          <rect x="12" y="42" width="42" height="18" rx="5" fill="currentColor" opacity="0.6" />
          <rect x="58" y="42" width="30" height="18" rx="5" fill="currentColor" opacity="0.35" />
          <rect x="92" y="42" width="56" height="18" rx="5" fill="currentColor" opacity="0.2" />
          <g className="text-foreground" stroke="currentColor" strokeWidth="1" opacity="0.5">
            <line x1="12" y1="72" x2="148" y2="72" />
            <line x1="12" y1="68" x2="12" y2="76" />
            <line x1="148" y1="68" x2="148" y2="76" />
          </g>
          <g className="text-warning" fill="currentColor">
            <circle cx="58" cy="28" r="3" />
            <circle cx="88" cy="28" r="3" />
            <circle cx="104" cy="28" r="3" />
          </g>
        </svg>
      );
    case 'Structure':
      return (
        <svg
          viewBox="0 0 160 100"
          className="size-full text-accent"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Structure preview"
        >
          <polygon
            points="80,18 111,36 111,72 80,90 49,72 49,36"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <polygon
            points="80,30 100,42 100,66 80,78 60,66 60,42"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            opacity="0.6"
          />
          <line x1="80" y1="18" x2="80" y2="4" stroke="currentColor" strokeWidth="2" />
          <text x="80" y="100" textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.8">
            N
          </text>
        </svg>
      );
    case 'Sequence':
      return (
        <svg
          viewBox="0 0 160 100"
          className="size-full text-accent"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Sequence preview"
        >
          <rect x="12" y="30" width="52" height="12" rx="3" fill="currentColor" opacity="0.7" />
          <rect x="72" y="30" width="76" height="12" rx="3" fill="currentColor" opacity="0.35" />
          <g fontFamily="ui-monospace, monospace" fontSize="9" fill="currentColor" opacity="0.75">
            <text x="14" y="60">
              ATGGCTAGCTAGCTA
            </text>
            <text x="14" y="74">
              GGCTAACCGTTAAGG
            </text>
            <text x="14" y="88">
              CTTAGCTAGCATCGA
            </text>
          </g>
        </svg>
      );
    case 'Panel':
      return (
        <svg
          viewBox="0 0 160 100"
          className="size-full text-accent"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Panel preview"
        >
          <g className="text-muted" opacity="0.35" stroke="currentColor" strokeWidth="0.8">
            <line x1="80" y1="8" x2="80" y2="92" />
            <line x1="8" y1="50" x2="152" y2="50" />
          </g>
          <g fill="currentColor">
            <circle cx="26" cy="34" r="2.2" />
            <circle cx="40" cy="24" r="2.2" />
            <circle cx="54" cy="30" r="2.2" />
            <circle cx="66" cy="18" r="2.2" />
            <rect x="96" y="30" width="8" height="14" rx="2" />
            <rect x="110" y="24" width="8" height="20" rx="2" />
            <rect x="124" y="16" width="8" height="28" rx="2" />
            <rect x="138" y="26" width="8" height="18" rx="2" />
          </g>
          <g className="text-warning" fill="currentColor">
            <rect x="26" y="68" width="10" height="16" rx="2" />
            <rect x="42" y="72" width="10" height="12" rx="2" />
            <rect x="58" y="64" width="10" height="20" rx="2" />
          </g>
          <g className="text-success" fill="currentColor">
            <polyline
              points="98,84 112,74 126,78 140,68"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </g>
        </svg>
      );
  }
}

/** One figure, as the gallery card draws it. The whole card opens the drawer. */
function FigureCard({
  figure,
  index,
  onOpen,
  actions,
}: {
  figure: Figure;
  index: number;
  onOpen: () => void;
  actions: RowAction[];
}) {
  const Icon = KIND_ICON[figure.kind];
  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: MOTION.duration.panel,
        ease: MOTION.signature,
        delay: Math.min(index, 12) * 0.02,
      }}
      className="group relative flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-3 transition-colors hover:bg-surface-secondary"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${figure.id}`}
        className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <div className="grid aspect-[16/10] place-items-center rounded-xl bg-surface p-3">
        <FigurePreview kind={figure.kind} seed={figure.id} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
          <span className="text-meta tabular-nums text-muted">{figure.id}</span>
          <Chip size="sm" variant="soft" color="default" className="ml-auto">
            {figure.format}
          </Chip>
          <span className="relative z-10">
            <RowMenu label={`Actions for ${figure.id}`} actions={actions} />
          </span>
        </div>
        <p className="line-clamp-2 text-body text-foreground">{figure.caption}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted">
          <span>{figure.size}</span>
          <span className="ml-auto">{relativeDay(figure.updatedAt)}</span>
        </div>
      </div>
    </motion.article>
  );
}

/** A short "edited" label. */
function relativeDay(timestamp: number): string {
  const days = Math.round((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return 'edited today';
  if (days === 1) return 'edited yesterday';
  if (days < 30) return `edited ${days} days ago`;
  return `edited ${new Date(timestamp).toISOString().slice(0, 10)}`;
}

/** The checkbox mark that says whether a facet value is on. */
function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded',
        on ? 'bg-accent text-accent-foreground' : 'bg-surface-tertiary',
      )}
      aria-hidden
    >
      {on && <Check className="size-3" />}
    </span>
  );
}

/** One pick in a facet. */
function FacetRow({
  on,
  mark,
  label,
  onPress,
}: {
  on: boolean;
  mark?: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface',
        on && 'bg-surface',
      )}
    >
      {mark}
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{label}</span>
      <CheckMark on={on} />
    </button>
  );
}

/** New figure: a caption and a kind, then the studio takes over. */
function NewFigureDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { caption: string; kind: FigureKind; format: FigureFormat; size: string }) => void;
}) {
  const [caption, setCaption] = useState('');
  const [kind, setKind] = useState<FigureKind>('Plot');
  const [format, setFormat] = useState<FigureFormat>('SVG');
  const [size, setSize] = useState('180 mm');

  const create = () => {
    if (!caption.trim()) return;
    onCreate({ caption: caption.trim(), kind, format, size });
    setCaption('');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New figure"
      description="The caption is what stands beside the figure; the studio is where the drawing is made."
      width={520}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" className="gap-1.5" isDisabled={!caption.trim()} onPress={create}>
            <PencilRuler className="size-3.5" />
            Create and open
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <Label className="text-label">Caption</Label>
          <TextArea
            rows={2}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="What the figure shows, in one sentence."
            autoFocus
          />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <Label className="text-label">Kind</Label>
            <Select
              label="Kind"
              value={kind}
              options={FIGURE_KINDS.map((value) => ({ value, label: value }))}
              onChange={setKind}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label className="text-label">Format</Label>
            <Select
              label="Format"
              value={format}
              options={FIGURE_FORMATS.map((value) => ({ value, label: value }))}
              onChange={setFormat}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label className="text-label">Print size</Label>
            <Input value={size} onChange={(event) => setSize(event.target.value)} placeholder="180 mm" />
          </label>
        </div>
      </div>
    </Dialog>
  );
}

/** The drawer's export settings rows. */
function ExportSettings({ figure }: { figure: Figure }) {
  return (
    <div className="flex flex-col gap-2">
      <DrawerFact label="Format">{figure.format}</DrawerFact>
      <DrawerFact label="Size">{figure.size}</DrawerFact>
      <DrawerFact label="Type">{figure.vector ? 'Vector' : 'Raster'}</DrawerFact>
      <DrawerFact label="Resolution">
        {figure.vector ? 'Resolution-independent' : `${figure.dpi} dpi`}
      </DrawerFact>
      <DrawerFact label="Palette">{figure.palette}</DrawerFact>
    </div>
  );
}

/** The drawer for one figure: caption, provenance and export actions. */
function FigureDrawer({
  figure,
  onClose,
  onEdit,
}: {
  figure: Figure | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCopy();

  const copyCaption = () => {
    if (!figure) {
      return;
    }
    copy(figure.caption, 'caption');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const downloadCaption = () => {
    if (!figure) {
      return;
    }
    const spec = [
      figure.id,
      '',
      figure.caption,
      '',
      `Kind: ${figure.kind}`,
      `Script: ${figure.script}`,
      `Data: ${figure.data}`,
      `Format: ${figure.format} · ${figure.size}`,
      `Type: ${figure.vector ? 'vector' : `raster, ${figure.dpi} dpi`}`,
      `Palette: ${figure.palette}`,
    ].join('\n');
    const blob = new Blob([spec], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${figure.id.toLowerCase()}-caption.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Drawer isOpen={figure !== null} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-[560px] max-w-[94vw]">
            <Drawer.Header>
              <Drawer.Heading>{figure ? `${figure.id} · ${figure.kind}` : 'Figure'}</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>

            {figure && (
              <Drawer.Body className="flex flex-col gap-5 p-4">
                <div className="grid aspect-[16/10] place-items-center rounded-2xl bg-surface p-4">
                  <FigurePreview kind={figure.kind} seed={figure.id} />
                </div>

                <section className="flex flex-col gap-2">
                  <SectionLabel>Caption</SectionLabel>
                  <p className="text-body text-foreground">{figure.caption}</p>
                </section>

                <section className="flex flex-col gap-2">
                  <SectionLabel>How it was made</SectionLabel>
                  <div className="flex flex-col gap-2">
                    <DrawerFact label="Script">
                      <PathPill>{figure.script}</PathPill>
                    </DrawerFact>
                    <DrawerFact label="Data">
                      {figure.data === '—' ? (
                        <span className="text-muted">No data dependency</span>
                      ) : (
                        <PathPill>{figure.data}</PathPill>
                      )}
                    </DrawerFact>
                    <DrawerFact label="Edited">{relativeDay(figure.updatedAt)}</DrawerFact>
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <SectionLabel>Export settings</SectionLabel>
                  <ExportSettings figure={figure} />
                </section>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" className="gap-2" onPress={onEdit}>
                    <PencilRuler className="size-3.5" />
                    Open in studio
                  </Button>
                  <Button variant="secondary" className="gap-2" onPress={copyCaption}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? 'Caption copied' : 'Copy caption'}
                  </Button>
                  <Button variant="secondary" className="gap-2" onPress={downloadCaption}>
                    <Download className="size-3.5" />
                    Download caption
                  </Button>
                </div>
              </Drawer.Body>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

/**
 * The figure gallery.
 *
 * Search over the caption and the study, a facet popover over kind, study and format, then
 * the cards grouped by kind. Opening a card is a drawer; editing opens the studio.
 */
export function FiguresView() {
  usePageTitle('Figures');
  const { state, dispatch } = useApp();
  const copy = useCopy();
  const figures = useFigures();
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<string>('kind');
  const [selected, setSelected] = useState<Figure | null>(null);
  const [renameTarget, setRenameTarget] = useState<Figure | null>(null);
  const [creating, setCreating] = useState(false);

  const openStudio = (id: string) => dispatch({ type: 'route/go', route: `analyze/figures/${id}` });

  /** The actions a figure card offers. Its caption stands in for a name. */
  const actionsFor = (figure: Figure): RowAction[] => [
    { id: 'edit', label: 'Edit in studio', icon: PencilRuler, onSelect: () => openStudio(figure.id) },
    { id: 'open', label: 'Open details', icon: ExternalLink, onSelect: () => setSelected(figure) },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      onSelect: () => {
        const copyFigure = duplicateFigure(figure.id);
        if (copyFigure) notify(`Created “${copyFigure.id}”`, { tone: 'success' });
      },
    },
    { id: 'rename', label: 'Edit caption…', icon: Pencil, onSelect: () => setRenameTarget(figure) },
    { id: 'copy', label: 'Copy identifier', icon: Copy, onSelect: () => copy(figure.id, 'identifier') },
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => {
        const removed = removeFigure(figure.id);
        if (!removed) return;
        notify(`Removed “${figure.id}”`, {
          action: { label: 'Undo', onClick: () => restoreFigure(removed.figure, removed.index) },
        });
      },
    },
  ];

  // The field draws every keystroke; the gallery catches up when typing pauses.
  const settledQuery = useDebounced(query);

  const facets = useMemo<FacetDef<Figure>[]>(
    () => [
      { id: 'kind', valuesOf: (figure) => [figure.kind] },
      { id: 'format', valuesOf: (figure) => [figure.format] },
    ],
    [],
  );

  const filter = useFacetFilter(figures, {
    facets,
    searchOf: (figure: Figure) => `${figure.id} ${figure.caption}`,
    query: settledQuery,
  });
  const matches = filter.rows;
  const activeCount = filter.activeCount;

  const formats = Array.from(new Set(figures.map((figure) => figure.format)));

  return (
    <>
      <ScrollShadow className="h-full px-7 pb-9 pt-6">
        <div className="flex w-full flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex w-full max-w-sm items-center">
              <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search the caption or the study"
                aria-label="Search figures"
                className="w-full pl-9"
              />
            </div>

            <Popover
              trigger={
                <Button size="sm" variant={activeCount > 0 ? 'secondary' : 'ghost'} className="gap-1.5">
                  <Filter className="size-3.5" />
                  Filter
                  {activeCount > 0 && <Chip size="sm">{activeCount}</Chip>}
                </Button>
              }
              className="w-[280px]"
            >
              <Tabs selectedKey={facet} onSelectionChange={(key) => setFacet(String(key))}>
                <Tabs.ListContainer className="mx-1 mt-1">
                  <Tabs.List aria-label="Filter figures">
                    {facets.map((definition) => (
                      <Tabs.Tab key={definition.id} id={definition.id}>
                        {definition.id.charAt(0).toUpperCase() + definition.id.slice(1)}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.ListContainer>

                <Tabs.Panel id="kind">
                  <ScrollShadow className="max-h-[300px] px-1">
                    {FIGURE_KINDS.map((kind) => {
                      const Icon = KIND_ICON[kind];
                      return (
                        <FacetRow
                          key={kind}
                          on={filter.isOn('kind', kind)}
                          mark={
                            <span className="grid size-5 shrink-0 place-items-center">
                              <Icon className="size-4 text-muted" aria-hidden />
                            </span>
                          }
                          label={kind}
                          onPress={() => filter.toggle('kind', kind)}
                        />
                      );
                    })}
                  </ScrollShadow>
                </Tabs.Panel>
              </Tabs>

              <footer className="flex items-center gap-2 px-2 pb-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={activeCount === 0}
                  onPress={filter.clear}
                  className="gap-1.5"
                >
                  <X className="size-3.5" />
                  Clear all
                </Button>
                {activeCount > 0 && (
                  <span className="ml-auto text-meta tabular-nums text-muted">{activeCount} selected</span>
                )}
              </footer>
            </Popover>

            {activeCount > 0 && (
              <IconButton aria-label="Clear filters" onPress={filter.clear}>
                <X className="size-3.5" />
              </IconButton>
            )}

            <Button variant="primary" className="ml-auto gap-1.5" onPress={() => setCreating(true)}>
              <Plus className="size-3.5" />
              New figure
            </Button>
          </div>

          {matches.length === 0 && (
            <div className="grid place-items-center rounded-2xl bg-surface py-16 text-center">
              <div>
                <LayoutGrid className="mx-auto size-5 text-muted" aria-hidden />
                <p className="mt-2 text-body text-muted">
                  {figures.length === 0
                    ? 'No figures in this workspace yet. A figure is a file under .openlab/figures/, so it travels with the work.'
                    : 'No figure matches the current filter.'}
                </p>
                {figures.length === 0 && (
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Button variant="primary" className="gap-1.5" onPress={() => setCreating(true)}>
                      <Plus className="size-3.5" />
                      New figure
                    </Button>
                    <Button
                      variant="secondary"
                      className="gap-1.5"
                      onPress={() => {
                        const added = addExampleFigures();
                        notify(
                          added > 0
                            ? `Added ${added} example figure${added === 1 ? '' : 's'} to this workspace`
                            : 'The examples are already here',
                          { tone: added > 0 ? 'success' : 'default' },
                        );
                      }}
                    >
                      <Sparkles className="size-3.5" />
                      Add the examples
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {FIGURE_KINDS.map((kind) => {
            const items = matches.filter((figure) => figure.kind === kind);
            if (items.length === 0) {
              return null;
            }
            const Icon = KIND_ICON[kind];
            return (
              <section key={kind} className="flex flex-col gap-3">
                <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur">
                  <span className="flex items-center gap-1.5 rounded-lg bg-surface px-2 py-0.5 text-label text-foreground">
                    <Icon className="size-3.5" aria-hidden />
                    {kind}
                  </span>
                  <span className="text-meta tabular-nums text-muted">{items.length}</span>
                </header>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((figure, index) => (
                    <FigureCard
                      key={figure.id}
                      figure={figure}
                      index={index}
                      actions={actionsFor(figure)}
                      onOpen={() => setSelected(figure)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {matches.length > 0 && (
            <p className="text-meta text-muted">
              Showing {matches.length} of {figures.length} figures.
            </p>
          )}
        </div>
      </ScrollShadow>

      <FigureDrawer
        figure={selected}
        onClose={() => setSelected(null)}
        onEdit={() => {
          if (selected) openStudio(selected.id);
        }}
      />

      <NewFigureDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(input) => {
          const figure = createFigure(input);
          setCreating(false);
          notify(`Created “${figure.id}”`, { tone: 'success' });
          openStudio(figure.id);
        }}
      />

      <RenameModal
        open={renameTarget !== null}
        title="Edit caption"
        label="Caption"
        value={renameTarget?.caption ?? ''}
        onClose={() => setRenameTarget(null)}
        onSubmit={(caption) => {
          if (renameTarget) patchFigure(renameTarget.id, { caption });
        }}
      />
    </>
  );
}

/** The text a figure search matches. */
