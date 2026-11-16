/**
 * Settings → Sandbox.
 *
 * What a command may touch on this machine. The defaults are the safe ones; every field here
 * is read by `src-tauri/src/commands/execution.rs` before a command starts.
 */

import { usePageTitle, useApp } from '@/store/app';
import { SettingsPage } from '@/components/screens/archetypes';
import { Input, SectionLabel, SwitchRow, TextArea } from '@/components/ui';
import { ModeField, RuntimeStatus, envToLines, linesToEnv, linesToPaths } from './execution-shared';
import type { SandboxSettings } from '@/lib/execution';

/** The sandbox page. */
export function SandboxScreen() {
  usePageTitle('Sandbox');
  const { state, dispatch } = useApp();
  const sandbox = state.execution.sandbox;

  const update = (patch: Partial<SandboxSettings>) =>
    dispatch({
      type: 'execution/set',
      execution: { ...state.execution, sandbox: { ...sandbox, ...patch } },
    });

  return (
    <SettingsPage
      aside={[
        {
          title: 'What the sandbox refuses',
          items: [
            { label: 'Writes', value: 'outside the workspace' },
            { label: 'Network', value: sandbox.network ? 'allowed' : 'refused' },
            { label: 'Credentials', value: '~/.ssh, ~/.aws, keychains' },
            { label: 'Processes', value: 'own session, no parent escape' },
          ],
        },
        {
          title: 'Runtimes',
          items: [
            { label: 'Linux', value: 'bubblewrap' },
            { label: 'macOS', value: 'sandbox-exec (Seatbelt)' },
            { label: 'Windows', value: 'not yet; use a container' },
          ],
        },
      ]}
    >
      <div className="flex w-full flex-col gap-8">
        <p className="text-body text-muted">
          Runs a command with the system read-only, the workspace writable and the network closed.
        </p>

        <ModeField />
        <RuntimeStatus kind="sandbox" />

        <section className="flex flex-col gap-3">
          <SectionLabel>Bounds</SectionLabel>
          <SwitchRow
            label="Allow the network"
            hint="Off by default. Turn it on for a command that must fetch or call an API."
            checked={sandbox.network}
            onChange={(network) => update({ network })}
          />
          <SwitchRow
            label="Keep /tmp between commands"
            hint="Off by default: each run gets a private tmpfs, so a stale file cannot change the next result."
            checked={sandbox.keepTmp}
            onChange={(keepTmp) => update({ keepTmp })}
          />
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>Paths</SectionLabel>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Read-only paths</span>
            <TextArea
              value={sandbox.readPaths.join('\n')}
              onChange={(event) =>
                update({ readPaths: linesToPaths((event.target as HTMLTextAreaElement).value) })
              }
              placeholder={'/data/reference\n/Users/you/datasets'}
            />
            <span className="text-meta text-muted">
              One absolute path per line. The system is already readable; add data that lives outside the
              workspace.
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Writable paths</span>
            <TextArea
              value={sandbox.writePaths.join('\n')}
              onChange={(event) =>
                update({ writePaths: linesToPaths((event.target as HTMLTextAreaElement).value) })
              }
              placeholder={'/scratch\n/Users/you/cache'}
            />
            <span className="text-meta text-muted">
              One absolute path per line. The workspace is always writable; these are the additional places a
              command may write.
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Environment</SectionLabel>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Variables</span>
            <TextArea
              value={envToLines(sandbox.env)}
              onChange={(event) => update({ env: linesToEnv((event.target as HTMLTextAreaElement).value) })}
              placeholder={'LAB_ENV=test\nOMP_NUM_THREADS=4'}
            />
            <span className="text-meta text-muted">
              One <span className="font-mono">KEY=VALUE</span> per line. The rest of your shell environment is
              cleared; PATH, HOME and TERM are set by the sandbox.
            </span>
          </label>
        </section>
      </div>
    </SettingsPage>
  );
}
