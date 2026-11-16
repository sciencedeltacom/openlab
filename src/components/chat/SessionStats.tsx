/**
 * What a session has actually done.
 *
 * Read out of the session's own transcript rather than out of a counter somewhere: every
 * number here is a block the turn already wrote down — the runs it took, the tokens they
 * spent, the tools they called and the files they touched — so the panel cannot disagree
 * with the record it is describing. A session with no turns yet says so instead of showing
 * zeros that look like work.
 */

import { FileText, GitCompareArrows } from 'lucide-react';

import { Chip, Spinner } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { activeProject, activeSession, type Block } from '@/store/types';
import { useApp } from '@/store/app';
import { Figure, PanelLine, PanelSection } from './PanelParts';

/** A duration a person reads: `4m 12s`, or `0s`. */
function duration(ms: number): string {
  if (ms <= 0) {
    return '0s';
  }
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** What the transcript adds up to. */
function tally(blocks: readonly Block[]) {
  let turns = 0;
  let runMs = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let cached = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;
  const written = new Set<string>();
  const tools = new Map<string, { count: number; errors: number }>();

  for (const block of blocks) {
    if (block.kind === 'run') {
      turns += 1;
      runMs += block.durationMs;
      tokensIn += block.tokensIn ?? 0;
      tokensOut += block.tokensOut ?? 0;
      cached += block.cachedTokens ?? 0;
    }
    if (block.kind === 'diff') {
      changed += block.filesChanged;
      added += block.added;
      removed += block.removed;
    }
    if (block.kind === 'tool') {
      const entry = tools.get(block.name) ?? { count: 0, errors: 0 };
      entry.count += 1;
      if (block.status === 'error') {
        entry.errors += 1;
      }
      tools.set(block.name, entry);
      if (block.name === 'write_file' && typeof block.input?.path === 'string') {
        written.add(block.input.path);
      }
    }
  }

  return {
    turns,
    runMs,
    tokensIn,
    tokensOut,
    cached,
    changed,
    added,
    removed,
    written: [...written],
    tools: [...tools.entries()].sort((a, b) => b[1].count - a[1].count),
  };
}

/** A dot with a word, for the token legend. */
function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="text-meta text-muted">{label}</span>
      <span className="text-meta tabular-nums text-foreground">{value}</span>
    </span>
  );
}

/** The session's numbers. */
export function SessionStats() {
  const { state } = useApp();
  const session = activeSession(state);
  const project = activeProject(state);
  const totals = tally(state.messages.flatMap((message) => message.blocks));

  const started = session?.createdAt ?? Date.now();
  const elapsed = Date.now() - started;
  const git = state.git;
  const spent = totals.tokensIn + totals.tokensOut;
  const share = spent > 0 ? totals.tokensIn / spent : 0;

  if (!session) {
    return <p className="px-4 py-6 text-body text-muted">No session is open.</p>;
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-5">
      <div className="grid grid-cols-2 gap-4 pt-1">
        <Figure
          label="Turns"
          value={String(totals.turns)}
          hint={state.running ? 'one is running' : `open ${duration(elapsed)}`}
        />
        <Figure label="In the model" value={duration(totals.runMs)} hint="across its turns" />
      </div>

      <PanelSection
        label="Tokens"
        aside={totals.cached > 0 ? `${totals.cached.toLocaleString('en-US')} cached` : undefined}
      >
        <div className="flex items-baseline gap-1.5">
          <span className="text-[1.55rem] leading-none font-semibold tracking-tight tabular-nums text-foreground">
            {spent.toLocaleString('en-US')}
          </span>
          <span className="text-meta text-muted">tokens spent</span>
        </div>
        {/* In and out are the two halves of the spend, so they are one bar, not two. An empty
            session gets an empty track rather than a full bar that says nothing was spent. */}
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary">
          {spent > 0 && (
            <>
              <div
                className="h-full"
                style={{
                  width: `${share * 100}%`,
                  background: 'var(--accent)',
                  transition: 'width 0.55s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
              <div className="h-full flex-1" style={{ background: 'var(--accent-secondary)' }} />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Legend color="var(--accent)" label="in" value={totals.tokensIn.toLocaleString('en-US')} />
          <Legend
            color="var(--accent-secondary)"
            label="out"
            value={totals.tokensOut.toLocaleString('en-US')}
          />
        </div>
      </PanelSection>

      <PanelSection label="Files" aside={totals.written.length}>
        {totals.written.length === 0 ? (
          <p className="text-body text-muted">The agent has not written a file in this session.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-separator">
            {totals.written.map((path) => (
              <li key={path} className="flex items-center gap-2 py-1.5">
                <FileText className="size-3 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-meta text-foreground">{path}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col divide-y divide-separator">
          {totals.changed > 0 && (
            <PanelLine
              label={`${totals.changed} file${totals.changed === 1 ? '' : 's'} changed`}
              value={
                <span>
                  <span className="text-success">+{totals.added}</span>{' '}
                  <span className="text-danger">−{totals.removed}</span>
                </span>
              }
            />
          )}
          {/* What the working tree looks like now, which is a fact about the folder rather than
              about the turn. */}
          {git?.files && git.files.length > 0 && (
            <PanelLine
              label={
                <span className="flex items-center gap-1.5">
                  <GitCompareArrows className="size-3 shrink-0 text-accent" aria-hidden />
                  {git.files.length} in the workspace
                </span>
              }
              value={git.info.branch ?? ''}
            />
          )}
        </div>
      </PanelSection>

      <PanelSection label="Tools" aside={totals.tools.length}>
        {totals.tools.length > 0 && (
          <div className="flex items-center gap-2">
            {state.running && <Spinner size="sm" />}
            <span className="text-meta text-muted">
              {state.running ? 'A turn is calling tools now.' : 'Every call this session made.'}
            </span>
          </div>
        )}
        {totals.tools.length === 0 ? (
          <p className="text-body text-muted">No tool has run in this session.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-separator">
            {totals.tools.map(([name, entry]) => (
              <li key={name} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-meta text-foreground">{name}</span>
                {entry.errors > 0 && (
                  <Chip color="danger" className="text-meta tabular-nums">
                    {entry.errors} failed
                  </Chip>
                )}
                <span className="shrink-0 text-meta tabular-nums text-muted">{entry.count}</span>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </div>
  );
}
