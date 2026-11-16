/**
 * The four screen archetypes.
 *
 * Everything here is downstream of `spec.ts`: a screen is data, and these components are
 * the single implementation of each shape. That is why the file is long and flat rather
 * than clever — one renderer per kind means fifty surfaces cannot drift apart.
 *
 * Two rules run through the whole file:
 *   - Structure comes from tone (`bg-background` < `bg-surface` < `bg-surface`), never
 *     from hairlines. Nothing here draws a stroke.
 *   - A HeroUI component is never restyled. Only layout classes land on one; if it needs
 *     to look different, a different HeroUI variant is the answer.
 */

import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
  Layers,
  Pencil,
  Power,
  PowerOff,
  Search,
  Tag,
  Trash2,
} from 'lucide-react';

import { pathFor } from '@/app/routes';
import { RowMenu, RenameModal, type RowAction } from '@/components/common/RowMenu';
import { useCopy } from '@/hooks/useCopy';
import { Fact, FactGroup, RecordMissing, RecordPage } from '@/components/research/PageShell';
import {
  BrandMark,
  Button,
  Cell,
  CellGroup,
  CellSeparator,
  Chip,
  IconButton,
  Input,
  NumberInput,
  SectionLabel,
  Select,
  SwitchRow,
  Table,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
} from '@/components/ui';
import { SETTINGS_PAGES } from '@/app/routes';
import { cn } from '@/lib/cn';
import { toneColor } from '@/components/packs/meta';
import { useApp, usePageTitle } from '@/store/app';
import type { AppState } from '@/store/types';
import { preferenceKey, preferenceValue, type PreferenceValue } from '@/lib/settings';
import { MOTION } from '@/theme/tokens';
import type {
  CatalogEntry,
  CatalogScreenSpec,
  DataScreenSpec,
  DocScreenSpec,
  Field,
  OverviewCard,
  OverviewScreenSpec,
  ScreenSpec,
  SettingsScreenSpec,
  SettingsSection,
  LiveSetting,
  Stat,
} from './spec';

/* ================================================================================================
 * Shared
 * ============================================================================================== */

/** A tone made of a translucent wash over the island it sits on. */
const TONE_WASH: Record<'accent' | 'warning' | 'danger', string> = {
  accent: 'bg-accent/10',
  warning: 'bg-warning/10',
  danger: 'bg-danger/10',
};

/** `repeat(n, minmax(0, 1fr))`, so fixed columns can be spliced into a shared grid. */
/**
 * The narrowest the grid may be before it scrolls.
 *
 * Sum of the fixed tracks plus a working minimum for each flexible one. Without this a wide
 * table does not scroll — it crushes its flexible columns, and a name column squeezed to
 * eighty pixels renders four words stacked vertically.
 */
function gridMinWidth(columns: { width?: string }[]): string {
  const flexible = 8;
  const fixed = columns.reduce((total, column) => {
    const track = columnTrack(column.width);
    const match = /^(\d+(?:\.\d+)?)(px|rem|em|ch)$/.exec(track);
    if (!match) {
      return total + flexible;
    }
    const value = Number(match[1]);
    return total + (match[2] === 'px' ? value / 16 : value);
  }, 0);
  return `${fixed}rem`;
}

/**
 * One grid track.
 *
 * A width the browser cannot parse would invalidate the whole `grid-template-columns`
 * declaration and collapse the table to a single column, so anything that is not a track
 * we recognise degrades to an even share instead.
 */
function columnTrack(width?: string): string {
  if (!width) return 'minmax(0, 1fr)';
  const track = width.trim();
  if (/^\d+(\.\d+)?(px|rem|em|fr|%|vw|ch)$/.test(track)) return track;
  if (/^(auto|min-content|max-content|fit-content\(.+\)|minmax\(.+\))$/.test(track)) return track;
  return 'minmax(0, 1fr)';
}

/**
 * One shared track list for a header row and its body rows, so they line up.
 *
 * The tracks only, and the caller must pass them as `gridTemplateColumns`. React writes a
 * `style` object by assigning to the style declaration, which only knows camelCase names —
 * a hyphenated key (or a full "grid-template-columns: …" declaration) is silently dropped
 * and the grid collapses to one column.
 */
function gridTemplate(columns: { width?: string }[]): string {
  return columns.map((column) => columnTrack(column.width)).join(' ');
}

/**
 * The name of the one parameter a record pattern carries, e.g. `sourceId`.
 *
 * Read from the pattern rather than hardcoded, so a new record route needs no change here.
 */
function patternParam(pattern: string): string | null {
  const part = pattern.split('/').find((segment) => segment.startsWith(':'));
  return part ? part.slice(1) : null;
}

/** True when a click landed on a control inside a pressable row, not on the row itself. */
function clickedControl(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target === event.currentTarget) return false;
  return target.closest('a, button, input, [role="switch"]') !== null;
}

/* ================================================================================================
 * Settings
 * ============================================================================================== */

/**
 * A settings cell whose field needs the full width.
 *
 * Cell's trailing slot holds one small control. A text field, a radio list or a table
 * needs the column instead, so the field is stacked under the label inside the same
 * row — the cell stays the one row primitive.
 */
