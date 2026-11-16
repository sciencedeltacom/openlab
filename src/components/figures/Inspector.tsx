/**
 * The inspector.
 *
 * One panel, keyed by what is selected: the properties that element kind actually has, and
 * nothing else. Position and size sit behind a "Frame" disclosure because the canvas is how
 * you move things — the panel opens on what you came to change (the caption, the colour, the
 * data), not on eight number fields.
 *
 * Fields in a two-column grid put their label above the control: at this width a side label
 * leaves a field too narrow to read its own value.
 *
 * Every field writes through `onPatch`, so the studio keeps one history and one save path.
 */

import { useState, type ReactNode } from 'react';

import {
  Button,
  Chip,
  Collapsible,
  Input,
  NumberInput,
  ScrollShadow,
  SectionLabel,
  Select,
  Switch,
  TextArea,
} from '@/components/ui';
import { DataDialog } from './DataDialog';
import { ElementThumb, IconPicker } from './InsertPanel';
import { ATOM_ELEMENTS } from './molecule';
import { SWATCHES, uid, type FigureElement } from './types';

/* ================================================================================================
 * Small fields — one row tall wherever possible
 * ============================================================================================== */

/** A control with its label to the left: the shape a full-width row takes. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="w-14 shrink-0 text-[11px] text-muted">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1">{children}</span>
    </label>
  );
}

/** A control with its label above: the shape a half-width cell takes. */
function Stack({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 1,
  stacked,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  stacked?: boolean;
}) {
  const input = (
    <NumberInput
      fullWidth
      label={label}
      value={Math.round(value * 100) / 100}
      step={step}
      onChange={(next) => onChange(next ?? 0)}
    />
  );
  return stacked ? <Stack label={label}>{input}</Stack> : <Row label={label}>{input}</Row>;
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  stacked,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  stacked?: boolean;
}) {
  const input = (
    <Input
      fullWidth
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
    />
  );
  return stacked ? <Stack label={label}>{input}</Stack> : <Row label={label}>{input}</Row>;
}

/** A single-select, in the row or stacked shape. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  stacked,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  stacked?: boolean;
}) {
  const select = <Select label={label} value={value} options={options} onChange={onChange} />;
  return stacked ? <Stack label={label}>{select}</Stack> : <Row label={label}>{select}</Row>;
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Row label={label}>
      {/* HeroUI's switch is compound: the track is `Control`, the knob is `Thumb`, so both are
          required for it to render at all. */}
      <Switch size="sm" isSelected={value} onChange={onChange} aria-label={label}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </Row>
  );
}

/** A row of small swatches, plus a native picker for anything off-palette. */
function Colors({
  label,
  value,
  onChange,
  allowNone,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowNone?: boolean;
}) {
  const active = (swatch: string) => value.toLowerCase() === swatch.toLowerCase();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {allowNone && (
          <button
            type="button"
            aria-label="No fill"
            onClick={() => onChange('transparent')}
            className="size-4 rounded border border-separator"
            style={{
              backgroundImage:
                'linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%)',
              outline: active('transparent') ? '2px solid var(--accent)' : 'none',
              outlineOffset: 1,
            }}
          />
        )}
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            title={swatch}
            onClick={() => onChange(swatch)}
            className="size-4 rounded border"
            style={{
              background: swatch,
              borderColor: active(swatch) ? 'var(--accent)' : 'var(--border)',
              outline: active(swatch) ? '2px solid var(--accent)' : 'none',
              outlineOffset: 1,
            }}
          />
        ))}
        <input
          type="color"
          value={/^#/.test(value) ? value : '#1F2933'}
          onChange={(event) => onChange(event.target.value)}
          className="size-4 cursor-pointer rounded border border-separator bg-transparent"
          aria-label={`${label} custom`}
        />
      </div>
    </div>
  );
}

/** A code-ish text block: plot data, table rows, a sequence, mermaid source. */
function Block({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SectionLabel>{label}</SectionLabel>
      <TextArea
        fullWidth
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-meta"
      />
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

const PLOT_KINDS = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'pie', label: 'Pie' },
] as const;

const ALIGNMENTS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
] as const;

/* ================================================================================================
 * The panel
 * ============================================================================================== */

export interface InspectorProps {
  selected: FigureElement[];
  onPatch: (changes: Record<string, unknown>, message?: string) => void;
  /** Replace one element wholesale — for edits that rebuild it, like a plot's data. */
  onReplace: (element: FigureElement) => void;
  /** The element the Atom tool will place. */
  atomEl: string;
  onAtomEl: (el: string) => void;
}

type DataKind = 'plot' | 'table' | 'sequence';

