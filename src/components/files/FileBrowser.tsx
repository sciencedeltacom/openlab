/**
 * Every file the open workspace holds, in one list.
 *
 * The list is the real folder, walked through `useWorkspaceFiles`, not a fixture: grouping
 * and facets answer "what kind", "how big" and "how old" without the reader moving through
 * directories. Rows are dense because this is a working file list, not a landing page. The
 * scope tabs remain for the connected stores the lab will add; today everything is local.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  Check,
  Clock,
  Cloud,
  Copy,
  ExternalLink,
  Filter,
  FilePlus,
  HardDrive,
  Layers,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';

import {
  Button,
  Chip,
  Dialog,
  IconButton,
  Input,
  Label,
  Popover,
  ScrollShadow,
  SectionLabel,
  Spinner,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
} from '@/components/ui';
import { RowMenu, type RowAction } from '@/components/common/RowMenu';
import { useCopy } from '@/hooks/useCopy';
import { useDebounced } from '@/hooks/useDebounced';
import { useFacetFilter, type FacetDef } from '@/hooks/useFacetFilter';
import { useWorkspaceFiles } from '@/hooks/useWorkspaceFiles';
import { invokeCommand } from '@/lib/ipc';
import { paths } from '@/app/routes';
import { cn } from '@/lib/cn';
import { formatBytes, relativeTime } from '@/lib/format';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import { MOTION } from '@/theme/tokens';
import { FILE_KINDS, FILE_SCOPES, type FileScope, type WorkspaceFile } from './data';
import { CloudPanel } from './CloudPanel';
import { SyncPanel } from './SyncPanel';
import { KIND_META } from './meta';

/** The two ways the list can be grouped. */
const GROUPINGS = ['kind', 'source'] as const;
type Grouping = (typeof GROUPINGS)[number];

/** Size buckets, keyed by the range they cover. */
const SIZE_BUCKETS: { id: string; label: string; test: (bytes: number) => boolean }[] = [
  { id: 'small', label: 'Under 1 MB', test: (bytes) => bytes < 1_048_576 },
  { id: 'medium', label: '1–100 MB', test: (bytes) => bytes >= 1_048_576 && bytes < 104_857_600 },
  { id: 'large', label: '100 MB–1 GB', test: (bytes) => bytes >= 104_857_600 && bytes < 1_073_741_824 },
  { id: 'huge', label: 'Over 1 GB', test: (bytes) => bytes >= 1_073_741_824 },
];

/** Age buckets, as days back from now. */
const MODIFIED_BUCKETS: { id: string; label: string; test: (ageDays: number) => boolean }[] = [
  { id: 'week', label: 'Last 7 days', test: (days) => days <= 7 },
  { id: 'month', label: 'Last 30 days', test: (days) => days <= 30 },
  { id: 'quarter', label: 'Last 90 days', test: (days) => days <= 90 },
  { id: 'older', label: 'Older', test: (days) => days > 90 },
];

/** The text a file search matches. */
function searchText(file: WorkspaceFile): string {
  return [file.name, file.path, file.source].join(' ');
}

/** A facet row that says whether it is on: tinted mark, label, check. */
function FacetRow({
  on,
  mark,
  label,
  onPress,
}: {
  on: boolean;
  mark: ReactNode;
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
      <span
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded',
          on ? 'bg-accent text-accent-foreground' : 'bg-surface-tertiary',
        )}
        aria-hidden
      >
        {on && <Check className="size-3" />}
      </span>
    </button>
  );
}

/** An icon in its own tinted square, the mark every facet row leads with. */
function Mark({ icon: Icon, tone, mark }: { icon: LucideIcon; tone: string; mark: string }) {
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-md', mark, tone)} aria-hidden>
      <Icon className="size-3.5" />
    </span>
  );
}

