/**
 * Settings → Container.
 *
 * The image a command runs in, and the limits around it. Every field is read by
 * `src-tauri/src/commands/execution.rs`; the flags are `docker run`/`podman run` flags, so the
 * page names them in the reader's terms and shows the shape in the aside.
 */

import { usePageTitle, useApp } from '@/store/app';
import { SettingsPage } from '@/components/screens/archetypes';
import { Input, NumberInput, SectionLabel, Select, SwitchRow, TextArea } from '@/components/ui';
import { ModeField, RuntimeStatus, envToLines, linesToEnv, linesToPaths } from './execution-shared';
import type { ContainerEngine, ContainerSettings, PullPolicy } from '@/lib/execution';

/** The container page. */
export function ContainerScreen() {
  usePageTitle('Container');
  const { state, dispatch } = useApp();
  const container = state.execution.container;

  const update = (patch: Partial<ContainerSettings>) =>
    dispatch({
      type: 'execution/set',
      execution: { ...state.execution, container: { ...container, ...patch } },
    });

  return (
    <SettingsPage
      aside={[
        {
          title: 'Applied to every run',
          items: [
            { label: 'Capabilities', value: 'all dropped' },
            { label: 'Privileges', value: 'no new privileges' },
            { label: 'Network', value: container.network ? 'bridge' : 'none' },
            { label: 'Root filesystem', value: container.readOnlyRoot ? 'read-only' : 'writable' },
            { label: 'User', value: 'workspace owner' },
          ],
        },
        {
          title: 'Not mounted',
          items: [
            { label: 'Docker/Podman socket', value: 'refused' },
            { label: 'Home directory', value: 'not mounted' },
            { label: 'Workspace', value: 'same path inside' },
          ],
        },
      ]}
    >
      <div className="flex w-full flex-col gap-8">
        <p className="text-body text-muted">
          Runs a command in its own image and filesystem; the workspace is mounted at the same path.
        </p>

        <ModeField />
        <RuntimeStatus kind="container" />

        <section className="flex flex-col gap-4">
          <SectionLabel>Image and runtime</SectionLabel>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Image</span>
            <Input
              value={container.image}
              onChange={(event) => update({ image: (event.target as HTMLInputElement).value })}
              placeholder="python:3.12-slim"
            />
            <span className="text-meta text-muted">
              Pulled with the runtime, not bundled. Pin a tag or a digest for a reproducible run.
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-foreground">Runtime</span>
              <Select
                label="Runtime"
                value={container.engine}
                options={[
                  { value: 'auto', label: 'Auto (Podman, then Docker)' },
                  { value: 'podman', label: 'Podman' },
                  { value: 'docker', label: 'Docker' },
                ]}
                onChange={(engine) => update({ engine: engine as ContainerEngine })}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-foreground">Pull policy</span>
              <Select
                label="Pull policy"
                value={container.pull}
                options={[
                  { value: 'missing', label: 'Pull when missing' },
                  { value: 'always', label: 'Always pull' },
                  { value: 'never', label: 'Never pull' },
                ]}
                onChange={(pull) => update({ pull: pull as PullPolicy })}
              />
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Limits</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-foreground">Memory</span>
              <NumberInput
                label="Memory"
                min={128}
                value={container.memoryMb}
                onChange={(memoryMb) => update({ memoryMb: memoryMb ?? 128 })}
                fullWidth
              />
              <span className="text-meta text-muted">MiB</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-foreground">CPUs</span>
              <NumberInput
                label="CPUs"
                min={0.1}
                step={0.1}
                value={container.cpus}
                onChange={(cpus) => update({ cpus: cpus ?? 0.1 })}
                fullWidth
              />
              <span className="text-meta text-muted">cores</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-foreground">Processes</span>
              <NumberInput
                label="Processes"
                min={1}
                value={container.pidsLimit}
                onChange={(pidsLimit) => update({ pidsLimit: pidsLimit ?? 1 })}
                fullWidth
              />
              <span className="text-meta text-muted">pids</span>
            </label>
          </div>
          <SwitchRow
            label="Allow the network"
            hint="Off by default: none. Package installs need it on for that run only."
            checked={container.network}
            onChange={(network) => update({ network })}
          />
          <SwitchRow
            label="Read-only root filesystem"
            hint="The workspace and /tmp stay writable. A tool that writes to its install directory needs this off."
            checked={container.readOnlyRoot}
            onChange={(readOnlyRoot) => update({ readOnlyRoot })}
          />
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>Mounts</SectionLabel>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Extra binds</span>
            <TextArea
              value={container.mounts.join('\n')}
              onChange={(event) =>
                update({ mounts: linesToPaths((event.target as HTMLTextAreaElement).value) })
              }
              placeholder={'/data/reference:/data:ro\n/scratch:/scratch'}
            />
            <span className="text-meta text-muted">
              One <span className="font-mono">host:container[:ro]</span> per line. The workspace is always
              mounted. The container socket is refused.
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Environment</SectionLabel>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Variables</span>
            <TextArea
              value={envToLines(container.env)}
              onChange={(event) => update({ env: linesToEnv((event.target as HTMLTextAreaElement).value) })}
              placeholder={'OMP_NUM_THREADS=4\nHF_HOME=/tmp/huggingface'}
            />
            <span className="text-meta text-muted">
              One <span className="font-mono">KEY=VALUE</span> per line. Credentials a compute target needs
              are passed by name, so their values never appear in the process list.
            </span>
          </label>
        </section>
      </div>
    </SettingsPage>
  );
}
