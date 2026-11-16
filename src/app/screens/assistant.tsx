/**
 * The Assistant section's screens.
 *
 * A session is a line of enquiry and its page is the transcript, so the list lives here
 * rather than in a column beside the conversation: sessions come first, and opening one is
 * navigation rather than a selection in a sidebar.
 *
 * Saved results share the file because both are the Assistant's library, and their specs
 * are the single source their lists and record pages render from.
 */

import { useState } from 'react';
import { BookMarked, Check, Download, LoaderCircle, Pin, PinOff, Plus, TestTube, Trash2 } from 'lucide-react';

import { csvField } from '@/components/chat/MarkdownTable';
import type { CatalogScreenSpec } from '@/components/screens/spec';
import {
  Button,
  Chip,
  IconButton,
  MonoPill,
  PhaseChip,
  Popover,
  ScrollShadow,
  SectionLabel,
  ToggleButton,
  ToggleButtonGroup,
} from '@/components/ui';
import { RecordLink } from '@/components/research/PageShell';
import { AgentOrb } from '@/components/agents/AgentOrb';
import {
  agentTeams,
  findAgent,
  patchAgent,
  setActiveAgent,
  useActiveAgentId,
  useAgents,
} from '@/components/agents/store';
import { AVATAR_COLORS, defaultAvatarColor, type Agent } from '@/components/agents/data';
import { useExperiments } from '@/components/experiments/store';
import { DETAILS, paths } from '@/app/routes';
import { cn } from '@/lib/cn';
import { formatClock, relativeTime } from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import { useApp } from '@/store/app';
import { allProviders, type AppState, type Message, type SavedResult, type Session } from '@/store/types';
import { modelLabel } from '@/lib/providers';

/**
 * The record pattern a session card links to.
 *
 * Read from the route tree rather than spelled out so the list cannot drift from a path the
 * registry knows how to resolve.
 */
const SESSION_PATTERN =
  DETAILS.find((detail) => detail.parent === 'assistant')?.pattern ?? 'assistant/:sessionId';

/**
 * What is worth saying about a session in a list.
 *
 * Not its turn count: the store keeps one transcript — whichever session is open — and does
 * not key messages by session, so every other session would report zero. A number that is
 * wrong for most rows is worse than no number, and the row has room for facts that are true:
 * the phase, the branch, when it was last touched.
 */
/**
 * Every session across every project, newest first, grouped by project.
 *
 * Grouping is the facet, so the filter at the top of the list becomes a project filter
 * without a second control to build.
 */
export function sessionsSpec(state: AppState): CatalogScreenSpec {
  const projectNames = new Map(state.projects.map((project) => [project.id, project.name]));
  // A worker's session is listed under the lead that delegated it, not in the index: it is
  // part of a turn, not a line of enquiry of its own.
  const sessions = state.sessions
    .filter((session) => !session.parentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    kind: 'catalog',
    facetLabel: 'Project',
    columns: 2,
    entries: sessions.map((session) => {
      const project = projectNames.get(session.projectId) ?? 'Scratch';
      return {
        id: session.id,
        name: session.title,
        summary: `Last touched ${relativeTime(session.updatedAt)}`,
        group: project,
        meta: [project],
        footer: (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PhaseChip phase={session.phase} />
            {session.branch && <MonoPill>{session.branch}</MonoPill>}
          </div>
        ),
      };
    }),
    empty: 'No sessions yet. Start one and it will appear here.',
    records: { noun: 'Session' },
  };
}

/** The saved results as CSV, so the list is something a reader can take elsewhere. */
function resultsCsv(results: readonly SavedResult[]): string {
  const header = 'name,path,session,createdAt,pinned';
  const rows = results.map((result) =>
    [
      result.name,
      result.path,
      result.sessionId ?? '',
      new Date(result.createdAt).toISOString(),
      String(result.pinned),
    ]
      .map(csvField)
      .join(','),
  );
  return [header, ...rows].join('\n');
}

