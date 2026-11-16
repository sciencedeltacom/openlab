/**
 * The Sync scope of the Files page: paired folders, compared and kept level by hand.
 *
 * Pairing is made in the Cloud scope — that is where the store's folder is — so this panel
 * starts by listing what is paired. Opening one walks both sides and shows every file's state;
 * each row's two buttons are the direction for that file, and nothing moves without one.
 *
 * A comparison is by size, not by hash: see `lib/cloud/pairing`.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  CloudDownload,
  CloudUpload,
  File,
  FolderSync,
  LoaderCircle,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import {
  Button,
  Chip,
  IconButton,
  SectionLabel,
  Spinner,
  ToggleButton,
  ToggleButtonGroup,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import {
  canPush,
  comparePair,
  pullRow,
  pushRow,
  type SyncDiff,
  type SyncRow,
  type SyncState,
} from '@/lib/cloud/pairing';
import { removePair, usePairs } from '@/lib/cloud/store';
import type { SyncPair } from '@/lib/cloud/types';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';

/** How each state reads, and the tone its chip carries. */
const STATE_META: Record<SyncState, { label: string; tone: string }> = {
  'local-only': { label: 'Only here', tone: 'text-accent' },
  'remote-only': { label: 'Only remote', tone: 'text-muted' },
  differs: { label: 'Differs', tone: 'text-warning' },
  same: { label: 'In sync', tone: 'text-success' },
  unknown: { label: "Can't compare", tone: 'text-muted' },
};

/** The two places a pair names, as one line. */
function pairPath(pair: SyncPair): string {
  if (pair.kind === 'file') {
    return `${pair.remoteName} → ${pair.localPath}`;
  }
  const local = pair.localPath ? `/${pair.localPath}` : '/';
  return `${pair.remoteName} ${local}`;
}