/** One file row. The whole row is the target; the menu sits beside it. */
function FileRow({
  file,
  showScope,
  onOpen,
  actions,
}: {
  file: WorkspaceFile;
  showScope: boolean;
  onOpen: () => void;
  actions: RowAction[];
}) {
  const meta = KIND_META[file.kind];
  const KindIcon = meta.icon;
  const cloud = file.scope === 'cloud';
  const SourceIcon = cloud ? Cloud : HardDrive;

  return (
    <div className="group flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-secondary"
        >
          <span
            className={cn('grid size-7 shrink-0 place-items-center rounded-lg', meta.mark, meta.tone)}
            aria-hidden
          >
            <KindIcon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body text-foreground">{file.name}</span>
            <span className="truncate text-meta text-muted">{file.path}</span>
          </span>
          {file.status === 'failed' && (
            <span className="flex shrink-0 items-center gap-1 text-meta text-danger">
              <TriangleAlert className="size-3" aria-hidden />
              Failed
            </span>
          )}
          {file.status === 'syncing' && <span className="shrink-0 text-meta text-accent">Syncing</span>}
          {showScope && (
            <span className="hidden shrink-0 items-center gap-1 text-meta text-muted sm:flex">
              <SourceIcon className="size-3" aria-hidden />
              {cloud ? 'Cloud' : 'Local'}
            </span>
          )}
          <span className="w-20 shrink-0 text-right text-meta tabular-nums text-muted">
            {formatBytes(file.bytes)}
          </span>
          <span className="hidden w-14 shrink-0 text-right text-meta tabular-nums text-muted lg:block">
            {relativeTime(file.modified)}
          </span>
        </button>
      </div>
      <RowMenu label={`Actions for ${file.name}`} actions={actions} className="mr-1 shrink-0" />
    </div>
  );
}

/** A headline tile for the scope's totals. */
function StatTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface p-3">
      <div className="text-meta text-muted">{label}</div>
      <div className={cn('text-title tabular-nums', tone ?? 'text-foreground')}>{value}</div>
      {note && <div className="text-meta text-muted">{note}</div>}
    </div>
  );
}

/**
 * A new file.
 *
 * The path is the whole question — where it goes and what it is called — so the field asks
 * for both and shows the folder it will land in. An existing file is refused rather than
 * overwritten: "new" is not "replace", and a silent overwrite is the one mistake here that
 * loses work. Creating it opens it, because a file you just made is a file you mean to write.
 */
function NewFileButton({ onCreated }: { onCreated: () => void }) {
  const { state, dispatch } = useApp();
  const root = activeProject(state)?.path ?? null;
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const name = path.trim().replace(/^\/+/, '');
  const canSubmit = Boolean(root && name) && !busy;

  const submit = async () => {
    if (!root || !name) {
      return;
    }
    setBusy(true);
    setError(null);
    const exists = await invokeCommand<boolean>('path_exists', { path: name, root });
    if (exists.ok && exists.value) {
      setBusy(false);
      setError(`${name} is already there.`);
      return;
    }
    const written = await invokeCommand('write_file', { path: name, contents: '', root });
    setBusy(false);
    if (!written.ok) {
      setError(written.error.message);
      return;
    }
    setOpen(false);
    setPath('');
    onCreated();
    dispatch({ type: 'route/go', route: paths.file(name) });
  };

  return (
    <>
      <Button variant="primary" size="sm" className="gap-1.5" onPress={() => setOpen(true)}>
        <FilePlus className="size-3.5" />
        New file
      </Button>
      <Dialog
        open={open}
        title="New file"
        description="A path inside the workspace. Folders in it are created."
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" isDisabled={!canSubmit} onPress={() => void submit()}>
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">Path</Label>
          <Input
            variant="secondary"
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="notes/amplicon.md"
            aria-label="New file path"
          />
          <span className="text-meta text-muted">
            {error ?? `Relative to ${root ?? 'the workspace'}. The kind of editor follows the extension.`}
          </span>
        </div>
      </Dialog>
    </>
  );
}

