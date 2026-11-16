/**
 * Extensions.
 *
 * The surface where the workbench is given more than it shipped with. An extension is one
 * JSON manifest — a pack, tools, connectors and the credentials those need — and this page is
 * where one is installed, opened, closed or removed, and where the protocol is written down
 * for whoever wants to write the next one.
 *
 * The workspace's own extensions live in `.openlab/extensions/`, so a lab can commit its
 * tools beside the work that uses them. They are re-read from disk on demand, which is why a
 * deleted file disappears here on the next reload rather than lingering in storage.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cable,
  Check,
  ExternalLink,
  FileCode2,
  FolderOpen,
  KeyRound,
  Package,
  RefreshCw,
  Trash2,
  Wrench,
} from 'lucide-react';

import {
  Button,
  Chip,
  Dialog,
  IconButton,
  Input,
  SectionLabel,
  Switch,
  TextArea,
  Tip,
} from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { cn } from '@/lib/cn';
import { invokeCommand, isDesktop } from '@/lib/ipc';
import { notify } from '@/lib/toast';
import { activeProject } from '@/store/types';
import { useApp } from '@/store/app';
import {
  EXTENSION_DIR,
  clearExtensions,
  extensionCredentialKey,
  installExtension,
  installedExtensions,
  loadWorkspaceExtensions,
  removeExtension,
  setExtensionEnabled,
  useExtensions,
  type InstalledExtension,
} from '@/lib/extensions/registry';
import type { ExtensionCredential } from '@/lib/extensions/protocol';
import {
  EXAMPLE_MANIFEST,
  PROTOCOL,
  describeExtension,
  extensionPermissions,
  parseManifest,
} from '@/lib/extensions/protocol';

/** A titled block, in the shape the rest of the settings surface uses. */
function Block({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <SectionLabel>{title}</SectionLabel>
        {hint && <span className="text-meta text-muted">{hint}</span>}
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** One thing an extension brings: a pack, a tool, a connector, a credential. */
function Contributed({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof Package;
  label: string;
  detail?: string;
}) {
  return (
    <li className="flex items-baseline gap-2 text-meta">
      <Icon className="size-3.5 shrink-0 translate-y-0.5 text-muted" aria-hidden />
      <span className="min-w-0 truncate text-foreground">{label}</span>
      {detail && <span className="min-w-0 truncate text-muted">{detail}</span>}
    </li>
  );
}

/**
 * One credential a manifest asks for.
 *
 * The value goes to the OS vault and is read only by Rust at call time, so it never enters
 * the webview again. The status is "whether a key exists", which is all the interface needs.
 */
function CredentialRow({
  extensionId,
  credential,
}: {
  extensionId: string;
  credential: ExtensionCredential;
}) {
  const [value, setValue] = useState('');
  const [stored, setStored] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const key = extensionCredentialKey(extensionId, credential.id);

  useEffect(() => {
    if (!isDesktop()) return;
    let alive = true;
    void invokeCommand<{ provider: string; hasKey: boolean }[]>('secrets_status', {
      providers: [key],
    }).then((result) => {
      if (!alive || !result.ok) return;
      setStored(result.value.some((row) => row.provider === key && row.hasKey));
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const write = async (next: string) => {
    setBusy(true);
    const result =
      next.trim() === ''
        ? await invokeCommand('secret_delete', { provider: key })
        : await invokeCommand('secret_set', { provider: key, value: next.trim() });
    setBusy(false);
    if (!result.ok) {
      notify('The credential could not be saved', { description: result.error.message, tone: 'danger' });
      return;
    }
    setStored(next.trim() !== '');
    setValue('');
    notify(next.trim() === '' ? 'Credential removed' : 'Credential stored', { tone: 'success' });
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2 text-meta">
        <KeyRound className="size-3.5 shrink-0 translate-y-0.5 text-muted" aria-hidden />
        <span className="min-w-0 truncate text-foreground">{credential.label}</span>
        <span className="text-muted">{credential.kind}</span>
        {stored !== null && (
          <Chip size="sm" variant="soft" color={stored ? 'success' : 'default'}>
            {stored ? 'stored' : 'not set'}
          </Chip>
        )}
      </span>
      {credential.hint && <span className="pl-5 text-meta text-muted">{credential.hint}</span>}
      {isDesktop() && (
        <div className="flex items-center gap-1.5 pl-5">
          <Input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={stored ? 'Replace the stored value' : 'Paste the value'}
            aria-label={`${credential.label} value`}
            className="min-w-0 flex-1"
          />
          <Button
            size="sm"
            variant="secondary"
            isDisabled={busy || value.trim().length === 0}
            onPress={() => void write(value)}
          >
            Save
          </Button>
          {stored && (
            <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void write('')}>
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** One installed extension, with what it brings and what it may touch. */
function ExtensionRow({ entry }: { entry: InstalledExtension }) {
  const [open, setOpen] = useState(false);
  const { manifest } = entry;
  const contributes = describeExtension(manifest);

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-body text-foreground">{manifest.name}</span>
            <span className="shrink-0 text-meta tabular-nums text-muted">{manifest.version}</span>
            {entry.source === 'workspace' && (
              <Chip size="sm" variant="soft" color="default">
                workspace
              </Chip>
            )}
          </span>
          <span className="mt-0.5 block truncate font-mono text-meta text-muted">{manifest.id}</span>
        </span>

        <Switch
          size="sm"
          isSelected={entry.enabled}
          onChange={(next) => setExtensionEnabled(manifest.id, next)}
          aria-label={`Enable ${manifest.name}`}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>

        <Tip content={open ? 'Hide what it brings' : 'Show what it brings'}>
          <Button size="sm" variant="ghost" onPress={() => setOpen((value) => !value)}>
            {open ? 'Hide' : 'Details'}
          </Button>
        </Tip>
        <IconButton
          aria-label={`Remove ${manifest.name}`}
          onPress={() => {
            removeExtension(manifest.id);
            notify(`Removed “${manifest.name}”`);
          }}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted">
        <span>{contributes.join(' · ')}</span>
        <span className="text-separator" aria-hidden>
          ·
        </span>
        <span>{extensionPermissions(manifest).join(', ')}</span>
        {entry.path && (
          <>
            <span className="text-separator" aria-hidden>
              ·
            </span>
            <span className="truncate font-mono">{entry.path}</span>
          </>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-3 rounded-xl bg-surface-secondary p-3">
          {manifest.description && <p className="text-meta text-foreground">{manifest.description}</p>}

          {manifest.pack && (
            <ul className="flex flex-col gap-1">
              <Contributed
                icon={Package}
                label={`Pack · ${manifest.pack.name}`}
                detail={manifest.pack.family}
              />
              {manifest.pack.skills?.map((skill) => (
                <Contributed key={skill} icon={FileCode2} label={skill} detail="skill" />
              ))}
            </ul>
          )}

          {manifest.tools && manifest.tools.length > 0 && (
            <ul className="flex flex-col gap-1">
              {manifest.tools.map((tool) => (
                <Contributed
                  key={tool.id}
                  icon={Wrench}
                  label={tool.id}
                  detail={`${tool.transport.kind} · ${extensionPermissions({ ...manifest, connectors: [], tools: [tool] }).join(', ')}`}
                />
              ))}
            </ul>
          )}

          {manifest.connectors && manifest.connectors.length > 0 && (
            <ul className="flex flex-col gap-1">
              {manifest.connectors.map((connector) => (
                <Contributed
                  key={connector.id}
                  icon={Cable}
                  label={connector.name}
                  detail={
                    connector.transport.kind === 'http'
                      ? connector.transport.url
                      : `${connector.transport.command} ${(connector.transport.args ?? []).join(' ')}`
                  }
                />
              ))}
            </ul>
          )}

          {manifest.credentials && manifest.credentials.length > 0 && (
            <div className="flex flex-col gap-2">
              {manifest.credentials.map((credential) => (
                <CredentialRow key={credential.id} extensionId={manifest.id} credential={credential} />
              ))}
            </div>
          )}

          {manifest.homepage && (
            <a
              href={manifest.homepage}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-meta text-accent"
            >
              <ExternalLink className="size-3.5" />
              {manifest.homepage}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Install a manifest by pasting it.
 *
 * `initial` is what makes this the create surface for a tool or a connector too: the Tools and
 * Connectors pages open it with a one-tool or one-connector skeleton already in the box, so
 * writing either one ends in the same place — a manifest the runtime reads.
 */
export function InstallDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  /** A starting manifest, when the caller has one in mind. */
  initial?: string;
}) {
  const [text, setText] = useState(initial ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  // A skeleton handed in after the first open still replaces what is there.
  useEffect(() => {
    if (open && initial) setText(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const install = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setErrors([`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`]);
      return;
    }
    const result = parseManifest(parsed);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const installed = installExtension(result.manifest, 'file');
    if (!installed.ok) {
      setErrors(installed.errors);
      return;
    }
    notify(`Installed “${result.manifest.name}”`, { tone: 'success' });
    setText('');
    setErrors([]);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Install an extension"
      description={`Paste a manifest (${PROTOCOL}). Nothing runs until you enable it, and it can only do what it declares.`}
      width={640}
      footer={
        <>
          <Button variant="ghost" onPress={() => setText(EXAMPLE_MANIFEST)} className="mr-auto gap-1.5">
            <FileCode2 className="size-3.5" />
            Load the example
          </Button>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={text.trim().length === 0} onPress={install}>
            Install
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextArea
          fullWidth
          rows={16}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setErrors([]);
          }}
          placeholder='{ "protocol": "openlab.extension/1", "id": "…" }'
          className="font-mono text-meta"
          aria-label="Extension manifest"
        />
        {errors.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-xl bg-danger/10 p-3 text-meta text-danger">
            {errors.map((error) => (
              <li key={error} className="font-mono">
                {error}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/** The extensions surface. */
export function ExtensionsScreen() {
  const { state } = useApp();
  const extensions = useExtensions();
  const [installing, setInstalling] = useState(false);
  const [report, setReport] = useState<{
    loaded: number;
    errors: { path: string; errors: string[] }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const project = activeProject(state);

  const reload = useCallback(async () => {
    if (!project) return;
    setBusy(true);
    const result = await loadWorkspaceExtensions(project.path);
    setReport(result);
    setBusy(false);
    notify(
      result.loaded === 0
        ? 'No extensions found in the workspace'
        : `Loaded ${result.loaded} workspace extension${result.loaded === 1 ? '' : 's'}`,
      { tone: result.loaded === 0 ? 'warning' : 'success' },
    );
  }, [project]);

  // The workspace's own extensions are read once, when the page is opened.
  useEffect(() => {
    if (!project) return;
    void loadWorkspaceExtensions(project.path).then(setReport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.path]);

  const enabledCount = useMemo(
    () => installedExtensions().filter((entry) => entry.enabled).length,
    [extensions],
  );

  return (
    <SettingsPage>
      <div className="flex w-full flex-col gap-8">
        <p className="text-body text-muted">
          An extension is one manifest. Its switch is the consent: an enabled extension's tools are offered to
          the agent.
        </p>

        <Block
          title="Installed"
          hint={`${extensions.length} installed · ${enabledCount} open`}
          actions={
            <>
              <Tip content={`Re-read ${EXTENSION_DIR}/ from the workspace`}>
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1.5"
                  isDisabled={!project || busy}
                  onPress={() => void reload()}
                >
                  <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
                  Reload from workspace
                </Button>
              </Tip>
              <Button size="sm" variant="secondary" className="gap-1.5" onPress={() => setInstalling(true)}>
                <FileCode2 className="size-3.5" />
                Install from a manifest
              </Button>
            </>
          }
        >
          {extensions.length === 0 ? (
            <p className="rounded-2xl bg-surface p-6 text-center text-body text-muted">
              Nothing installed yet. Paste a manifest, or put one in{' '}
              <span className="font-mono">{EXTENSION_DIR}/</span> and reload.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {extensions.map((entry) => (
                <ExtensionRow key={entry.manifest.id} entry={entry} />
              ))}
            </div>
          )}

          {!project && (
            <p className="flex items-center gap-1.5 text-meta text-muted">
              <FolderOpen className="size-3.5" />
              Open a workspace to load the extensions it carries.
            </p>
          )}

          {report && report.errors.length > 0 && (
            <div className="flex flex-col gap-1 rounded-2xl bg-warning/10 p-3 text-meta">
              <span className="text-foreground">Some files in {EXTENSION_DIR}/ did not load:</span>
              {report.errors.map((failure) => (
                <span key={failure.path} className="font-mono text-muted">
                  {failure.path}: {failure.errors.join(' ')}
                </span>
              ))}
            </div>
          )}
        </Block>

        <Block
          title="The protocol"
          hint={PROTOCOL}
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onPress={() => {
                clearExtensions();
                notify('Removed every extension installed by hand');
              }}
            >
              <Trash2 className="size-3.5" />
              Clear installed
            </Button>
          }
        >
          <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
            <p className="text-body text-muted">
              A manifest names itself, then declares its tools, connectors and credentials. A credential named
              as <span className="font-mono">{'{{credential:id}}'}</span> is read from the OS vault by Rust,
              so the value never enters the window.
            </p>
            <pre className="max-h-[360px] overflow-auto rounded-xl bg-surface-secondary p-3 font-mono text-[11px] leading-relaxed text-muted">
              {EXAMPLE_MANIFEST}
            </pre>
            <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
              <Check className="size-3.5" />A manifest that fails to parse is reported with the reason and
              never half-loaded.
            </div>
          </div>
        </Block>
      </div>

      <InstallDialog open={installing} onClose={() => setInstalling(false)} />
    </SettingsPage>
  );
}