function WideCell({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) {
  return (
    <Cell
      label={
        <span className="flex flex-col gap-1.5">
          {label && <span className="text-body text-foreground">{label}</span>}
          {hint && <span className="text-meta text-muted">{hint}</span>}
          {children}
        </span>
      }
    />
  );
}

/** A data table, drawn with HeroUI's own Table. */
function RowsControl({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const label = columns.join(', ');
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            {columns.map((column, index) => (
              <Table.Column key={column} isRowHeader={index === 0}>
                {column}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>
            {rows.map((row, rowIndex) => (
              <Table.Row key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <Table.Cell key={cellIndex}>{cell}</Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/** A read value in a cell's trailing slot. */
function Value({ children }: { children: ReactNode }) {
  return <span className="max-w-72 text-right text-body text-muted">{children}</span>;
}

/** How a reference field reads: its value, as text. */
function referenceValue(field: Field): string {
  switch (field.kind) {
    case 'switch':
      return field.value ? 'on' : 'off';
    case 'radio':
      return optionLabel(field.options, field.value);
    case 'select':
      return optionLabel(field.options, field.value);
    case 'tags':
      return field.values.join(', ') || 'none';
    case 'number':
    case 'slider':
      return `${field.value}${field.suffix ? ` ${field.suffix}` : ''}`;
    case 'text':
    case 'textarea':
      return field.value ?? '—';
    default:
      return '—';
  }
}

/** The label behind a value, so a select reads as a word rather than an id. */
function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * A field that is really a setting: the control the store already owns.
 *
 * The spec says which setting a field stands for; this is the only place that knows how to
 * read one out of the store and how to write it back.
 */
function LiveSelect({
  setting,
  options,
}: {
  setting: LiveSetting;
  options: { value: string; label: string }[];
}) {
  const { state, dispatch } = useApp();
  const value = setting === 'theme' ? state.theme : state.navMode;

  return (
    <Select
      label={setting === 'theme' ? 'Theme' : 'Tabs'}
      value={value}
      options={options}
      onChange={(next) => {
        if (setting === 'theme') {
          dispatch({ type: 'theme/set', theme: next === 'dark' ? 'dark' : 'light' });
        } else {
          dispatch({ type: 'nav/mode', mode: next === 'horizontal' ? 'horizontal' : 'vertical' });
        }
      }}
      className="w-[180px]"
    />
  );
}

/**
 * One field, read as a value.
 *
 * These pages are a reference, not a form: the settings they describe are not wired to the
 * runtime, so a control that looks editable would promise something that never happens. Each
 * field renders its value as text, and `SettingsScreen` says so once at the top of the page.
 */
/** The key a control writes to: the store setting when it names one, else its section+label. */
function fieldKey(sectionId: string, field: Field): string {
  return 'setting' in field && field.setting ? field.setting : preferenceKey(sectionId, field.label);
}

/**
 * Read and write one setting.
 *
 * Theme and navigation keep their own reducers because the shell reads them on every paint.
 * Everything else lands in `preferences`, which is persisted with the workspace and read back
 * into the system prompt.
 */
function useLiveSetting<T extends PreferenceValue>(
  key: string,
  fallback: T,
  label: string,
  section: string,
): [T, (value: T) => void] {
  const { state, dispatch } = useApp();

  if (key === 'theme') {
    return [
      (state.theme ?? fallback) as T,
      (value) => dispatch({ type: 'theme/set', theme: value as 'light' | 'dark' }),
    ];
  }
  if (key === 'navMode') {
    return [
      (state.navMode ?? fallback) as T,
      (value) => dispatch({ type: 'nav/mode', mode: value as AppState['navMode'] }),
    ];
  }

  const value = preferenceValue(state.preferences, key, fallback);
  return [value, (next) => dispatch({ type: 'pref/set', key, entry: { value: next, label, section } })];
}

function SettingsCell({
  field,
  sectionId,
  sectionTitle,
}: {
  field: Field;
  sectionId: string;
  sectionTitle: string;
}) {
  const key = fieldKey(sectionId, field);
  // A preference the runtime does not read is shown as its value, with the reason. A control
  // that looks like a boundary but changes nothing is worse than a sentence.
  if (field.reference) {
    return (
      <Cell
        label={field.label}
        description={field.hint}
        control={
          <span className="flex items-center justify-end gap-2">
            <Value>{referenceValue(field)}</Value>
            <Chip size="sm" variant="soft" color="default">
              prompt only
            </Chip>
          </span>
        }
      />
    );
  }
  switch (field.kind) {
    case 'text': {
      const [value, setValue] = useLiveSetting(key, field.value ?? '', field.label, sectionTitle);
      return (
        <Cell
          label={field.label}
          description={field.hint}
          control={
            <Input
              value={value}
              placeholder={field.placeholder}
              aria-label={field.label}
              className="max-w-72"
              onChange={(event) => setValue((event.target as HTMLInputElement).value)}
            />
          }
        />
      );
    }
    case 'password':
      return (
        <Cell
          label={field.label}
          description={field.hint}
          control={<Value>{field.stored ? 'Stored in the credential vault' : 'Not set'}</Value>}
        />
      );
    case 'textarea': {
      const [value, setValue] = useLiveSetting(key, field.value ?? '', field.label, sectionTitle);
      return (
        <WideCell label={field.label} hint={field.hint}>
          <TextArea
            value={value}
            rows={field.rows ?? 6}
            placeholder={field.placeholder}
            aria-label={field.label}
            className={field.mono ? 'font-mono' : undefined}
            onChange={(event) => setValue((event.target as HTMLTextAreaElement).value)}
          />
        </WideCell>
      );
    }
    case 'number':
    case 'slider': {
      const [value, setValue] = useLiveSetting(key, field.value, field.label, sectionTitle);
      return (
        <Cell
          label={field.label}
          description={field.hint}
          control={
            <span className="flex items-center gap-2">
              <NumberInput
                label={field.label}
                value={value}
                min={field.min}
                max={field.max}
                step={field.kind === 'slider' ? field.step : undefined}
                className="w-40"
                onChange={(next) => setValue(next ?? field.min ?? 0)}
              />
              {field.suffix && <span className="text-meta text-muted">{field.suffix}</span>}
            </span>
          }
        />
      );
    }
    case 'select': {
      const [value, setValue] = useLiveSetting(key, field.value, field.label, sectionTitle);
      return (
        <Cell
          label={field.label}
          description={field.hint}
          control={
            field.setting === 'theme' || field.setting === 'navMode' ? (
              <LiveSelect setting={field.setting} options={field.options} />
            ) : (
              <Select
                label={field.label}
                value={value}
                options={field.options}
                onChange={(next) => setValue(next)}
              />
            )
          }
        />
      );
    }
    case 'switch': {
      const [value, setValue] = useLiveSetting(key, field.value, field.label, sectionTitle);
      return (
        <WideCell hint={field.hint}>
          <SwitchRow label={field.label} checked={value} onChange={setValue} />
        </WideCell>
      );
    }
    case 'radio': {
      const [value, setValue] = useLiveSetting(key, field.value, field.label, sectionTitle);
      return (
        <WideCell label={field.label} hint={field.hint}>
          <span className="flex flex-wrap gap-1.5">
            {field.options.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={option.value === value}
                onClick={() => setValue(option.value)}
                className={cn(
                  'rounded-full px-3 py-1 text-meta transition-colors',
                  option.value === value
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surface text-muted hover:text-foreground',
                )}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </span>
        </WideCell>
      );
    }
    case 'tags': {
      const [value, setValue] = useLiveSetting(key, field.values, field.label, sectionTitle);
      return (
        <WideCell label={field.label} hint={field.hint}>
          <Input
            value={value.join(', ')}
            aria-label={field.label}
            placeholder={field.placeholder}
            onChange={(event) =>
              setValue(
                (event.target as HTMLInputElement).value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
          />
        </WideCell>
      );
    }
    case 'rows':
      return (
        <WideCell label={field.label} hint={field.hint}>
          <RowsControl columns={field.columns} rows={field.rows} />
        </WideCell>
      );
  }
}

/** A right-hand column of small fact groups, pinned while the form scrolls. */
function AsideColumn({
  sections,
}: {
  sections: { title: string; items: { label: string; value: string }[] }[];
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 self-start lg:sticky lg:top-6">
      {sections.map((section) => (
        <CellGroup key={section.title} title={section.title}>
          {section.items.map((item, index) => (
            <Fragment key={item.label}>
              {index > 0 && <CellSeparator />}
              <Cell
                label={item.label}
                control={
                  <span className="w-28 break-words text-right text-meta tabular-nums text-muted">
                    {item.value}
                  </span>
                }
              />
            </Fragment>
          ))}
        </CellGroup>
      ))}
    </aside>
  );
}

/**
 * One settings section: a heading, then the group of cells.
 *
 * The cells share one surface with hairlines between them — the one place a hairline
 * earns its keep, because it separates peers rather than boxing a single field.
 */
function SettingsSectionBlock({ section }: { section: SettingsSection }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>{section.title}</SectionLabel>
      <CellGroup>
        {section.fields.map((field, index) => (
          <Fragment key={`${section.id}-${field.kind}-${index}`}>
            {index > 0 && <CellSeparator />}
            <SettingsCell field={field} sectionId={section.id} sectionTitle={section.title} />
          </Fragment>
        ))}
      </CellGroup>
    </section>
  );
}

/**
 * Settings: a centred column of cell groups, plus optional facts at the right.
 *
 * Centred on purpose — a settings form is read, not scanned, and a wide field is harder
 * to read than a narrow one.
 */
/**
 * The settings pages, as the surface's own navigation.
 *
 * A dozen pages do not belong in the main column and they are not a tab strip either — they
 * are the contents of one surface, so they are listed inside it, the way every settings
 * screen lists them. That is what keeps the sidebar nine groups instead of thirty rows.
 */
function SettingsNav({ active }: { active: string }) {
  const { dispatch } = useApp();

  return (
    <nav aria-label="Settings" className="flex flex-col gap-0.5">
      {SETTINGS_PAGES.map((page) => {
        const Icon = page.icon;
        const on = page.path === active;
        return (
          <button
            key={page.path}
            type="button"
            onClick={() => dispatch({ type: 'route/go', route: page.path })}
            className={cn(
              'flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-start transition-colors',
              on ? 'bg-surface text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-body">{page.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The settings frame: the surface's own contents on the left, the page in the middle, the
 * facts on the right.
 *
 * Applied by the spec-driven settings screens and by the bespoke ones (the provider
 * registry), so every settings page keeps the same navigation and column — moving between
 * them never feels like leaving the surface.
 */
export function SettingsPage({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: SettingsScreenSpec['aside'];
}) {
  const { state } = useApp();
  const active = SETTINGS_PAGES.find((page) => page.path === state.route)?.path ?? state.route;

  return (
    <div className="flex w-full justify-center px-7 py-7">
      {/* Three fixed columns, so the page never moves or changes width as the reader moves
          between settings pages: the aside's space is held even on a page that has none. */}
      <div className="flex w-full max-w-[720px] gap-8 lg:max-w-[936px] xl:max-w-[1192px]">
        <div className="hidden w-[184px] shrink-0 lg:block">
          <SettingsNav active={active} />
        </div>
        <div className="min-w-0 max-w-[720px] flex-1">{children}</div>
        <div className="hidden w-56 shrink-0 xl:block">
          {aside && aside.length > 0 && <AsideColumn sections={aside} />}
        </div>
      </div>
    </div>
  );
}

export function SettingsScreen({ spec }: { spec: SettingsScreenSpec }) {
  return (
    <SettingsPage aside={spec.aside}>
      <div className="flex w-full flex-col gap-8">
        {spec.sections.map((section) => (
          <SettingsSectionBlock key={section.id} section={section} />
        ))}
      </div>
    </SettingsPage>
  );
}

/* ================================================================================================
 * Catalogue
 * ============================================================================================== */

/** A search box over a list: a real HeroUI input with a leading icon. */
function CatalogSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-3 size-4 text-muted" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Search"
        className="w-full pl-9"
      />
    </div>
  );
}

/**
 * One catalogue entry: a glyph tile, then name, summary, chips and links.
 *
 * When the entry has a page, an invisible button covers the card so the whole surface is
 * one target. The documentation link and the footer sit above it, so their own controls
 * keep working.
 */
function EntryCard({
  entry,
  index,
  onOpen,
  actions,
}: {
  entry: CatalogEntry;
  index: number;
  /** Navigate to the entry's record page. Absent when the catalogue has no pages. */
  onOpen?: () => void;
  /** The trailing row menu. Sits above the card's overlay so it stays pressable. */
  actions?: ReactNode;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: MOTION.duration.panel,
        ease: MOTION.signature,
        delay: Math.min(index, 12) * 0.03,
      }}
      className="group relative flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-4 transition-colors hover:bg-surface-secondary"
    >
      {onOpen && (
        <button
          type="button"
          aria-label={`Open ${entry.name}`}
          onClick={onOpen}
          className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      )}

      <div className="flex items-start gap-3">
        <BrandMark icon={entry.icon} label={entry.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-body">{entry.name}</h3>
          <p className="line-clamp-2 text-meta text-muted">{entry.summary}</p>
        </div>
        {actions && <div className="relative z-10 shrink-0">{actions}</div>}
      </div>

      {(entry.status || (entry.meta && entry.meta.length > 0)) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.status && (
            <Chip color={toneColor(entry.status.tone)} size="sm" className=" text-meta">
              {entry.status.label}
            </Chip>
          )}
          {entry.meta?.map((item) => (
            <Chip key={item} size="sm" className=" text-meta">
              {item}
            </Chip>
          ))}
        </div>
      )}

      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <Chip key={tag} size="sm" variant="soft" color="default" className="text-meta">
              {tag}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {entry.href && (
          <a
            href={entry.href}
            target="_blank"
            rel="noreferrer noopener"
            className="relative z-10 flex w-fit items-center gap-1 text-meta text-link underline underline-offset-2"
          >
            Documentation
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
        {entry.footer && <div className="relative z-10">{entry.footer}</div>}
      </div>
    </motion.article>
  );
}

/**
 * Catalogue: filter, then a grid of things.
 *
 * When `recordPattern` is given and the spec declares records, each card opens its own
 * page. The pattern comes from the registry rather than from the spec, so a spec stays
 * data and the route tree stays the one place that knows about paths.
 */
export function CatalogScreen({ spec, recordPattern }: { spec: CatalogScreenSpec; recordPattern?: string }) {
  const { dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const copy = useCopy();

  const idParam = recordPattern ? patternParam(recordPattern) : null;
  const open =
    spec.records && recordPattern && idParam
      ? (id: string) => dispatch({ type: 'route/go', route: pathFor(recordPattern, { [idParam]: id }) })
      : null;

  /** Copy an id and say so; a denied clipboard is reported by the hook. */
  const copyIdentifier = (id: string) => copy(id, 'identifier');

  /** The actions a catalogue entry offers. Domain-specific ones are added by the spec. */
  const actionsFor = (entry: CatalogEntry): RowAction[] => {
    const actions: RowAction[] = [];
    if (open) {
      actions.push({ id: 'open', label: 'Open', icon: ExternalLink, onSelect: () => open(entry.id) });
    }
    // The catalogue is a description of what ships, not a user-owned collection: a rename or
    // a removal here would be a toast over a static list. Only the record page and the
    // identifier are real, so only those are offered.
    actions.push({
      id: 'copy',
      label: 'Copy identifier',
      icon: Copy,
      onSelect: () => copyIdentifier(entry.id),
    });
    return actions;
  };

  const groups = Array.from(new Set(spec.entries.map((entry) => entry.group)));
  const needle = query.trim().toLowerCase();
  const matches = spec.entries.filter((entry) => {
    if (group && entry.group !== group) return false;
    if (!needle) return true;
    const haystack = [entry.name, entry.summary, ...(entry.tags ?? [])].join(' ').toLowerCase();
    return haystack.includes(needle);
  });

  return (
    <div className="flex flex-col gap-4 px-7 py-7">
      {spec.actions && <div className="flex flex-wrap items-center gap-1.5">{spec.actions}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full max-w-sm">
          <CatalogSearch
            value={query}
            onChange={setQuery}
            placeholder={spec.facetLabel ? `Search, or filter by ${spec.facetLabel.toLowerCase()}` : 'Search'}
          />
        </div>
        <div className="min-w-0 max-w-full overflow-x-auto">
          <ToggleButtonGroup
            aria-label={spec.facetLabel ?? 'Filter'}
            selectionMode="single"
            selectedKeys={[group ?? 'all']}
            onSelectionChange={(keys) => {
              const [next] = keys as Set<string>;
              if (next) setGroup(next === 'all' ? null : next);
            }}
          >
            <ToggleButton id="all">All</ToggleButton>
            {groups.map((name) => (
              <ToggleButton key={name} id={name}>
                {name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="rounded-2xl bg-surface p-6">
          <p className="text-body text-muted">{spec.empty ?? 'Nothing matches that search.'}</p>
        </div>
      ) : (
        <div
          className={cn(
            'grid grid-cols-1 gap-3',
            spec.columns === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3',
          )}
        >
          {matches.map((entry, index) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              index={index}
              onOpen={open ? () => open(entry.id) : undefined}
              actions={<RowMenu label={`Actions for ${entry.name}`} actions={actionsFor(entry)} />}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================================================
 * Document
 * ============================================================================================== */

/** Copy-to-clipboard for a code block. Clipboard access is secure-context only. */
function CopyButton({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  const copyToClipboard = useCopy();

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    copyToClipboard(source, 'code');
    setCopied(true);
  };

  return (
    <IconButton aria-label="Copy code" onPress={copy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

/** A calm table for a document section. */
function DocTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const template = gridTemplate(columns.map(() => ({})));

  return (
    <div className="overflow-hidden rounded-2xl bg-surface">
      <div className="grid gap-x-4 gap-y-1 p-3" style={{ gridTemplateColumns: template }}>
        <div className="contents">
          {columns.map((column) => (
            <div key={column} className="section-label">
              {column}
            </div>
          ))}
        </div>
        {rows.map((row, index) => (
          <div key={index} className="contents">
            {row.map((cell, cellIndex) => (
              <div key={cellIndex} className="text-body">
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One document section: prose, steps, code, cards, a table — whatever it carries. */
function DocSectionBlock({ section }: { section: DocScreenSpec['sections'][number] }) {
  return (
    <section id={section.id} className="flex flex-col gap-3">
      <h2 className="text-title">{section.title}</h2>

      {section.body?.map((paragraph) => (
        <p key={paragraph} className="text-body text-muted">
          {paragraph}
        </p>
      ))}

      {section.bullets && (
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {section.bullets.map((bullet) => (
            <li key={bullet} className="text-body text-muted">
              {bullet}
            </li>
          ))}
        </ul>
      )}

      {section.steps && (
        <ol className="flex flex-col gap-3">
          {section.steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface text-meta tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-body font-medium">{step.title}</span>
                <span className="block text-body text-muted">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {section.code && (
        <div className="rounded-2xl bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="section-label">{section.code.language}</span>
            <div className="ml-auto">
              <CopyButton source={section.code.source} />
            </div>
          </div>
          <pre className="mt-2 overflow-x-auto text-meta">{section.code.source}</pre>
        </div>
      )}

      {section.cards && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {section.cards.map((card) => (
            <div
              key={card.title}
              className={cn(
                'rounded-2xl bg-surface p-4',
                card.tone && card.tone !== 'default' && TONE_WASH[card.tone],
              )}
            >
              <h3 className="text-body font-medium">{card.title}</h3>
              <p className="mt-1 text-meta text-muted">{card.body}</p>
            </div>
          ))}
        </div>
      )}

      {section.table && <DocTable columns={section.table.columns} rows={section.table.rows} />}
    </section>
  );
}

/**
 * Document: table of contents on the left, article in the middle, facts on the right.
 *
 * `embedded` drops the page frame — the nav, the facts rail and the outer padding — for a
 * host that already provides one. The pack record page uses it so a guide reads as that
 * page's long-form half rather than as a second page nested inside the first.
 */
export function DocScreen({ spec, embedded = false }: { spec: DocScreenSpec; embedded?: boolean }) {
  const article = (
    <article className="flex w-full min-w-0 flex-col gap-10">
      {spec.sections.map((section) => (
        <DocSectionBlock key={section.id} section={section} />
      ))}
    </article>
  );

  if (embedded) {
    return <div className="flex w-full min-w-0">{article}</div>;
  }

  return (
    <div className="flex items-start gap-8 px-7 py-7">
      <nav className="hidden w-56 shrink-0 flex-col gap-1 self-start lg:sticky lg:top-6 lg:flex">
        <h2 className="section-label">On this page</h2>
        {spec.sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="py-0.5 text-meta text-muted transition-colors hover:text-foreground"
          >
            {section.title}
          </a>
        ))}
      </nav>

      {article}

      {spec.aside && spec.aside.length > 0 && <AsideColumn sections={spec.aside} />}
    </div>
  );
}

/* ================================================================================================
 * Data
 * ============================================================================================== */

/** A cell: monospace and alignment are the cell's, not the table's. */
function DataCell({ value, align, mono }: { value: ReactNode; align?: 'start' | 'end'; mono?: boolean }) {
  const classes = cn(
    'min-w-0 text-body',
    mono && ' tabular-nums',
    align === 'end' && 'justify-self-end text-right',
  );
  if (typeof value === 'string' || typeof value === 'number') {
    return <span className={classes}>{value}</span>;
  }
  return <div className={classes}>{value}</div>;
}

/** A table row plus the local key that lets it be edited without an id column. */
type DataRow = Record<string, ReactNode> & { __key: string };

/**
 * Data: stats, then a paginated grid of records.
 *
 * When `recordPattern` is given and the spec declares records, each row opens its own
 * page. The row stays a grid and takes focus as one target, so the columns do not move.
 */
export function DataScreen({ spec, recordPattern }: { spec: DataScreenSpec; recordPattern?: string }) {
  const { dispatch } = useApp();
  const pageSize = Math.max(1, spec.pageSize ?? 25);
  const [page, setPage] = useState(0);
  const idParam = recordPattern ? patternParam(recordPattern) : null;
  const canOpen = Boolean(spec.records && recordPattern && idParam);
  const recordKey = spec.recordKey ?? 'id';

  // A table row has no id of its own, so one is minted from the record key column.
  const keyed = useMemo<DataRow[]>(
    () => spec.rows.map((row, index) => ({ ...row, __key: String(row[recordKey] ?? index) })),
    [spec.rows, recordKey],
  );
  const copy = useCopy();
  const rows = keyed;

  const openRow = (row: DataRow) => {
    if (!recordPattern || !idParam) return;
    dispatch({
      type: 'route/go',
      route: pathFor(recordPattern, { [idParam]: String(row[recordKey]) }),
    });
  };

  const copyIdentifier = (id: string) => copy(id, 'identifier');

  /**
   * The actions a data row offers.
   *
   * A table like this describes a system (the credential store, a scan inventory), not a
   * collection the reader owns. Renaming or removing a row would be a toast over a static
   * description, so only the two honest actions remain.
   */
  const actionsFor = (row: DataRow): RowAction[] => {
    const key = row.__key;
    const actions: RowAction[] = [];
    if (canOpen)
      actions.push({ id: 'open', label: 'Open', icon: ExternalLink, onSelect: () => openRow(row) });
    actions.push({ id: 'copy', label: 'Copy identifier', icon: Copy, onSelect: () => copyIdentifier(key) });
    return actions;
  };

  // A narrower page must not leave the reader on a page that no longer exists.
  useEffect(() => {
    setPage(0);
  }, [rows.length, pageSize]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pageSize;
  const end = Math.min(start + pageSize, rows.length);
  const visible = rows.slice(start, end);
  const template = gridTemplate(spec.columns);
  const minWidth = gridMinWidth(spec.columns);

  return (
    <div className="flex flex-col gap-4 px-7 py-7">
      {spec.stats && spec.stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {spec.stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl bg-surface p-3">
              <div className="text-meta text-muted">{stat.label}</div>
              <div className=" text-title tabular-nums">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {spec.actions && <div className="flex flex-wrap items-center gap-1.5">{spec.actions}</div>}

      <div className="overflow-hidden rounded-3xl bg-surface">
        <div className="grid gap-x-4 p-3" style={{ gridTemplateColumns: template }}>
          {spec.columns.map((column) => (
            <div
              key={column.key}
              className={cn('section-label', column.align === 'end' && 'justify-self-end text-right')}
            >
              {column.label}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-y-0.5 px-3 pb-3">
          {visible.map((row, index) => {
            const labelColumn = spec.columns.find((column) => typeof row[column.key] === 'string');
            const label = labelColumn ? String(row[labelColumn.key]) : String(row[recordKey]);
            return (
              <div
                key={row.__key}
                className="group flex items-center gap-1 rounded-xl transition-colors hover:bg-surface-secondary"
              >
                <div
                  role={canOpen ? 'button' : undefined}
                  tabIndex={canOpen ? 0 : undefined}
                  aria-label={canOpen ? `Open ${label}` : undefined}
                  onClick={
                    canOpen
                      ? (event) => {
                          if (!clickedControl(event)) openRow(row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    canOpen
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openRow(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'grid min-w-0 flex-1 gap-x-4 rounded-xl p-3',
                    canOpen &&
                      'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  )}
                  style={{ gridTemplateColumns: template }}
                >
                  {spec.columns.map((column) => (
                    <DataCell
                      key={column.key}
                      value={row[column.key]}
                      align={column.align}
                      mono={column.mono}
                    />
                  ))}
                </div>
                <RowMenu label={`Actions for ${label}`} actions={actionsFor(row)} className="mr-1 shrink-0" />
              </div>
            );
          })}

          {rows.length === 0 && <p className="p-3 text-body text-muted">No records.</p>}
        </div>
      </div>

      {rows.length > pageSize && (
        <footer className="flex items-center gap-2">
          <span className=" text-meta tabular-nums text-muted">
            {start + 1}–{end} of {rows.length}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              isDisabled={current === 0}
              onPress={() => setPage((value) => Math.max(0, value - 1))}
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              isDisabled={current >= pageCount - 1}
              onPress={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}

/* ================================================================================================
 * Record
 *
 * One page for every catalogue entry and data row, driven by the same spec the list renders.
 * The list and its pages cannot drift because there is only one source: the entry or row is
 * the record, and this is a view of it.
 * ============================================================================================== */

/** The section's own name from its path: `library/sources` reads `Sources`. */
function sectionLabel(path: string): string {
  const last = path.split('/').filter(Boolean).pop() ?? path;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/**
 * A catalogue entry's page.
 *
 * The card's own fields sit in the facts rail; the entry's `detail` rows are the body, the
 * reason the page exists. An entry with no detail still renders its fields rather than a
 * dead end.
 */
function CatalogRecord({ entry, noun }: { entry: CatalogEntry; noun: string }) {
  const [name, setName] = useState(entry.name);
  const [status, setStatus] = useState(entry.status);
  const [renameOpen, setRenameOpen] = useState(false);
  usePageTitle(name);
  const tags = entry.tags ?? [];
  const meta = entry.meta ?? [];
  const detail = entry.detail ?? [];

  const off = status?.tone === 'muted' || Boolean(status?.label.toLowerCase().includes('disabl'));
  const actions: RowAction[] = [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setRenameOpen(true) },
  ];
  if (status) {
    actions.push({
      id: 'toggle',
      label: off ? 'Enable' : 'Disable',
      icon: off ? Power : PowerOff,
      onSelect: () =>
        setStatus(off ? { label: 'Enabled', tone: 'ok' } : { label: 'Disabled', tone: 'muted' }),
    });
  }

  return (
    <>
      <RecordPage
        eyebrow={
          <div className="flex w-full items-center gap-2">
            <SectionLabel>{noun}</SectionLabel>
            <RowMenu label={`Actions for ${name}`} actions={actions} always className="ml-auto" />
          </div>
        }
        title={name}
        status={
          status && (
            <Chip color={toneColor(status.tone)} size="sm" className="text-meta">
              {status.label}
            </Chip>
          )
        }
        aside={
          <FactGroup>
            <Fact icon={Layers} label="Group">
              {entry.group}
            </Fact>
            {tags.length > 0 && (
              <Fact icon={Tag} label="Tags">
                <span className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Chip key={tag} size="sm" variant="soft" color="default" className="text-meta">
                      {tag}
                    </Chip>
                  ))}
                </span>
              </Fact>
            )}
            {meta.length > 0 && (
              <Fact icon={Info} label="Meta">
                <span className="flex flex-col gap-1">
                  {meta.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </span>
              </Fact>
            )}
            {entry.href && (
              <Fact icon={BookOpen} label="Docs">
                <a
                  href={entry.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex w-fit items-center gap-1 text-link underline underline-offset-2"
                >
                  Documentation
                  <ArrowUpRight className="size-3.5" />
                </a>
              </Fact>
            )}
          </FactGroup>
        }
      >
        {detail.length > 0 && (
          <FactGroup title="Details">
            {detail.map((row) => (
              <Fact key={row.label} label={row.label}>
                {row.value}
              </Fact>
            ))}
          </FactGroup>
        )}
        {entry.footer}
      </RecordPage>
      <RenameModal
        open={renameOpen}
        title={`Rename ${noun.toLowerCase()}`}
        value={name}
        onClose={() => setRenameOpen(false)}
        onSubmit={setName}
      />
    </>
  );
}

/**
 * A data row's page.
 *
 * The first column whose value is a string names the record; every other column becomes a
 * fact, keeping its label and the mono and align the table declared.
 */
function DataRecord({
  spec,
  row,
  id,
  noun,
}: {
  spec: DataScreenSpec;
  row: Record<string, ReactNode>;
  id: string;
  noun: string;
}) {
  const headingColumn = spec.columns.find((column) => typeof row[column.key] === 'string');
  const [heading, setHeading] = useState(headingColumn ? String(row[headingColumn.key]) : id);
  const [renameOpen, setRenameOpen] = useState(false);
  const copy = useCopy();
  usePageTitle(heading);
  const facts = spec.columns.filter((column) => column !== headingColumn);

  const actions: RowAction[] = [];
  if (headingColumn) {
    actions.push({ id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setRenameOpen(true) });
  }
  actions.push({
    id: 'copy',
    label: 'Copy identifier',
    icon: Copy,
    onSelect: () => copy(id, 'identifier'),
  });

  return (
    <>
      <RecordPage
        eyebrow={
          <div className="flex w-full items-center gap-2">
            <SectionLabel>{noun}</SectionLabel>
            <RowMenu label={`Actions for ${heading}`} actions={actions} always className="ml-auto" />
          </div>
        }
        title={heading}
        aside={
          facts.length > 0 ? (
            <FactGroup>
              {facts.map((column) => (
                <Fact key={column.key} label={column.label}>
                  <span
                    className={cn(
                      'block',
                      column.mono && 'tabular-nums',
                      column.align === 'end' && 'text-right',
                    )}
                  >
                    {row[column.key]}
                  </span>
                </Fact>
              ))}
            </FactGroup>
          ) : undefined
        }
      >
        {null}
      </RecordPage>
      <RenameModal
        open={renameOpen}
        title={`Rename ${noun.toLowerCase()}`}
        value={heading}
        onClose={() => setRenameOpen(false)}
        onSubmit={setHeading}
      />
    </>
  );
}

/**
 * A record page built from the list it belongs to.
 *
 * The registry resolves the parent section's spec and passes the matched id; an unknown id
 * gets the shared not-found state with a way back, never a blank page.
 */
export function RecordScreen({
  spec,
  id,
  pattern,
  parent,
}: {
  spec: CatalogScreenSpec | DataScreenSpec;
  id: string;
  pattern: string;
  parent: string;
}) {
  const backLabel = sectionLabel(parent);
  const noun = spec.records?.noun ?? 'record';

  if (spec.kind === 'catalog') {
    const entry = spec.entries.find((candidate) => candidate.id === id);
    if (!entry) {
      return <RecordMissing what={noun.toLowerCase()} back={parent} backLabel={backLabel} />;
    }
    return <CatalogRecord key={`${pattern}:${entry.id}`} entry={entry} noun={noun} />;
  }

  const recordKey = spec.recordKey ?? 'id';
  const row = spec.rows.find((candidate) => String(candidate[recordKey]) === id);
  if (!row) {
    return <RecordMissing what={noun.toLowerCase()} back={parent} backLabel={backLabel} />;
  }
  return <DataRecord key={`${pattern}:${id}`} spec={spec} row={row} id={id} noun={noun} />;
}

/* ================================================================================================
 * Overview
 * ============================================================================================== */

/** Tone tints the number, so a value carries its meaning without an icon or a chip. */
const STAT_TONE: Record<NonNullable<Stat['tone']>, string> = {
  default: 'text-foreground',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Stat columns, chosen by count so one stat does not sit in half a row. */
const STAT_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
};

/** Card spans, resolving the spec's measure to a third of the wide grid. */
const CARD_SPAN: Record<1 | 2 | 3, string> = {
  1: 'md:col-span-1',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
};

/**
 * One headline number.
 *
 * A stat with an `href` is a link to where the number comes from: an external URL opens
 * in a tab, anything else is an in-app route. Without one it is a plain tile.
 */
function StatTile({
  stat,
  index,
  onNavigate,
}: {
  stat: Stat;
  index: number;
  onNavigate: (route: string) => void;
}) {
  const href = stat.href;
  const className = cn(
    'flex flex-col gap-0.5 rounded-2xl bg-surface p-4',
    href && 'text-start transition-colors hover:bg-surface-secondary',
  );
  const inner = (
    <>
      <span className="text-meta text-muted">{stat.label}</span>
      <span className={cn('text-title tabular-nums', STAT_TONE[stat.tone ?? 'default'])}>{stat.value}</span>
      {stat.note && <span className="text-meta text-muted">{stat.note}</span>}
    </>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.duration.panel, ease: MOTION.signature, delay: index * 0.04 }}
    >
      {href && /^https?:\/\//.test(href) ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
          {inner}
        </a>
      ) : href ? (
        <button type="button" onClick={() => onNavigate(href)} className={cn(className, 'w-full')}>
          {inner}
        </button>
      ) : (
        <div className={className}>{inner}</div>
      )}
    </motion.div>
  );
}

/** One card: a labelled panel whose body is already-built content, a chart or a list. */
function OverviewCardBlock({ card, index }: { card: OverviewCard; index: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.duration.panel, ease: MOTION.signature, delay: 0.12 + index * 0.05 }}
      className={cn('flex min-w-0 flex-col gap-3 rounded-3xl bg-surface p-4', CARD_SPAN[card.span ?? 1])}
    >
      <header className="flex items-baseline gap-2">
        <SectionLabel>{card.title}</SectionLabel>
        {card.value && <span className="ml-auto text-title tabular-nums text-foreground">{card.value}</span>}
      </header>
      <div className="min-w-0">{card.body}</div>
      {card.note && <p className="text-meta text-muted">{card.note}</p>}
    </motion.section>
  );
}

/**
 * Overview: the state of a section in one screen.
 *
 * The budget is the design: one sentence, up to four numbers, a few cards that carry a
 * chart or a short list, and somewhere to go next. Prose that needs a paragraph belongs
 * on a section page, and the renderer makes that the easy path by having nowhere to put it.
 */
export function OverviewScreen({ spec }: { spec: OverviewScreenSpec }) {
  const { dispatch } = useApp();

  return (
    <div className="flex w-full flex-col gap-6 px-7 py-7">
      {spec.stats.length > 0 && (
        <div className={cn('grid gap-2', STAT_COLUMNS[Math.min(spec.stats.length, 4)] ?? STAT_COLUMNS[4])}>
          {spec.stats.map((stat, index) => (
            <StatTile
              key={stat.label}
              stat={stat}
              index={index}
              onNavigate={(route) => dispatch({ type: 'route/go', route })}
            />
          ))}
        </div>
      )}

      {spec.cards.length > 0 && (
        // `items-start` so a card is as tall as its content. Equal heights look tidy and
        // leave a chart sitting in a void when its neighbour is a taller list.
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-3">
          {spec.cards.map((card, index) => (
            <OverviewCardBlock key={card.id} card={card} index={index} />
          ))}
        </div>
      )}

      {spec.next && spec.next.length > 0 && (
        <nav aria-label="Next" className="flex flex-col gap-1">
          {spec.next.map((item) => (
            <button
              key={item.to}
              type="button"
              onClick={() => dispatch({ type: 'route/go', route: item.to })}
              className="group flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-start transition-colors hover:bg-surface-secondary"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body">{item.label}</span>
                {item.hint && <span className="mt-0.5 block text-meta text-muted">{item.hint}</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

/* ================================================================================================
 * Dispatcher
 * ============================================================================================== */

/**
 * Turn a screen spec into its archetype. The switch is exhaustive over `ScreenSpec`.
 *
 * `recordPattern` is set only for section pages whose records have pages of their own; the
 * catalogue and data renderers use it to link each item to its record.
 */
export function ScreenSpecView({ spec, recordPattern }: { spec: ScreenSpec; recordPattern?: string }) {
  switch (spec.kind) {
    case 'settings':
      return <SettingsScreen spec={spec} />;
    case 'catalog':
      return <CatalogScreen spec={spec} recordPattern={recordPattern} />;
    case 'doc':
      return <DocScreen spec={spec} />;
    case 'data':
      return <DataScreen spec={spec} recordPattern={recordPattern} />;
    case 'overview':
      return <OverviewScreen spec={spec} />;
  }
}