export function Inspector({ selected, onPatch, onReplace, atomEl, onAtomEl }: InspectorProps) {
  const [iconQuery, setIconQuery] = useState('');
  /** Which element's data dialog is open, if any. */
  const [editing, setEditing] = useState<{ id: string; kind: DataKind } | null>(null);

  if (selected.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="max-w-[24ch] text-meta text-muted">
          Pick an element on the canvas to edit it, or place something from the library.
        </p>
      </div>
    );
  }

  const first = selected[0]!;
  const many = selected.length > 1;
  const patch = (changes: Record<string, unknown>) => onPatch(changes);

  return (
    <>
      <ScrollShadow className="h-full">
        <div className="flex flex-col gap-4 p-3">
          {many && (
            <Chip size="sm" variant="soft">
              {selected.length} selected
            </Chip>
          )}

          {!many && first.kind === 'shape' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Shape</SectionLabel>
              <Colors label="Fill" value={first.fill} onChange={(fill) => patch({ fill })} allowNone />
              <Colors label="Stroke" value={first.stroke} onChange={(stroke) => patch({ stroke })} />
              <div className="grid grid-cols-2 gap-2">
                <Num
                  stacked
                  label="Weight"
                  value={first.strokeWidth}
                  onChange={(strokeWidth) => patch({ strokeWidth: Math.max(0, strokeWidth) })}
                />
                {first.shape === 'roundRect' && (
                  <Num
                    stacked
                    label="Corner"
                    value={first.radius}
                    onChange={(radius) => patch({ radius: Math.max(0, radius) })}
                  />
                )}
              </div>
              <Toggle label="Dashed" value={first.dashed} onChange={(dashed) => patch({ dashed })} />
            </section>
          )}

          {!many && first.kind === 'text' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Text</SectionLabel>
              <Block
                label="Content"
                value={first.text}
                rows={2}
                onChange={(text) => patch({ text, name: text.slice(0, 24) || 'Text' })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Num
                  stacked
                  label="Size"
                  value={first.fontSize}
                  onChange={(fontSize) => patch({ fontSize: Math.max(6, fontSize) })}
                />
                <Choice
                  stacked
                  label="Weight"
                  value={String(first.fontWeight)}
                  options={[
                    { value: '300', label: 'Light' },
                    { value: '400', label: 'Regular' },
                    { value: '500', label: 'Medium' },
                    { value: '600', label: 'Semibold' },
                    { value: '700', label: 'Bold' },
                  ]}
                  onChange={(value) => patch({ fontWeight: Number(value) })}
                />
                <Choice
                  stacked
                  label="Align"
                  value={first.align}
                  options={ALIGNMENTS}
                  onChange={(align) => patch({ align })}
                />
                <Choice
                  stacked
                  label="Font"
                  value={first.font}
                  options={[
                    { value: 'sans', label: 'Sans' },
                    { value: 'serif', label: 'Serif' },
                    { value: 'mono', label: 'Mono' },
                  ]}
                  onChange={(font) => patch({ font })}
                />
              </div>
              <Toggle label="Italic" value={first.italic} onChange={(italic) => patch({ italic })} />
              <Colors label="Colour" value={first.color} onChange={(color) => patch({ color })} />
            </section>
          )}

          {!many && first.kind === 'math' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Equation</SectionLabel>
              <Block label="LaTeX" value={first.latex} rows={2} onChange={(latex) => patch({ latex })} />
              <div className="grid grid-cols-2 gap-2">
                <Num
                  stacked
                  label="Size"
                  value={first.fontSize}
                  onChange={(fontSize) => patch({ fontSize: Math.max(6, fontSize) })}
                />
                <Choice
                  stacked
                  label="Align"
                  value={first.align}
                  options={ALIGNMENTS}
                  onChange={(align) => patch({ align })}
                />
              </div>
              <Toggle label="Display" value={first.display} onChange={(display) => patch({ display })} />
              <Colors label="Colour" value={first.color} onChange={(color) => patch({ color })} />
            </section>
          )}

          {!many && first.kind === 'icon' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Icon</SectionLabel>
              <IconPicker
                query={iconQuery}
                onQuery={setIconQuery}
                selectedId={first.iconId}
                onPick={(iconId) => patch({ iconId })}
              />
              <Num
                label="Weight"
                value={first.strokeWidth}
                step={0.1}
                onChange={(strokeWidth) => patch({ strokeWidth })}
              />
              <Colors label="Colour" value={first.color} onChange={(color) => patch({ color })} />
            </section>
          )}

          {!many && first.kind === 'plot' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Plot</SectionLabel>
              <Choice
                label="Kind"
                value={first.plotKind}
                options={PLOT_KINDS}
                onChange={(plotKind) => patch({ plotKind })}
              />
              <Text label="Title" value={first.title} onChange={(title) => patch({ title })} />
              <div className="grid grid-cols-2 gap-2">
                <Text stacked label="X label" value={first.xLabel} onChange={(xLabel) => patch({ xLabel })} />
                <Text stacked label="Y label" value={first.yLabel} onChange={(yLabel) => patch({ yLabel })} />
              </div>
              <Toggle label="Axes" value={first.axes} onChange={(axes) => patch({ axes })} />
              <Toggle label="Grid" value={first.grid} onChange={(grid) => patch({ grid })} />
              <Toggle label="Legend" value={first.legend} onChange={(legend) => patch({ legend })} />
              <Colors label="Colour" value={first.color} onChange={(color) => patch({ color })} />
              <Colors label="Accent" value={first.accent} onChange={(accent) => patch({ accent })} />

              <SectionLabel>Data</SectionLabel>
              <div className="flex items-center gap-2 rounded-xl bg-surface p-2">
                <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-secondary p-1">
                  <ElementThumb element={first} />
                </span>
                <span className="min-w-0 flex-1 text-[11px] text-muted">
                  {first.series.length} {first.series.length === 1 ? 'point' : 'points'}
                  {first.series.length > 0 &&
                    ` · max ${Math.max(...first.series.map((point) => point.value))}`}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => setEditing({ id: first.id, kind: 'plot' })}
                >
                  Edit data…
                </Button>
              </div>
            </section>
          )}

          {!many && first.kind === 'table' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Table</SectionLabel>
              <Text
                label="Columns"
                value={first.columns.join(', ')}
                onChange={(text) => patch({ columns: text.split(',').map((cell) => cell.trim()) })}
              />
              <Num
                label="Size"
                value={first.fontSize}
                onChange={(fontSize) => patch({ fontSize: Math.max(8, fontSize) })}
              />
              <Toggle label="Zebra" value={first.zebra} onChange={(zebra) => patch({ zebra })} />
              <Colors
                label="Header"
                value={first.headerFill}
                onChange={(headerFill) => patch({ headerFill })}
              />

              <SectionLabel>Data</SectionLabel>
              <div className="flex items-center gap-2 rounded-xl bg-surface p-2">
                <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-secondary p-1">
                  <ElementThumb element={first} />
                </span>
                <span className="min-w-0 flex-1 text-[11px] text-muted">
                  {first.rows.length} {first.rows.length === 1 ? 'row' : 'rows'} · {first.columns.length}{' '}
                  columns
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => setEditing({ id: first.id, kind: 'table' })}
                >
                  Edit rows…
                </Button>
              </div>
            </section>
          )}

          {!many && first.kind === 'molecule' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Structure</SectionLabel>
              <Choice
                label="Atom"
                value={atomEl}
                options={ATOM_ELEMENTS.map((element) => ({ value: element, label: element }))}
                onChange={onAtomEl}
              />
              <p className="rounded-lg bg-surface p-2 text-[11px] text-muted">
                {first.atoms.length} atoms · {first.bonds.length} bonds. Press on the canvas with the Atom or
                Bond tool.
              </p>
              <Toggle
                label="Carbons"
                value={first.showCarbons}
                onChange={(showCarbons) => patch({ showCarbons })}
              />
              <Colors label="Colour" value={first.color} onChange={(color) => patch({ color })} />
            </section>
          )}

          {!many && first.kind === 'sequence' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Sequence</SectionLabel>
              <Block
                label="Residues"
                value={first.sequence}
                rows={3}
                onChange={(sequence) => patch({ sequence: sequence.replace(/\s+/g, '').toUpperCase() })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Choice
                  stacked
                  label="Type"
                  value={first.seqType}
                  options={[
                    { value: 'dna', label: 'DNA' },
                    { value: 'protein', label: 'Protein' },
                  ]}
                  onChange={(seqType) => patch({ seqType })}
                />
                <Num
                  stacked
                  label="Wrap"
                  value={first.wrap}
                  onChange={(wrap) => patch({ wrap: Math.max(10, wrap) })}
                />
              </div>
              <SectionLabel>Features</SectionLabel>
              <div className="flex items-center gap-2 rounded-xl bg-surface p-2">
                <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-secondary p-1">
                  <ElementThumb element={first} />
                </span>
                <span className="min-w-0 flex-1 text-[11px] text-muted">
                  {first.features.length} {first.features.length === 1 ? 'feature' : 'features'}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => setEditing({ id: first.id, kind: 'sequence' })}
                >
                  Edit features…
                </Button>
              </div>
              <Colors label="Colour" value={first.color} onChange={(color) => patch({ color })} />
            </section>
          )}

          {!many && first.kind === 'mermaid' && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Diagram</SectionLabel>
              <Block
                label="Mermaid source"
                rows={9}
                value={first.source}
                onChange={(source) => patch({ source })}
                hint="Flowchart, sequence, state, class, ER, gantt…"
              />
              <Choice
                label="Tone"
                value={first.tone}
                options={[
                  { value: 'neutral', label: 'Mermaid' },
                  { value: 'ink', label: 'Figure ink' },
                ]}
                onChange={(tone) => patch({ tone })}
              />
              <Button size="sm" variant="secondary" onPress={() => onPatch({ source: first.source.trim() })}>
                Re-render
              </Button>
            </section>
          )}

          <Collapsible title="Frame" defaultExpanded={false}>
            <div className="flex flex-col gap-2 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <Num stacked label="X" value={first.x} onChange={(x) => patch({ x })} />
                <Num stacked label="Y" value={first.y} onChange={(y) => patch({ y })} />
                <Num stacked label="Width" value={first.w} onChange={(w) => patch({ w: Math.max(8, w) })} />
                <Num stacked label="Height" value={first.h} onChange={(h) => patch({ h: Math.max(8, h) })} />
              </div>
              <Num label="Rotate" value={first.rotation} onChange={(rotation) => patch({ rotation })} />
              <Row label="Opacity">
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={first.opacity}
                  onChange={(event) => patch({ opacity: Number(event.target.value) })}
                  className="w-full accent-[var(--accent)]"
                  aria-label="Opacity"
                />
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted">
                  {Math.round(first.opacity * 100)}%
                </span>
              </Row>
              <Text label="Name" value={first.name} onChange={(name) => patch({ name })} />
              <div className="flex items-center gap-4">
                <Toggle label="Lock" value={first.locked} onChange={(locked) => patch({ locked })} />
                <Toggle label="Hide" value={first.hidden} onChange={(hidden) => patch({ hidden })} />
              </div>
            </div>
          </Collapsible>
        </div>
      </ScrollShadow>

      {/* The data behind the drawing, edited as the grid it is. */}
      {editing?.id === first.id && first.kind === 'plot' && (
        <DataDialog
          open={editing.kind === 'plot'}
          onClose={() => setEditing(null)}
          title="Chart data"
          description="One row per point. The chart redraws as you type."
          columns={[{ label: 'Label' }, { label: 'Value', hint: 'number' }]}
          rows={first.series.map((point) => [point.label, String(point.value)])}
          onChange={(rows) =>
            onReplace({
              ...first,
              series: rows.map(([label, value]) => ({
                label: (label ?? '').trim(),
                value: Number(value) || 0,
              })),
            })
          }
          preview={
            <div className="grid h-[190px] place-items-center rounded-xl bg-surface-secondary p-3">
              <ElementThumb element={first} />
            </div>
          }
          footnote={`${first.series.length} ${first.series.length === 1 ? 'point' : 'points'}`}
          addLabel="Add point"
        />
      )}

      {editing?.id === first.id && first.kind === 'table' && (
        <DataDialog
          open={editing.kind === 'table'}
          onClose={() => setEditing(null)}
          title="Table rows"
          description="One row per line of the table. Column names are set in the panel."
          width={780}
          columns={first.columns.map((column, index) => ({ label: column || `Column ${index + 1}` }))}
          rows={first.rows}
          onChange={(rows) => onReplace({ ...first, rows })}
          preview={
            <div className="grid h-[150px] place-items-center rounded-xl bg-surface-secondary p-3">
              <ElementThumb element={first} />
            </div>
          }
          footnote={`${first.rows.length} rows`}
          addLabel="Add row"
        />
      )}

      {editing?.id === first.id && first.kind === 'sequence' && (
        <DataDialog
          open={editing.kind === 'sequence'}
          onClose={() => setEditing(null)}
          title="Annotated features"
          description="Positions are 1-based and count from the first residue."
          columns={[{ label: 'Start' }, { label: 'End' }, { label: 'Label' }]}
          rows={first.features.map((feature) => [String(feature.start), String(feature.end), feature.label])}
          onChange={(rows) =>
            onReplace({
              ...first,
              features: rows.map(([start, end, label], index) => ({
                id: uid(),
                start: Number(start) || 1,
                end: Number(end) || 1,
                label: (label ?? '').trim() || `Feature ${index + 1}`,
                color: SWATCHES[(index % (SWATCHES.length - 4)) + 3]!,
                strand: 1 as const,
              })),
            })
          }
          preview={
            <div className="grid h-[120px] place-items-center rounded-xl bg-surface-secondary p-3">
              <ElementThumb element={first} />
            </div>
          }
          footnote={`${first.features.length} features`}
          addLabel="Add feature"
        />
      )}
    </>
  );
}
