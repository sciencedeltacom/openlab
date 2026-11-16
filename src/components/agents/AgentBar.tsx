/**
 * The agent bar.
 *
 * The right column of the AI page: the agents the workbench can run as, grouped by team. One
 * is active at a time and leads the next turn; `main` ships with the app and cannot be removed,
 * so the bar can never leave the workbench without an agent. Creating an agent also chooses it,
 * because the bar's whole job is to answer "who answers next".
 */

import { useState } from 'react';
import { Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button, ScrollShadow, SectionLabel, Surface } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import { useApp } from '@/store/app';
import { SessionTools } from '@/components/chat/SessionTools';
import { RowMenu, type RowAction } from '@/components/common/RowMenu';
import { notify } from '@/lib/toast';
import { AgentDialog } from './AgentDialog';
import { addAgent, agentTeams, removeAgent, setActiveAgent, useActiveAgentId, useAgents } from './store';
import { defaultAvatarColor, type Agent } from './data';
import { AgentOrb } from './AgentOrb';

/** One agent row: choose it, read what it is, remove it when it is the user's own. */
function AgentRow({
  agent,
  active,
  running,
  now,
  onEdit,
}: {
  agent: Agent;
  active: boolean;
  /** When a session of this agent started, while it is still working. */
  running?: number;
  now: number;
  onEdit: (agent: Agent) => void;
}) {
  // The trailing menu: edit, duplicate, and remove for the agents the user made. A built-in
  // agent is restored on the next launch, so editing it says so and duplication is the way to
  // keep a change.
  const actions: RowAction[] = [
    {
      id: 'edit',
      label: agent.builtIn ? 'Edit for this session' : 'Edit',
      icon: Pencil,
      onSelect: () => onEdit(agent),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      onSelect: () => {
        const copy = addAgent({ ...agent, name: `${agent.name} (copy)` });
        notify(`Duplicated “${agent.name}”`, { tone: 'success' });
        onEdit(copy);
      },
    },
    ...(agent.builtIn
      ? []
      : [
          {
            id: 'remove',
            label: 'Remove',
            icon: Trash2,
            danger: true,
            onSelect: () => {
              removeAgent(agent.id);
              notify(`Removed “${agent.name}”`);
            },
          },
        ]),
  ];

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-2xl transition-colors',
        active ? 'bg-accent/10' : 'hover:bg-surface-tertiary',
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
        aria-pressed={active}
        onClick={() => setActiveAgent(agent.id)}
      >
        <AgentOrb
          color={agent.avatarColor ?? defaultAvatarColor(agent.name)}
          size={26}
          active={active || running !== undefined}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-body text-foreground">{agent.name}</span>
            {running !== undefined ? (
              <span className="shrink-0 text-meta tabular-nums text-accent">
                {formatClock(now - running)}
              </span>
            ) : (
              <Check
                className={cn('size-3.5 shrink-0 text-accent', active ? 'opacity-100' : 'opacity-0')}
                aria-hidden
              />
            )}
          </span>
          <span className="block truncate text-meta text-muted">{agent.summary || 'No summary yet.'}</span>
        </span>
      </button>
      <RowMenu label={`Actions for ${agent.name}`} actions={actions} className="mr-1" />
    </div>
  );
}

/** The agent bar: every agent, grouped by team, one active. */
export function AgentBar() {
  const { state, dispatch } = useApp();
  const agents = useAgents();
  const activeId = useActiveAgentId();
  const [editing, setEditing] = useState<Agent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openEditor = (agent: Agent) => {
    setEditing(agent);
    setDialogOpen(true);
  };

  const now = useNow(Object.keys(state.runs).length > 0);
  const runningByAgent = new Map<string, number>();
  for (const run of Object.values(state.runs)) {
    const current = runningByAgent.get(run.agentId);
    if (current === undefined || run.startedAt < current) {
      runningByAgent.set(run.agentId, run.startedAt);
    }
  }

  const groups = [
    { key: 'solo', label: 'Solo', members: agents.filter((agent) => !agent.team) },
    ...agentTeams().map((team) => ({
      key: team,
      label: team,
      members: agents.filter((agent) => agent.team === team),
    })),
  ].filter((group) => group.members.length > 0);

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col gap-2 py-3 pe-3 ps-1">
      <Surface className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl">
        <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
          <SectionLabel>Agents</SectionLabel>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto gap-1.5"
            onPress={() => dispatch({ type: 'route/go', route: 'agents/new' })}
          >
            <Plus className="size-3.5" />
            New
          </Button>
        </header>

        <ScrollShadow className="min-h-0 flex-1 px-2 pb-3">
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-0.5">
                <span className="px-2.5 pb-0.5 text-meta text-muted">{group.label}</span>
                {group.members.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    active={agent.id === activeId}
                    running={runningByAgent.get(agent.id)}
                    now={now}
                    onEdit={openEditor}
                  />
                ))}
              </div>
            ))}
          </div>
        </ScrollShadow>
      </Surface>

      {/* The session's own controls, in the same island shape as the block above: context,
          stats and settings are about the session rather than about the work in it. */}
      <SessionTools />

      <AgentDialog open={dialogOpen} agent={editing} onClose={() => setDialogOpen(false)} />
    </aside>
  );
}