/** Download the results as a CSV file. */
function exportResults(results: readonly SavedResult[]): void {
  const blob = new Blob([resultsCsv(results)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'openlab-results.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Pin and remove, from a result's own row. */
function ResultActions({ result }: { result: SavedResult }) {
  const { dispatch } = useApp();
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5"
        onPress={() => dispatch({ type: 'result/pin', id: result.id })}
      >
        {result.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        {result.pinned ? 'Unpin' : 'Pin'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5 text-danger"
        onPress={() => dispatch({ type: 'result/remove', id: result.id })}
      >
        <Trash2 className="size-3.5" />
        Remove
      </Button>
    </div>
  );
}

/**
 * The saved results, as a catalogue spec.
 *
 * Shared by the list and by each result's own page: a record page is a view of the same data,
 * so there is one description of a result rather than two that can drift. A result is recorded
 * when the agent writes a file, so the list is a record of what actually happened.
 */
export function resultsSpec(results: readonly SavedResult[]): CatalogScreenSpec {
  return {
    kind: 'catalog',
    facetLabel: 'State',
    columns: 2,
    actions: (
      <Button
        size="sm"
        variant="secondary"
        className="gap-1.5"
        isDisabled={results.length === 0}
        onPress={() => exportResults(results)}
      >
        <Download className="size-3.5" />
        Export all as CSV
      </Button>
    ),
    entries: results.map((result) => ({
      id: result.id,
      name: result.name,
      summary: result.path || 'No file recorded.',
      group: result.pinned ? 'Pinned' : 'Recent',
      meta: [relativeTime(result.createdAt), ...(result.sessionId ? [result.sessionId] : [])],
      status: result.pinned ? { label: 'pinned', tone: 'ok' as const } : undefined,
      footer: <ResultActions result={result} />,
    })),
    empty: 'No results yet. When the agent writes a file, it is recorded here.',
    records: { noun: 'Result' },
  };
}

/* ================================================================================================
 * The AI home
 * ============================================================================================== */

/** Every token a session's own turns spent, read from their run footers. */
function tokensOf(messages: readonly Message[]): number {
  let total = 0;
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === 'run') {
        total += (block.tokensIn ?? 0) + (block.tokensOut ?? 0);
      }
    }
  }
  return total;
}

/** One delegated session, nested under the lead that asked for it. */
function SubsessionLine({ session }: { session: Session }) {
  const worker = session.worker?.name ?? 'Worker';
  const running = session.finishedAt === undefined;
  const tokens = session.usage ? session.usage.input + session.usage.output : 0;
  return (
    <RecordLink
      route={paths.session(session.id)}
      className="flex items-center gap-2 rounded-lg px-2 py-1 text-meta transition-colors hover:bg-surface-secondary"
    >
      <AgentOrb
        color={defaultAvatarColor(worker)}
        size={20}
        active={running}
        state={running ? 'working' : 'breathing'}
        paused={!running}
      />
      <span className="min-w-0 flex-1 truncate text-body text-muted">{session.title}</span>
      <span className="shrink-0 text-muted">{worker}</span>
      {tokens > 0 && (
        <span className="shrink-0 tabular-nums text-muted">{tokens.toLocaleString()} tokens</span>
      )}
      {running ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin text-accent" aria-label="Working" />
      ) : (
        <Check className="size-3 shrink-0 text-success" aria-label="Finished" />
      )}
    </RecordLink>
  );
}

/**
 * One of the chosen agent's sessions, with what it cost, ran on, and was filed under.
 *
 * A delegation is part of the session, not a session of its own in this list: the children
 * hang under the row that opened them, each with the worker that ran it and what it spent.
 */
