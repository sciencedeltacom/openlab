/**
 * Diagnostics: what is running, and what openlab recorded, on this machine.
 *
 * Two halves. The first answers "which services are alive and what are they holding" — every
 * row is read from state that already exists, so opening the page starts nothing. The second
 * is the log itself, in a real terminal (xterm) that follows the file as it is written, so a
 * reader watching a failure does not have to press refresh. Nothing here is sent anywhere;
 * the page exists so a bug report can quote something real.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleSlash, FolderOpen, RefreshCw, ShieldAlert } from 'lucide-react';

import { Button, Chip, SectionLabel } from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { invokeCommand, isDesktop } from '@/lib/ipc';
import { formatBytes, relativeTime } from '@/lib/format';
import { PROVIDERS } from '@/lib/providers';
import { useTerminalPane } from '@/lib/terminal';
import { useApp } from '@/store/app';
import { notify } from '@/lib/toast';

interface Report {
  at: number;
  path: string;
  size: number;
}

/** What the Rust side reports about the services it keeps. */
interface SystemStatus {
  app: { version: string; pid: number; uptimeSecs: number; dataDir: string | null };
  database: { path: string | null; sizeBytes: number; open: boolean };
  scan: {
    worker: { worker: boolean; embedding: boolean; root: string | null };
    engine: { installed: boolean; python: string | null; path: string | null; packages: string[] };
  };
  vectors: { open: string | null };
  logs: { sizeBytes: number };
}

/** One server from the MCP table. */
interface McpRow {
  server: string;
  running: boolean;
  tools: string[];
}

/** One row of the services table. */
interface ServiceRow {
  name: string;
  state: 'running' | 'idle' | 'off';
  label: string;
  detail: string;
}

/** A person's words for a number of seconds. */
function uptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The tail of a path, so a long one does not push the row's own text out of view. */
function tailOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path;
}

/** Every service, in the order a reader would ask about them. */
function serviceRows(status: SystemStatus, mcp: McpRow[], keyed: string[]): ServiceRow[] {
  const rows: ServiceRow[] = [
    {
      name: 'openlab',
      state: 'running',
      label: 'running',
      detail: `${status.app.version} · pid ${status.app.pid} · up ${uptime(status.app.uptimeSecs)}`,
    },
    {
      name: 'Store',
      state: status.database.open ? 'running' : 'idle',
      label: status.database.open ? 'open' : 'idle',
      detail: status.database.path
        ? `${tailOf(status.database.path)} · ${formatBytes(status.database.sizeBytes)}`
        : 'no data directory',
    },
    {
      name: 'Scan engine',
      state: status.scan.engine.installed ? 'running' : 'off',
      label: status.scan.engine.installed ? 'installed' : 'not installed',
      detail: status.scan.engine.installed
        ? `${tailOf(status.scan.engine.python ?? 'python')} · ${status.scan.engine.packages.length} packages pinned`
        : 'the PDF worker needs its Python packages',
    },
    {
      name: 'Scan worker',
      state: status.scan.worker.worker ? 'running' : 'idle',
      label: status.scan.worker.worker ? 'running' : 'idle',
      detail: status.scan.worker.root
        ? `indexing ${tailOf(status.scan.worker.root)}`
        : 'starts on the first scan',
    },
    {
      name: 'Embedding server',
      state: status.scan.worker.embedding ? 'running' : 'idle',
      label: status.scan.worker.embedding ? 'running' : 'idle',
      detail: status.scan.worker.embedding ? 'holding the model in memory' : 'starts with the worker',
    },
    {
      name: 'Vector index',
      state: status.vectors.open ? 'running' : 'idle',
      label: status.vectors.open ? 'open' : 'idle',
      detail: status.vectors.open ? tailOf(status.vectors.open) : 'LanceDB opens on the first search',
    },
  ];

  for (const server of mcp) {
    rows.push({
      name: `MCP · ${server.server}`,
      state: server.running ? 'running' : 'off',
      label: server.running ? 'running' : 'stopped',
      detail: server.running ? `${server.tools.length} tools` : 'not started',
    });
  }

  const needed = PROVIDERS.filter((provider) => provider.requiresKey);
  rows.push({
    name: 'Model providers',
    state: keyed.length > 0 ? 'running' : 'off',
    label: `${keyed.length} of ${needed.length} keyed`,
    detail: keyed.length > 0 ? keyed.join(', ') : 'no provider has a key yet',
  });

  rows.push({
    name: 'Log file',
    state: 'running',
    label: 'writing',
    detail: formatBytes(status.logs.sizeBytes),
  });

  return rows;
}

/** The colour a state is drawn in. */
function stateChip(state: ServiceRow['state']): 'success' | 'default' | 'warning' {
  if (state === 'running') return 'success';
  if (state === 'idle') return 'default';
  return 'warning';
}

/** The state's glyph. */
function StateIcon({ state }: { state: ServiceRow['state'] }) {
  if (state === 'running') return <CircleCheck className="size-3" aria-hidden />;
  return <CircleSlash className="size-3" aria-hidden />;
}

/** One log record, as an ANSI line for the terminal. */
const LEVEL_COLOUR: Record<string, string> = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
};

function paint(line: string): string {
  try {
    const record = JSON.parse(line) as { at: number; level: string; scope: string; message: string };
    const at = new Date(record.at).toLocaleTimeString();
    const colour = LEVEL_COLOUR[record.level] ?? '';
    return `\x1b[90m${at}\x1b[0m ${colour}${record.level.toUpperCase().padEnd(5)}\x1b[0m \x1b[2m${record.scope}\x1b[0m ${record.message}`;
  } catch {
    // A line this build did not write (an older file, a partial write) is shown as it is.
    return `\x1b[90m${line}\x1b[0m`;
  }
}

