/**
 * Pieces both execution pages share.
 *
 * The two pages configure different runtimes, but they answer the same first question — where
 * does a command run by default — and they report availability the same way.
 */

import { useEffect, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';

import { Chip, SectionLabel, Select } from '@/components/ui';
import { loadExecutionStatus, type ExecutionMode, type ExecutionStatus } from '@/lib/execution';
import { useApp } from '@/store/app';

/** The default environment. Changing it here changes it for every new command. */
export function ModeField() {
  const { state, dispatch } = useApp();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-foreground">Default environment</span>
      <Select
        value={state.execution.mode}
        label="Default environment"
        options={[
          { value: 'sandbox', label: 'Sandbox: bounded filesystem and network' },
          { value: 'container', label: 'Container: an image of its own' },
          { value: 'host', label: 'Real environment: this machine, no isolation' },
        ]}
        onChange={(mode) =>
          dispatch({ type: 'execution/set', execution: { ...state.execution, mode: mode as ExecutionMode } })
        }
      />
      <span className="text-meta text-muted">
        Applies to the agent's commands, the composer shell and a code block's Run. Compute targets keep their
        own machine: their probe and submit run on this machine's shell.
      </span>
    </label>
  );
}

/** What this machine has, with a way to ask again after installing something. */
export function RuntimeStatus({ kind }: { kind: 'sandbox' | 'container' }) {
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    void loadExecutionStatus()
      .then((next) => alive && setStatus(next))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, []);

  const row = status?.[kind];
  return (
    <div className="flex flex-col gap-2 surface-raised rounded-2xl p-4">
      <SectionLabel>{kind === 'sandbox' ? 'Sandbox runtimes' : 'Container runtimes'}</SectionLabel>
      {checking ? (
        <span className="text-meta text-muted">Checking this machine…</span>
      ) : !row || !row.available ? (
        <div className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span className="text-body text-muted">
            {kind === 'sandbox'
              ? status?.platform === 'windows'
                ? 'No sandbox is available on Windows yet. Use a container, or switch the default to the real environment.'
                : 'No sandbox runtime was found. Install bubblewrap on Linux; macOS ships sandbox-exec.'
              : 'No container runtime was found. Install Podman (recommended, rootless) or Docker, then reopen this page.'}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Check className="size-4 text-accent" aria-hidden />
          <span className="text-body">
            {kind === 'sandbox'
              ? `${row.engine} is available`
              : `${row.engine} is available${row.engines.length > 1 ? `, alongside ${row.engines.filter((e) => e !== row.engine).join(', ')}` : ''}`}
          </span>
          {row.engines.map((engine) => (
            <Chip key={engine}>{engine}</Chip>
          ))}
        </div>
      )}
      <button
        type="button"
        className="w-fit text-meta text-accent underline-offset-2 hover:underline"
        onClick={() => {
          setChecking(true);
          void loadExecutionStatus()
            .then(setStatus)
            .finally(() => setChecking(false));
        }}
      >
        Check again
      </button>
    </div>
  );
}

/** Split a textarea of one-entry-per-line paths. */
export function linesToPaths(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Split `KEY=VALUE` lines into a record. A malformed line is kept out, not silently renamed. */
export function linesToEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1);
  }
  return out;
}

/** The other direction, for the field that shows the record. */
export function envToLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}
