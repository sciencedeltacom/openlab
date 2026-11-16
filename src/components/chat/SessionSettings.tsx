/**
 * What this session's agent may reach.
 *
 * Two lists behind one tab strip, because they are two answers to one question and reading
 * them side by side would make the panel a scroll rather than a choice:
 *
 *   **Domain packs** — the packs the agent asks for. An agent's packs are *intersected* with
 *   the workbench's, and the workbench has to have the pack at all, so a row names whichever
 *   half is missing and offers it: install the pack, or open the one already installed.
 *
 *   **MCP servers** — the servers the chosen packs allow, and whether each is open. A pack
 *   allowing a server is not the workbench running one: every server here declares what it
 *   needs before it can start, and the row states that rather than implying it works.
 *
 * Both write through the same stores the rest of the app reads — the agent record, the
 * workbench's packs — so a switch here is the same act as anywhere else.
 */

import { useState, type ReactNode } from 'react';
import { Plug, Puzzle } from 'lucide-react';

import { Button, ScrollShadow, Switch, ToggleButton, ToggleButtonGroup } from '@/components/ui';
import { cn } from '@/lib/cn';
import { DOMAIN_PACKS, findPack, type PackId } from '@/lib/agent/packs';
import { MCP_SERVERS, type McpServerId } from '@/lib/agent/mcp';
import { activeSession } from '@/store/types';
import { useApp } from '@/store/app';
import { patchAgent, useActiveAgentId, useAgents } from '@/components/agents/store';

/** One row: a name, what it is, and the switch that decides it. */
function Row({
  icon: Icon,
  name,
  detail,
  on,
  onToggle,
  action,
  note,
}: {
  icon: typeof Puzzle;
  name: string;
  detail: string;
  on: boolean;
  onToggle: () => void;
  /** The missing half of the decision, when there is one. */
  action?: { label: string; onPress: () => void };
  note?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-separator px-2 py-2.5 transition-colors last:border-0 hover:bg-surface">
      <span
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full transition-colors',
          on ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-muted',
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-foreground">{name}</span>
        <span className="block truncate text-meta text-muted">{detail}</span>
        {note && <span className="mt-0.5 block text-meta text-warning">{note}</span>}
      </span>
      {action && (
        <Button size="sm" variant="secondary" className="mt-0.5 shrink-0" onPress={action.onPress}>
          {action.label}
        </Button>
      )}
      <span className="mt-0.5 shrink-0">
        <Switch isSelected={on} onChange={onToggle} aria-label={name}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </span>
    </div>
  );
}

/** The packs and MCP servers this session's agent may use. */
export function SessionSettings() {
  const { state, dispatch } = useApp();
  const agents = useAgents();
  const activeId = useActiveAgentId();
  const session = activeSession(state);
  const [tab, setTab] = useState<'packs' | 'mcps'>('packs');

  // The agent leading this session, falling back to the one that leads the next turn.
  const agent =
    agents.find((candidate) => candidate.id === session?.agentId) ??
    agents.find((candidate) => candidate.id === activeId);

  if (!agent) {
    return <p className="px-4 py-6 text-body text-muted">No agent is selected.</p>;
  }

  const assigned = new Set(agent.packs);
  const installed = new Set(state.installedPacks);
  const opened = new Set(state.enabledPacks);

  const togglePack = (id: PackId) =>
    patchAgent(agent.id, {
      packs: assigned.has(id) ? agent.packs.filter((pack) => pack !== id) : [...agent.packs, id],
    });

  /** Every server the assigned packs allow, in catalogue order. */
  const allowed = MCP_SERVERS.filter((server) =>
    [...assigned].some((pack) => findPack(pack)?.mcps.includes(server.id)),
  );
  const closed = new Set(state.closedMcps);

  /** A tab label with its count, so the strip says how much is behind each one. */
  const label = (text: string, count: number): ReactNode => (
    <span className="flex items-center gap-1.5">
      {text}
      <span className="text-meta tabular-nums text-muted">{count}</span>
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3">
        <ToggleButtonGroup
          aria-label="What the agent may reach"
          selectionMode="single"
          selectedKeys={[tab]}
          onSelectionChange={(keys) => {
            const [first] = keys as Set<string>;
            if (first) setTab(first as 'packs' | 'mcps');
          }}
        >
          <ToggleButton id="packs" className="gap-1.5 text-meta">
            Packs
            <span className="tabular-nums text-muted">{assigned.size}</span>
          </ToggleButton>
          <ToggleButton id="mcps" className="gap-1.5 text-meta">
            MCP servers
            <span className="tabular-nums text-muted">{allowed.length}</span>
          </ToggleButton>
        </ToggleButtonGroup>
        <p className="pt-2 text-meta text-muted">
          {assigned.size} {assigned.size === 1 ? 'pack' : 'packs'} assigned · {allowed.length}{' '}
          {allowed.length === 1 ? 'server' : 'servers'} allowed
        </p>
      </div>

      <ScrollShadow className="min-h-0 flex-1 pb-3">
        {tab === 'packs' ? (
          <div className="flex flex-col gap-0.5 px-2">
            {DOMAIN_PACKS.map((pack) => {
              const on = assigned.has(pack.id);
              const has = installed.has(pack.id);
              const workbench = opened.has(pack.id);
              return (
                <Row
                  key={pack.id}
                  icon={Puzzle}
                  name={pack.name}
                  detail={pack.family}
                  on={on}
                  onToggle={() => togglePack(pack.id)}
                  note={
                    on && !has
                      ? 'Not installed on this machine, so the agent cannot use it yet.'
                      : on && !workbench
                        ? 'Installed, but the workbench has not opened it.'
                        : undefined
                  }
                  action={
                    on && (!has || !workbench)
                      ? {
                          // The two halves of the decision: a pack the machine does not have is
                          // installed, one it has but the workbench keeps shut is opened.
                          label: has ? 'Open' : 'Install',
                          onPress: () =>
                            dispatch(
                              has
                                ? { type: 'pack/enable', id: pack.id }
                                : { type: 'pack/install', id: pack.id },
                            ),
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        ) : allowed.length === 0 ? (
          <p className="px-4 py-3 text-body text-muted">
            The assigned packs allow no MCP servers. Assign one on the Packs tab to see them here.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5 px-2">
            {allowed.map((server) => (
              <Row
                key={server.id}
                icon={Plug}
                name={server.name}
                detail={
                  server.transport.kind === 'stdio'
                    ? `${server.transport.command} ${server.transport.args.join(' ')}`
                    : server.transport.url
                }
                on={!closed.has(server.id)}
                onToggle={() => dispatch({ type: 'mcp/toggle', id: server.id })}
                note={`Reference only, not started. It needs ${server.requires.join(', ')}.`}
                action={{ label: 'Docs', onPress: () => window.open(server.docsUrl, '_blank') }}
              />
            ))}
          </div>
        )}
      </ScrollShadow>
    </div>
  );
}