/** The file browser. */
export function FileBrowser() {
  const { state, dispatch } = useApp();
  const copy = useCopy();
  const root = activeProject(state)?.path ?? null;
  const { files: loaded, error: loadError, reload } = useWorkspaceFiles(root);
  /** Counts the page's own reloads, so the cloud scope can follow the same button. */
  const [reloads, setReloads] = useState(0);
  const [scope, setScope] = useState<FileScope | 'all' | 'sync'>('local');
  const [grouping, setGrouping] = useState<Grouping>('kind');
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<'kind' | 'size' | 'modified' | 'source'>('kind');
  /** The pair a fresh pairing made, so Sync opens on it rather than on the list. */
  const [newPair, setNewPair] = useState<string | null>(null);

  const files = useMemo(() => loaded ?? [], [loaded]);
  const sources = useMemo(() => Array.from(new Set(files.map((file) => file.source))).sort(), [files]);

  /** Reading a file gives it a page of its own, so it can be linked to and kept open. */
  const openFile = (file: WorkspaceFile) => dispatch({ type: 'route/go', route: paths.file(file.path) });

  /** The actions a file row offers. */
  const actionsFor = (file: WorkspaceFile): RowAction[] => [
    { id: 'open', label: 'Open', icon: ExternalLink, onSelect: () => openFile(file) },
    { id: 'copy', label: 'Copy path', icon: Copy, onSelect: () => copy(file.path, 'path') },
  ];

  const scoped = useMemo(
    () => (scope === 'all' || scope === 'sync' ? files : files.filter((file) => file.scope === scope)),
    [files, scope],
  );

  const now = useMemo(() => Date.now(), []);
  // Size and age are ranges, so a file belongs to whichever buckets its numbers fall in.
  const facetDefs = useMemo<FacetDef<WorkspaceFile>[]>(
    () => [
      { id: 'kind', valuesOf: (file) => [file.kind] },
      {
        id: 'size',
        valuesOf: (file) =>
          SIZE_BUCKETS.filter((bucket) => bucket.test(file.bytes)).map((bucket) => bucket.id),
      },
      {
        id: 'modified',
        valuesOf: (file) =>
          MODIFIED_BUCKETS.filter((bucket) => bucket.test((now - file.modified) / 86_400_000)).map(
            (bucket) => bucket.id,
          ),
      },
      { id: 'source', valuesOf: (file) => [file.source] },
    ],
    [now],
  );

  // The field draws every keystroke; the list catches up when typing pauses.
  const settledQuery = useDebounced(query);
  const filter = useFacetFilter(scoped, { facets: facetDefs, searchOf: searchText, query: settledQuery });
  const rows = filter.rows;
  const activeCount = filter.activeCount;

  const groups = useMemo(() => {
    if (grouping === 'kind') {
      return FILE_KINDS.map((kind) => ({
        id: kind.id as string,
        label: kind.label,
        icon: KIND_META[kind.id].icon,
        tone: KIND_META[kind.id].tone,
        mark: KIND_META[kind.id].mark,
        files: rows.filter((file) => file.kind === kind.id),
      })).filter((group) => group.files.length > 0);
    }
    return Array.from(new Set(rows.map((file) => file.source)))
      .sort()
      .map((source) => {
        const files = rows.filter((file) => file.source === source);
        return {
          id: source,
          label: source,
          icon: files.every((file) => file.scope === 'cloud') ? Cloud : HardDrive,
          tone: 'text-muted',
          mark: 'bg-surface',
          files,
        };
      });
  }, [grouping, rows]);

  const totalBytes = scoped.reduce((sum, file) => sum + file.bytes, 0);
  const folders = new Set(scoped.map((file) => file.path.split('/').slice(0, -1).join('/'))).size;
  const newest = scoped.reduce((latest, file) => Math.max(latest, file.modified), 0);

  return (
    <ScrollShadow className="flex h-full min-h-0 flex-col gap-4 px-4 pb-8">
      <motion.header
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
        className="flex w-full flex-col gap-3 pt-4"
      >
        <div className="flex items-center gap-2">
          <SectionLabel>Workspace files</SectionLabel>
          <div className="ml-auto flex items-center gap-1.5">
            <NewFileButton onCreated={reload} />
            <IconButton
              aria-label="Reload files"
              onPress={() => {
                reload();
                setReloads((value) => value + 1);
              }}
            >
              <RefreshCw className="size-4" />
            </IconButton>
          </div>
        </div>
        {scope !== 'sync' && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Files" value={String(scoped.length)} />
            <StatTile label="Folders" value={String(folders)} />
            <StatTile label="Total size" value={formatBytes(totalBytes)} />
            <StatTile label="Updated" value={newest === 0 ? '—' : relativeTime(newest)} />
          </div>
        )}
      </motion.header>

      <div className="flex w-full flex-col gap-3">
        <Tabs selectedKey={scope} onSelectionChange={(key) => setScope(key as FileScope | 'all' | 'sync')}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Scope">
              {FILE_SCOPES.map((entry) => {
                const ScopeIcon = entry.icon;
                return (
                  <Tabs.Tab key={entry.id} id={entry.id}>
                    <span className="flex items-center gap-1.5">
                      <ScopeIcon className="size-3.5 shrink-0" />
                      <span className="truncate">{entry.label}</span>
                    </span>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        {scope === 'cloud' ? (
          // A saved file lands in the workspace, so the list behind this panel reloads with it.
          <CloudPanel
            onSaved={reload}
            reloadSignal={reloads}
            onPaired={(pair) => {
              setNewPair(pair.id);
              setScope('sync');
            }}
          />
        ) : scope === 'sync' ? (
          <SyncPanel openPairId={newPair} onBrowseStores={() => setScope('cloud')} onChanged={reload} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex w-full max-w-sm items-center">
                <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, path or source"
                  aria-label="Search files"
                  className="w-full pl-9"
                />
              </div>

              <ToggleButtonGroup
                aria-label="Group by"
                selectionMode="single"
                selectedKeys={[grouping]}
                onSelectionChange={(keys) => {
                  const [first] = keys as Set<string>;
                  if (first) setGrouping(first as Grouping);
                }}
              >
                <ToggleButton id="kind">Kind</ToggleButton>
                <ToggleButton id="source">Source</ToggleButton>
              </ToggleButtonGroup>

              <Popover
                className="w-[280px]"
                trigger={
                  <Button size="sm" variant={activeCount ? 'secondary' : 'ghost'} className="gap-1.5">
                    <Filter className="size-3.5" />
                    Filter
                    {activeCount > 0 && <Chip size="sm">{activeCount}</Chip>}
                  </Button>
                }
              >
                <Tabs selectedKey={facet} onSelectionChange={(key) => setFacet(key as typeof facet)}>
                  <Tabs.ListContainer className="mx-1 mt-1">
                    <Tabs.List aria-label="Filter files by">
                      <Tabs.Tab id="kind">
                        Kind
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="size">
                        Size
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="modified">
                        Modified
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="source">
                        Source
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>

                  <Tabs.Panel id="kind">
                    <ScrollShadow className="max-h-[320px] px-1">
                      {FILE_KINDS.map((kind) => (
                        <FacetRow
                          key={kind.id}
                          on={filter.isOn('kind', kind.id)}
                          mark={
                            <Mark
                              icon={KIND_META[kind.id].icon}
                              tone={KIND_META[kind.id].tone}
                              mark={KIND_META[kind.id].mark}
                            />
                          }
                          label={kind.label}
                          onPress={() => filter.toggle('kind', kind.id)}
                        />
                      ))}
                    </ScrollShadow>
                  </Tabs.Panel>

                  <Tabs.Panel id="size">
                    <ScrollShadow className="max-h-[320px] px-1">
                      {SIZE_BUCKETS.map((bucket) => (
                        <FacetRow
                          key={bucket.id}
                          on={filter.isOn('size', bucket.id)}
                          mark={<Mark icon={Layers} tone="text-muted" mark="bg-surface" />}
                          label={bucket.label}
                          onPress={() => filter.toggle('size', bucket.id)}
                        />
                      ))}
                    </ScrollShadow>
                  </Tabs.Panel>

                  <Tabs.Panel id="modified">
                    <ScrollShadow className="max-h-[320px] px-1">
                      {MODIFIED_BUCKETS.map((bucket) => (
                        <FacetRow
                          key={bucket.id}
                          on={filter.isOn('modified', bucket.id)}
                          mark={<Mark icon={Clock} tone="text-muted" mark="bg-surface" />}
                          label={bucket.label}
                          onPress={() => filter.toggle('modified', bucket.id)}
                        />
                      ))}
                    </ScrollShadow>
                  </Tabs.Panel>

                  <Tabs.Panel id="source">
                    <ScrollShadow className="max-h-[320px] px-1">
                      {sources.map((source) => (
                        <FacetRow
                          key={source}
                          on={filter.isOn('source', source)}
                          mark={
                            <Mark
                              icon={
                                files.some((file) => file.source === source && file.scope === 'cloud')
                                  ? Cloud
                                  : HardDrive
                              }
                              tone="text-muted"
                              mark="bg-surface"
                            />
                          }
                          label={source}
                          onPress={() => filter.toggle('source', source)}
                        />
                      ))}
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

              <span className="ml-auto text-meta tabular-nums text-muted">
                {rows.length} of {scoped.length} files
              </span>
            </div>

            {loaded === null ? (
              <div className="grid place-items-center py-10">
                <Spinner />
              </div>
            ) : loadError ? (
              <div className="rounded-3xl bg-surface p-8 text-center">
                <TriangleAlert className="mx-auto size-5 text-danger" aria-hidden />
                <p className="mt-2 text-body text-muted">{loadError}</p>
              </div>
            ) : !root ? (
              <div className="rounded-3xl bg-surface p-8 text-center">
                <TriangleAlert className="mx-auto size-5 text-muted" aria-hidden />
                <p className="mt-2 text-body text-muted">No folder is open.</p>
              </div>
            ) : files.length === 0 ? (
              <div className="rounded-3xl bg-surface p-8 text-center">
                <Search className="mx-auto size-5 text-muted" aria-hidden />
                <p className="mt-2 text-body text-muted">This workspace has no files yet.</p>
              </div>
            ) : groups.length === 0 ? (
              <div className="rounded-3xl bg-surface p-8 text-center">
                <Search className="mx-auto size-5 text-muted" aria-hidden />
                <p className="mt-2 text-body text-muted">No file matches the current filters.</p>
              </div>
            ) : (
              <div className="flex flex-col pb-4">
                {groups.map((group) => {
                  const GroupIcon = group.icon;
                  return (
                    <section key={group.id} className="mt-4 first:mt-0">
                      <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur">
                        <span
                          className={cn(
                            'grid size-5 shrink-0 place-items-center rounded-md',
                            group.mark,
                            group.tone,
                          )}
                          aria-hidden
                        >
                          <GroupIcon className="size-3.5" />
                        </span>
                        <SectionLabel>{group.label}</SectionLabel>
                        <span className="text-meta tabular-nums text-muted">{group.files.length}</span>
                      </header>
                      <div className="flex flex-col">
                        {group.files.map((file) => (
                          <FileRow
                            key={file.id}
                            file={file}
                            showScope={scope === 'all'}
                            actions={actionsFor(file)}
                            onOpen={() => openFile(file)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </ScrollShadow>
  );
}
