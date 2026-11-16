/**
 * MCP servers.
 *
 * The workbench can start three of the servers its packs name: Serena for code, Delphi for
 * local search, and Zotero for a reference library. Each runs as a child process, started
 * deliberately — by the reader here, or by a worker that needs it — and its tools join the
 * agent surface while it runs. OHDSI is an HTTP endpoint, which this build does not speak, so
 * it stays a reference.
 *
 * A server that is not installed says what to install; one this build can install offers the
 * button. Starting one is a real consent: its tools are on the surface until it stops, and the
 * tools that write ask for permission like any other write.
 */

import { useCallback, useEffect, useState } from 'react';
import { Play, Plug, RefreshCw, Square, Wrench } from 'lucide-react';

import { Button, Chip, SectionLabel } from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { activeProject } from '@/store/types';
import { useApp } from '@/store/app';
import { notify } from '@/lib/toast';
import { isDesktop } from '@/lib/ipc';
import { MCP_SERVERS } from '@/lib/agent/mcp';
import { useMcpTools } from '@/lib/mcp/registry';
import { installServer, listServers, startServer, stopServer, type McpServerStatus } from '@/lib/mcp/client';

/** The label a server wears: its catalogue name, or its id. */
function labelOf(id: string): string {
  return MCP_SERVERS.find((server) => server.id === id)?.name ?? id;
}

/** What a server is for, from the catalogue. */
function summaryOf(id: string): string {
  return MCP_SERVERS.find((server) => server.id === id)?.summary ?? '';
}

export function ServersScreen() {
  const { state } = useApp();
  const root = activeProject(state)?.path ?? '';
  const tools = useMcpTools();
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setServers(await listServers());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = async (server: McpServerStatus) => {
    setBusy(server.server);
    const result = await startServer(server.server, root);
    setBusy(null);
    if (!result.ok) {
      notify(`${labelOf(server.server)} did not start`, { description: result.error, tone: 'danger' });
      await refresh();
      return;
    }
    notify(`${labelOf(server.server)} is running`, {
      description: 'Its tools are on the agent surface while it runs.',
      tone: 'success',
    });
    await refresh();
  };

  const stop = async (server: McpServerStatus) => {
    setBusy(server.server);
    await stopServer(server.server);
    setBusy(null);
    notify(`${labelOf(server.server)} stopped`);
    await refresh();
  };

  const install = async (server: McpServerStatus) => {
    setBusy(server.server);
    const result = await installServer(server.server);
    setBusy(null);
    if (!result.ok) {
      notify('The install failed', { description: result.error, tone: 'danger' });
      await refresh();
      return;
    }
    notify(`${labelOf(server.server)} is installed`, { description: 'Start it when you need it.' });
    await refresh();
  };

  return (
    <SettingsPage>
      <div className="flex w-full flex-col gap-8">
        <p className="text-body text-muted">
          Servers run as child processes and stop with the app. Nothing starts on its own.
        </p>

        <section className="flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <SectionLabel>Servers</SectionLabel>
            <span className="text-meta text-muted">
              {servers.filter((server) => server.running).length} running
            </span>
            <div className="ml-auto">
              <Button size="sm" variant="ghost" className="gap-1.5" onPress={() => void refresh()}>
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
            </div>
          </header>

          {servers.length === 0 ? (
            <p className="rounded-2xl bg-surface p-6 text-center text-body text-muted">
              {isDesktop()
                ? 'No server is known to this build.'
                : 'MCP servers run in the desktop app; the browser preview starts none.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {servers.map((server) => {
                const serverTools = tools.filter((tool) => tool.server === server.server);
                const missing = !server.binary;
                return (
                  <li key={server.server} className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body text-foreground">{labelOf(server.server)}</span>
                      <Chip size="sm" variant="soft" color={server.running ? 'success' : 'default'}>
                        <Plug className="size-3" aria-hidden />
                        {server.running ? 'running' : 'stopped'}
                      </Chip>
                      <span className="min-w-0 flex-1 truncate text-meta text-muted">
                        {summaryOf(server.server)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {missing && server.install && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5"
                            isDisabled={busy !== null}
                            onPress={() => void install(server)}
                          >
                            Install
                          </Button>
                        )}
                        {server.running ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="gap-1.5"
                            isDisabled={busy !== null}
                            onPress={() => void stop(server)}
                          >
                            <Square className="size-3.5" />
                            Stop
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="primary"
                            className="gap-1.5"
                            isDisabled={busy !== null || !isDesktop() || missing}
                            onPress={() => void start(server)}
                          >
                            <Play className="size-3.5" />
                            Start
                          </Button>
                        )}
                      </span>
                    </div>

                    <span className="flex items-baseline gap-2 text-meta">
                      <span className="text-muted">{missing ? 'Needs' : 'Binary'}</span>
                      <span className="min-w-0 truncate font-mono text-foreground">
                        {missing ? server.requires : server.binary}
                      </span>
                    </span>

                    {server.running && (
                      <ul className="flex flex-col gap-1 border-t border-separator pt-2">
                        {serverTools.length === 0 ? (
                          <li className="text-meta text-muted">It advertised no tools.</li>
                        ) : (
                          serverTools.map((tool) => (
                            <li key={tool.name} className="flex flex-wrap items-baseline gap-2 text-meta">
                              <Wrench className="size-3.5 shrink-0 translate-y-0.5 text-muted" aria-hidden />
                              <span className="font-mono text-foreground">
                                {server.server}_{tool.name}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-muted">{tool.description}</span>
                              <Chip
                                size="sm"
                                variant="soft"
                                color={tool.effects.writes ? 'warning' : 'default'}
                              >
                                {tool.effects.writes ? 'edits' : 'reads'}
                              </Chip>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel>Why one is not here</SectionLabel>
          <p className="text-body text-muted">
            OHDSI is reached over HTTP; this build speaks only stdio, so it stays a reference.
          </p>
        </section>
      </div>
    </SettingsPage>
  );
}