/**
 * The log, in a terminal.
 *
 * Seeded from the tail the Rust side read, then followed: the same lines are streamed over
 * `log://line` as they are written, so a failure appears while it is happening.
 */
function LogTerminal({ tail }: { tail: string }) {
  const { state } = useApp();
  const { instance, ref } = useTerminalPane(state.theme === 'dark');
  /** The tail this terminal already holds, so a rebuild or a refresh writes it once. */
  const seeded = useRef<string | null>(null);

  useEffect(() => {
    if (!instance || seeded.current === tail) return;
    seeded.current = tail;
    instance.clear();
    for (const line of tail.split('\n')) {
      if (line.trim()) instance.writeln(paint(line));
    }
    instance.scrollToBottom();
  }, [instance, tail]);

  useEffect(() => {
    if (!instance || !isDesktop()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen<string>('log://line', (event) => {
          instance.writeln(paint(event.payload));
          instance.scrollToBottom();
        });
        if (cancelled) unlisten();
        else stop = unlisten;
      } catch {
        // A runtime with no event bus (a preview, a partial runtime) simply does not follow
        // the file; the tail that was read is still shown.
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [instance]);

  return (
    <div
      ref={ref}
      className="h-[420px] w-full overflow-hidden rounded-2xl border border-border/60 bg-surface p-2"
    />
  );
}

/** Open a path in the OS file manager, saying so when it cannot. */
async function reveal(path: string): Promise<void> {
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
  } catch (error) {
    notify('The folder could not be opened', {
      description: error instanceof Error ? error.message : String(error),
      tone: 'danger',
    });
  }
}

export function DiagnosticsScreen() {
  const [dir, setDir] = useState<string | null>(null);
  const [tail, setTail] = useState('');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [mcp, setMcp] = useState<McpRow[]>([]);
  const [keyed, setKeyed] = useState<string[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isDesktop()) return;
    setBusy(true);
    const providerIds = PROVIDERS.filter((provider) => provider.requiresKey).map((provider) => provider.id);
    const [where, lines, crashes, system, servers, secrets] = await Promise.all([
      invokeCommand<{ dir: string; file: string }>('logs_path', {}),
      invokeCommand<string>('logs_tail', { lines: 500 }),
      invokeCommand<Report[]>('crash_reports', {}),
      invokeCommand<SystemStatus>('system_status', {}),
      invokeCommand<McpRow[]>('mcp_status', {}),
      invokeCommand<{ provider: string; hasKey: boolean }[]>('secrets_status', {
        providers: providerIds,
      }),
    ]);
    setBusy(false);
    if (where.ok) setDir(where.value.dir);
    if (lines.ok) setTail(lines.value);
    if (crashes.ok) setReports(crashes.value);
    if (system.ok) setStatus(system.value);
    if (servers.ok) setMcp(servers.value);
    if (secrets.ok) {
      const labels = new Map(PROVIDERS.map((provider) => [provider.id, provider.label]));
      setKeyed(
        secrets.value.filter((row) => row.hasKey).map((row) => labels.get(row.provider) ?? row.provider),
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = status ? serviceRows(status, mcp, keyed) : [];

  return (
    <SettingsPage>
      <div className="flex w-full flex-col gap-8">
        <section className="flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <SectionLabel>Services</SectionLabel>
            <span className="text-meta text-muted">
              {rows.length > 0 ? `${rows.filter((row) => row.state === 'running').length} alive` : '—'}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                isDisabled={busy}
                onPress={() => void load()}
              >
                <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} />
                Refresh
              </Button>
            </div>
          </header>
          {!isDesktop() ? (
            <p className="rounded-2xl bg-surface p-6 text-center text-body text-muted">
              Services live in the desktop app; the browser preview has none.
            </p>
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
              {rows.map((row) => (
                <li
                  key={row.name}
                  className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-b-0"
                >
                  <Chip size="sm" variant="soft" color={stateChip(row.state)}>
                    <StateIcon state={row.state} />
                    {row.label}
                  </Chip>
                  <span className="w-40 shrink-0 truncate text-body text-foreground">{row.name}</span>
                  <span className="min-w-0 flex-1 truncate text-meta text-muted">{row.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <SectionLabel>Log</SectionLabel>
            {dir && <span className="truncate font-mono text-meta text-muted">{dir}</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                isDisabled={busy}
                onPress={() => void load()}
              >
                <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                isDisabled={!dir}
                onPress={() => dir && void reveal(dir)}
              >
                <FolderOpen className="size-3.5" />
                Open folder
              </Button>
            </div>
          </header>
          {!isDesktop() ? (
            <p className="rounded-2xl bg-surface p-6 text-center text-body text-muted">
              Logs live beside the desktop app's store; the browser preview keeps none.
            </p>
          ) : (
            <>
              <LogTerminal tail={tail} />
              <p className="text-meta text-muted">Following: new lines appear as they are written.</p>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <SectionLabel>Crash reports</SectionLabel>
            <span className="text-meta text-muted">{reports.length} kept</span>
          </header>
          {reports.length === 0 ? (
            <p className="rounded-2xl bg-surface p-6 text-center text-body text-muted">
              None. A report is only written when the switch in Privacy is on.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {reports.map((report) => (
                <li key={report.path} className="flex items-center gap-2 rounded-2xl bg-surface p-3">
                  <ShieldAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-meta text-muted">
                    {report.path.split(/[\\/]/).pop()}
                  </span>
                  <Chip size="sm" variant="soft" color="default">
                    {formatBytes(report.size)}
                  </Chip>
                  <span className="text-meta text-muted">{relativeTime(report.at)}</span>
                  <Button size="sm" variant="ghost" onPress={() => void reveal(report.path)}>
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SettingsPage>
  );
}
