/**
 * The subagents a session has delegated to.
 *
 * A delegation is work the lead handed off, and it is worth watching: each one opens a session
 * of its own, so this panel is where they are listed while the lead's turn is still running.
 * Opening one leaves the lead's page alone — the child is a tab of its own, and the lead keeps
 * its transcript. The panel folds into a pill like the plan does (see {@link DockPanel}).
 */

import { useMemo, useState } from 'react';
import { Check, LoaderCircle, Users } from 'lucide-react';

import { AgentAvatarGroup } from '@/components/agents/AgentAvatarGroup';
import { AgentOrb } from '@/components/agents/AgentOrb';
import { defaultAvatarColor } from '@/components/agents/data';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import type { Session } from '@/store/types';
import { DockPanel } from './DockPanel';

/** One delegated session, from the worker's mark to its state. */
function SubsessionRow({ session }: { session: Session }) {
  const { dispatch } = useApp();
  const worker = session.worker?.name ?? 'Worker';
  const running = session.finishedAt === undefined;
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'route/go', route: paths.session(session.id) })}
      className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-surface-tertiary"
    >
      <AgentOrb
        color={defaultAvatarColor(worker)}
        size={20}
        active={running}
        state={running ? 'working' : 'breathing'}
        paused={!running}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-foreground">{session.title}</span>
        <span className="block truncate text-meta text-muted">{worker}</span>
      </span>
      {session.usage && (
        <span className="shrink-0 text-meta tabular-nums text-muted">
          {tokenCount(session.usage).toLocaleString()}
        </span>
      )}
      {running ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin text-accent" aria-label="Working" />
      ) : (
        <Check className="size-3 shrink-0 text-success" aria-label="Finished" />
      )}
    </button>
  );
}

/** Every token a worker's turn spent, in and out. */
function tokenCount(usage: NonNullable<Session['usage']>): number {
  return usage.input + usage.output;
}

/** The panel, when the session has delegated anything. */
export function SubagentsPanel({ sessionId }: { sessionId: string }) {
  const { state } = useApp();
  const [open, setOpen] = useState(true);
  const children = useMemo(
    () =>
      state.sessions
        .filter((session) => session.parentId === sessionId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [state.sessions, sessionId],
  );

  if (children.length === 0) {
    return null;
  }

  const working = children.filter((session) => session.finishedAt === undefined).length;
  const count = `${children.length} ${children.length === 1 ? 'subagent' : 'subagents'}`;
  const workers = children.map((child) => child.worker?.name ?? 'Worker');

  return (
    <DockPanel
      layoutId={`subagents-${sessionId}`}
      icon={Users}
      label="Subagents"
      meta={
        <>
          {children.length}
          {working > 0 ? ` · ${working} working` : ''}
        </>
      }
      open={open}
      onToggle={setOpen}
      mark={<AgentAvatarGroup names={workers} />}
      status={<AgentAvatarGroup names={workers} />}
      pill={
        <>
          {working > 0 && <LoaderCircle className="size-3 animate-spin text-accent" aria-hidden />}
          <span className="tabular-nums">{count}</span>
          {working > 0 && <span className="tabular-nums"> · {working} working</span>}
        </>
      }
    >
      <div className="flex max-h-[168px] flex-col overflow-y-auto">
        {children.map((child) => (
          <SubsessionRow key={child.id} session={child} />
        ))}
      </div>
    </DockPanel>
  );
}