/** One file's row: where it stands, and the two directions it can move in. */
function SyncRowView({
  row,
  canPushFile,
  working,
  onPull,
  onPush,
}: {
  row: SyncRow;
  canPushFile: boolean;
  working: boolean;
  onPull: () => void;
  onPush: () => void;
}) {
  const meta = STATE_META[row.state];
  const localSize = row.local ? formatBytes(row.local.size) : '—';
  const remoteSize = row.remote?.size !== undefined ? formatBytes(row.remote.size) : '—';

  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-surface-secondary">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-foreground">{row.name}</span>
        <span className="block truncate text-meta text-muted">{row.path}</span>
      </span>
      <span className={cn('hidden shrink-0 text-meta sm:block', meta.tone)}>{meta.label}</span>
      <span className="w-16 shrink-0 text-right text-meta tabular-nums text-muted">{localSize}</span>
      <ArrowRightLeft className="hidden size-3 shrink-0 text-muted sm:block" aria-hidden />
      <span className="w-16 shrink-0 text-right text-meta tabular-nums text-muted">{remoteSize}</span>
      <div className="flex shrink-0 items-center">
        {working ? (
          <LoaderCircle className="size-4 animate-spin text-muted" aria-hidden />
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 px-1.5 text-meta"
              isDisabled={!row.remote}
              onPress={onPull}
              aria-label={`Use the store's copy of ${row.name}`}
            >
              <CloudDownload className="size-3.5" />
              <span className="hidden md:inline">Take remote</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 px-1.5 text-meta"
              isDisabled={!row.local || !canPushFile || row.native}
              onPress={onPush}
              aria-label={`Keep this copy of ${row.name} and send it to the store`}
            >
              <CloudUpload className="size-3.5" />
              <span className="hidden md:inline">Keep mine</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** The paired folders, and the one that is open. */
export function SyncPanel({
  onBrowseStores,
  onChanged,
  openPairId,
}: {
  /** Switch to the Cloud scope, where a pair is made. */
  onBrowseStores: () => void;
  /** Called after a file lands, so the local list behind this panel reloads with it. */
  onChanged?: () => void;
  /** A pair to open on arrival, when the reader has just made one. */
  openPairId?: string | null;
}) {
  const { state } = useApp();
  const root = activeProject(state)?.path ?? null;
  const pairs = usePairs();

  const [openId, setOpenId] = useState<string | null>(openPairId ?? null);
  const [diff, setDiff] = useState<SyncDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);

  const pair = openId ? pairs.find((entry) => entry.id === openId) : undefined;

  const compare = useCallback(
    async (target: SyncPair) => {
      if (!root) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        setDiff(await comparePair(target, root));
      } catch (failure) {
        setDiff(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(false);
      }
    },
    [root],
  );

  // Opening a pair compares it at once: the count is the reason to open it.
  useEffect(() => {
    setNotice(null);
    setError(null);
    if (!pair) {
      setDiff(null);
      return;
    }
    void compare(pair);
  }, [pair, compare]);

  /** Move one file, then re-read both sides so the row says what really happened. */
  const act = async (row: SyncRow, direction: 'pull' | 'push') => {
    if (!pair || !root) {
      return;
    }
    setWorking(row.path);
    setError(null);
    setNotice(null);
    try {
      if (direction === 'pull') {
        await pullRow(pair, row, root);
        setNotice(`${row.name} came down from ${pair.remoteName}.`);
        onChanged?.();
      } else {
        await pushRow(pair, row, root);
        setNotice(`${row.name} went up to ${pair.remoteName}.`);
      }
      await compare(pair);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setWorking(null);
    }
  };

  if (pairs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface p-8 text-center">
        <FolderSync className="size-5 text-muted" aria-hidden />
        <div>
          <p className="text-body text-foreground">Nothing is paired yet.</p>
          <p className="text-meta text-muted">
            Open a store, find a folder or a file, and pair it with one here.
          </p>
        </div>
        <Button size="sm" variant="secondary" onPress={onBrowseStores}>
          Open a store
        </Button>
      </div>
    );
  }

  if (!pair) {
    return (
      <div className="flex w-full flex-col gap-3">
        <div className="flex items-center gap-2">
          <SectionLabel>Pairs</SectionLabel>
          <Button size="sm" variant="secondary" className="ml-auto" onPress={onBrowseStores}>
            Pair something
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {pairs.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-2xl bg-surface p-3 transition-colors hover:bg-surface-secondary"
            >
              <span
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-tertiary text-muted"
                aria-hidden
              >
                {entry.kind === 'file' ? <File className="size-4" /> : <FolderSync className="size-4" />}
              </span>
              <button type="button" onClick={() => setOpenId(entry.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-body font-medium text-foreground">{entry.label}</span>
                <span className="block truncate text-meta text-muted">{pairPath(entry)}</span>
              </button>
              {!canPush(entry) && (
                <Chip size="sm" variant="soft" className="text-meta">
                  Read-only
                </Chip>
              )}
              <ArrowRight className="size-4 text-muted" aria-hidden />
              <IconButton
                aria-label={`Forget the pairing ${entry.label}`}
                onPress={() => removePair(entry.id)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rows = (diff?.rows ?? []).filter((row) => !onlyChanges || row.state !== 'same');
  const counts = diff?.counts;
  const pushable = canPush(pair);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="rounded-lg px-1.5 py-1 text-body text-muted transition-colors hover:text-foreground"
        >
          Pairs
        </button>
        <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-body text-foreground">{pair.label}</span>
        <Chip size="sm" variant="soft" className="hidden text-meta sm:flex">
          {pairPath(pair)}
        </Chip>
        <IconButton
          aria-label="Compare the two folders again"
          onPress={() => void compare(pair)}
          isDisabled={busy}
        >
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </IconButton>
      </div>

      {counts && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip size="sm" variant="soft" className="text-meta">
            {counts['local-only']} only here
          </Chip>
          <Chip size="sm" variant="soft" className="text-meta">
            {counts['remote-only']} only remote
          </Chip>
          <Chip size="sm" variant="soft" className="text-meta">
            {counts.differs} differ
          </Chip>
          <Chip size="sm" variant="soft" className="text-meta">
            {counts.same} in sync
          </Chip>
          <ToggleButtonGroup
            aria-label="Which files to show"
            selectionMode="single"
            selectedKeys={[onlyChanges ? 'changes' : 'all']}
            onSelectionChange={(keys) => {
              const [first] = keys as Set<string>;
              if (first) setOnlyChanges(first === 'changes');
            }}
            className="ml-auto"
          >
            <ToggleButton id="changes">Changes</ToggleButton>
            <ToggleButton id="all">All</ToggleButton>
          </ToggleButtonGroup>
        </div>
      )}

      {notice && (
        <button
          type="button"
          onClick={() => setNotice(null)}
          className="rounded-2xl bg-accent-soft px-3 py-2 text-left text-meta text-accent-soft-foreground"
        >
          {notice}
        </button>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-danger-soft p-3 text-body text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {busy && diff === null ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : diff === null ? (
        <div className="rounded-3xl bg-surface p-6 text-center text-body text-muted">
          This pair has not been compared yet.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl bg-surface p-6 text-center text-body text-muted">
          {onlyChanges ? 'Both sides are level.' : 'Neither side has a file in it.'}
        </div>
      ) : (
        <div className="flex flex-col rounded-3xl bg-surface py-1">
          {rows.map((row) => (
            <SyncRowView
              key={row.path}
              row={row}
              canPushFile={pushable}
              working={working === row.path}
              onPull={() => void act(row, 'pull')}
              onPush={() => void act(row, 'push')}
            />
          ))}
        </div>
      )}

      {diff !== null && diff.counts.unknown > 0 && (
        <p className="text-meta text-muted">
          A Google document has no size of its own, so {diff.counts.unknown === 1 ? 'it shows' : 'they show'}{' '}
          as “can't compare”; pulling one brings its export down, and nothing can push into it.
        </p>
      )}

      <p className="text-meta text-muted">
        A comparison reads both sides' metadata, not the files: two copies count as level when they report one
        size. Nothing moves until you choose a direction for a file.
      </p>
    </div>
  );
}