function SessionRow({
  session,
  project,
  tokens,
  models,
  experiment,
  running,
  now,
  children,
}: {
  session: Session;
  project: string;
  tokens: number;
  models: string[];
  /** The experiment this session is filed under, if any. */
  experiment?: { id: string; objective: string };
  /** When the run started, while this session is still working. */
  running?: number;
  now: number;
  /** The sessions this one delegated to, oldest first. */
  children: Session[];
}) {
  const agent = session.agentId ? findAgent(session.agentId) : undefined;
  const delegated = children.reduce(
    (sum, child) => sum + (child.usage ? child.usage.input + child.usage.output : 0),
    0,
  );
  return (
    <div className="flex flex-col">
      <div className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-secondary">
        <RecordLink route={paths.session(session.id)} className="min-w-0 flex-1">
          <span className="block truncate text-body text-foreground">{session.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-meta text-muted">
            {agent && (
              <span className="flex items-center gap-1">
                <AgentOrb color={agent.avatarColor ?? defaultAvatarColor(agent.name)} size={20} paused />
                <span className="text-foreground">{agent.name}</span>
              </span>
            )}
            <span className="truncate">{project}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">{relativeTime(session.updatedAt)}</span>
            {tokens > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 tabular-nums">{tokens.toLocaleString()} tokens</span>
              </>
            )}
            {delegated > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 tabular-nums">{delegated.toLocaleString()} in subagents</span>
              </>
            )}
            {models.map((model) => (
              <Chip key={model} size="sm" className="text-meta">
                {model}
              </Chip>
            ))}
          </span>
        </RecordLink>

        {experiment && (
          <RecordLink
            route={`analyze/experiments/${experiment.id}`}
            className="hidden max-w-[220px] shrink-0 sm:block"
          >
            <Chip size="sm" variant="soft" color="accent" className="max-w-full text-meta">
              <TestTube className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{experiment.objective || experiment.id}</span>
            </Chip>
          </RecordLink>
        )}

        {running !== undefined && (
          <span className="shrink-0 text-meta tabular-nums text-accent">{formatClock(now - running)}</span>
        )}
      </div>

      {children.length > 0 && (
        <div className="mb-1 ms-8 flex flex-col border-s border-separator ps-2">
          {children.map((child) => (
            <SubsessionLine key={child.id} session={child} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The AI home.
 *
 * A single list of sessions, and the agents as a row of orbs and names along the bottom — pick
 * one and the list above becomes its sessions. Each session shows what it cost, which models it
 * ran on, and the experiment it was filed under.
 */
export function AssistantHome() {
  const { state, dispatch, newSession } = useApp();
  const agents = useAgents();
  const activeId = useActiveAgentId();
  const experiments = useExperiments();
  const [scope, setScope] = useState<'agent' | 'all'>('agent');

  const projectNames = new Map(state.projects.map((project) => [project.id, project.name]));
  const experimentById = new Map(experiments.map((experiment) => [experiment.id, experiment]));
  const sessions = state.sessions
    .filter((session) => !session.parentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const agent = agents.find((candidate) => candidate.id === activeId) ?? agents[0]!;
  const tagged = sessions.filter((session) => session.agentId === activeId);
  const shown = scope === 'all' ? sessions : tagged;
  const now = useNow(Object.keys(state.runs).length > 0);

  /** A session's transcript: the open one, or the stored one. */
  const messagesOf = (session: Session) =>
    state.transcripts[session.id] ?? (session.id === state.activeSessionId ? state.messages : []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={() => setScope((current) => (current === 'all' ? 'agent' : 'all'))}
          className="text-meta text-muted transition-colors hover:text-foreground"
        >
          {scope === 'all' ? 'All sessions' : `${agent.name}’s sessions`}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Saved results used to be a button in the application's top bar. It is the AI
              section's own list, so it belongs on the AI section's own page. */}
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onPress={() => dispatch({ type: 'route/go', route: 'assistant/results' })}
          >
            <BookMarked className="size-3.5" />
            Saved results
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onPress={newSession}>
            <Plus className="size-3.5" />
            New session
          </Button>
        </div>
      </div>

      <ScrollShadow className="min-h-0 flex-1 px-3 py-2">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-body text-foreground">
              {scope === 'all' ? 'No sessions yet.' : `No sessions with ${agent.name} yet.`}
            </p>
            <Button size="sm" variant="secondary" className="gap-1.5" onPress={newSession}>
              <Plus className="size-3.5" />
              New session
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {shown.map((session) => {
              const messages = messagesOf(session);
              const tokens = tokensOf(messages);
              const modelSet = new Set<string>();
              for (const message of messages) {
                for (const block of message.blocks) {
                  if (block.kind === 'run') {
                    modelSet.add(block.modelRef);
                  }
                }
              }
              // The row names the models as a reader knows them, not by the id it stored.
              const providers = allProviders(state);
              const models = [...new Set([...modelSet].map((modelRef) => modelLabel(providers, modelRef)))];
              const children = state.sessions
                .filter((candidate) => candidate.parentId === session.id)
                .sort((a, b) => a.createdAt - b.createdAt);
              const experiment = session.experimentId ? experimentById.get(session.experimentId) : undefined;
              return (
                <SessionRow
                  key={session.id}
                  session={session}
                  project={projectNames.get(session.projectId) ?? 'Scratch'}
                  tokens={tokens}
                  models={models}
                  children={children}
                  experiment={experiment ? { id: experiment.id, objective: experiment.objective } : undefined}
                  running={state.runs[session.id]?.startedAt}
                  now={now}
                />
              );
            })}
          </div>
        )}
      </ScrollShadow>

      <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t border-separator px-4 py-3">
        {agents.map((candidate) => {
          const color = candidate.avatarColor ?? defaultAvatarColor(candidate.name);
          const active = candidate.id === activeId;
          return (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveAgent(candidate.id)}
              className={cn(
                'flex items-center gap-2 rounded-full py-1 pe-3 ps-1 text-body transition-colors',
                active
                  ? 'bg-surface-secondary font-medium text-foreground'
                  : 'text-muted hover:bg-surface-secondary hover:text-foreground',
              )}
            >
              <AgentOrb color={color} size={20} active={active} />
              {candidate.name}
            </button>
          );
        })}
        <button
          type="button"
          aria-label="New agent"
          onClick={() => dispatch({ type: 'route/go', route: 'agents/new' })}
          className="ml-1 grid size-7 place-items-center rounded-full text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </footer>
    </div>
  );
}
