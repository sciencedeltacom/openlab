/**
 * The Cloud scope of the Files page.
 *
 * A connected store is browsed **by reference**: this panel lists the remote catalogue and
 * writes nothing to the workspace until the reader saves a file. The connection is a provider
 * plus its non-secret config; the credential goes to the vault. See `lib/cloud` for the
 * providers and transport.
 *
 * A store that has folders is browsed like one: the trail across the top is where the reader
 * is, a folder row enters it, and a file row saves it into the workspace under
 * `cloud/<store>/<folder>/`. A store that can search says so with a field beside the trail.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  Cloud,
  Download,
  ExternalLink,
  Folder,
  FolderSync,
  Link2,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';

import {
  BrandMark,
  Button,
  Chip,
  Dialog,
  IconButton,
  Input,
  Label,
  Modal,
  SectionLabel,
  Select,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBytes, relativeTime } from '@/lib/format';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import { accountLabel } from '@/lib/accounts/providers';
import { refreshAccount, useAccount } from '@/lib/accounts/store';
import {
  canSearch,
  clearCredential,
  downloadRemote,
  hasCredential,
  importFile,
  listRemote,
  openRemote,
  saveCredential,
  searchRemote,
} from '@/lib/cloud/client';
import { CLOUD_PROVIDERS, findProvider } from '@/lib/cloud/providers';
import { addConnection, addPair, findConnection, removeConnection, useConnections } from '@/lib/cloud/store';
import type { CloudConnection, CloudField, CloudProvider, RemoteEntry, SyncPair } from '@/lib/cloud/types';
import { kindOfName } from '@/components/files/data';
import { KIND_META } from '@/components/files/meta';

/** Where the reader is inside a store: the trail from its root down to the open folder. */
interface Crumb {
  name: string;
  path: string;
}

/** A name a workspace path can hold, whatever the store called it. */
function safeName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/^\.+/, '');
  return cleaned || 'untitled';
}

/**
 * A connection's brand mark.
 *
 * An object store has no brand of its own — the endpoint does. A connection to R2, B2 or
 * Spaces wears that store's mark rather than a generic bucket.
 */
function connectionIcon(connection: CloudConnection): string | undefined {
  const provider = findProvider(connection.providerId);
  if (!provider) {
    return undefined;
  }
  if (provider.presets) {
    const endpoint = connection.config.endpoint ?? '';
    const preset = provider.presets.find((entry) => entry.match && endpoint.includes(entry.match));
    return preset?.icon ?? provider.icon;
  }
  return provider.icon;
}

/** Open an external URL through the desktop opener, falling back to a new tab. */
async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** One labelled field in the connect form. */
function FormField({
  field,
  value,
  onChange,
}: {
  field: CloudField;
  value: string;
  onChange: (next: string) => void;
}) {
  if (field.options) {
    return (
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-foreground">{field.label}</span>
        <Select
          value={value || field.default || field.options[0]!}
          options={field.options.map((option) => ({ value: option, label: option }))}
          onChange={onChange}
        />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-foreground">
        {field.label}
        {field.required && <span className="text-danger"> *</span>}
      </span>
      <Input
        type={field.secret ? 'password' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
      />
      {field.help && <span className="text-meta text-muted">{field.help}</span>}
    </label>
  );
}

/** The provider picker: the catalogue, grouped, each with its brand mark. */
function ProviderPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (provider: CloudProvider) => void;
}) {
  const groups: CloudProvider['group'][] = ['Repositories', 'Object stores'];
  return (
    <Modal isOpen={open} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="w-[520px] max-w-[94vw]">
            <Modal.Header>
              <Modal.Heading className="text-title">Connect a store</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex max-h-[60vh] flex-col gap-4">
              {groups.map((group) => (
                <section key={group} className="flex flex-col gap-1.5">
                  <SectionLabel>{group}</SectionLabel>
                  {CLOUD_PROVIDERS.filter((provider) => provider.group === group).map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => onPick(provider)}
                      className="flex items-start gap-3 rounded-2xl bg-surface-secondary p-3 text-left transition-colors hover:bg-surface"
                    >
                      <BrandMark icon={provider.icon} label={provider.label} className="bg-surface" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-medium text-foreground">{provider.label}</span>
                        <span className="block text-meta text-muted">{provider.summary}</span>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** The connect form: the provider's config fields, then its credential. */
function ConnectForm({
  provider,
  onClose,
  onSaved,
}: {
  provider: CloudProvider;
  onClose: () => void;
  onSaved: (connection: CloudConnection) => void;
}) {
  const [label, setLabel] = useState(provider.label);
  const [config, setConfig] = useState<Record<string, string>>(() =>
    Object.fromEntries(provider.configFields.map((field) => [field.key, field.default ?? ''])),
  );
  const [credential, setCredential] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = useAccount(provider.accountProvider ?? '__none__');
  const needsAccount = Boolean(provider.accountProvider);
  const accountReady = !needsAccount || Boolean(account?.connected);
  const { dispatch } = useApp();

  useEffect(() => {
    if (provider.accountProvider) {
      void refreshAccount(provider.accountProvider);
    }
  }, [provider.accountProvider]);

  const preset = (id: string) => {
    const chosen = provider.presets?.find((entry) => entry.id === id);
    if (chosen) {
      setConfig((current) => ({
        ...current,
        endpoint: chosen.endpoint,
        region: chosen.region,
      }));
    }
  };

  const missing = provider.configFields.some((field) => field.required && !(config[field.key] ?? '').trim());

  const save = async () => {
    setBusy(true);
    setError(null);
    const connection: CloudConnection = {
      id: `cloud-${crypto.randomUUID().slice(0, 8)}`,
      providerId: provider.id,
      label: label.trim() || provider.label,
      config,
      createdAt: Date.now(),
    };
    await saveCredential(connection, credential);
    addConnection(connection);
    setBusy(false);
    onSaved(connection);
  };

  return (
    <Modal isOpen onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="w-[480px] max-w-[94vw]">
            <Modal.Header>
              <Modal.Heading className="text-title">{provider.label}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex max-h-[64vh] flex-col gap-3">
              {provider.presets && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-label text-foreground">Preset</span>
                  <Select
                    value="custom"
                    options={[
                      { value: 'custom', label: 'Custom…' },
                      ...provider.presets.map((entry) => ({ value: entry.id, label: entry.label })),
                    ]}
                    onChange={preset}
                  />
                </label>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-label text-foreground">Name</span>
                <Input value={label} onChange={(event) => setLabel(event.target.value)} />
              </label>

              {needsAccount && (
                <div className="flex items-center gap-2 rounded-2xl bg-surface-secondary p-2.5">
                  <Cloud className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 text-meta text-foreground">
                    {accountReady
                      ? `Signed in to ${accountLabel(account, provider.accountProvider!)}`
                      : `Connect your ${provider.accountProvider} account first`}
                  </span>
                  {!accountReady && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => dispatch({ type: 'route/go', route: 'connections' })}
                    >
                      Open Connections
                    </Button>
                  )}
                </div>
              )}

              {provider.configFields.map((field) => (
                <FormField
                  key={field.key}
                  field={field}
                  value={config[field.key] ?? ''}
                  onChange={(next) => setConfig((current) => ({ ...current, [field.key]: next }))}
                />
              ))}

              {provider.credentialFields.length > 0 && (
                <div className="mt-1 flex flex-col gap-3 border-t border-separator pt-3">
                  <SectionLabel>Credential</SectionLabel>
                  {provider.credentialFields.map((field) => (
                    <FormField
                      key={field.key}
                      field={field}
                      value={credential[field.key] ?? ''}
                      onChange={(next) => setCredential((current) => ({ ...current, [field.key]: next }))}
                    />
                  ))}
                  <p className="text-meta text-muted">
                    Stored in the encrypted vault, never in the connection or the webview.
                  </p>
                </div>
              )}

              {error && <p className="rounded-2xl bg-danger-soft p-3 text-body text-danger">{error}</p>}
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2">
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                isDisabled={busy || missing || !accountReady}
                onPress={() => void save()}
              >
                {busy ? 'Saving…' : 'Connect'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/**
 * Pair one remote place with one here — a folder with a folder, or a file with a file.
 *
 * The pair is only a record of two places. Nothing is copied, and nothing will be, until the
 * reader picks a direction in the Sync scope.
 */
function PairDialog({
  connection,
  kind,
  remotePath,
  remoteName,
  defaultLocal = '',
  onClose,
  onPaired,
}: {
  connection: CloudConnection;
  kind: SyncPair['kind'];
  remotePath: string;
  remoteName: string;
  /** The workspace path to open the field on; a file pair starts on the file's own name. */
  defaultLocal?: string;
  onClose: () => void;
  onPaired: (pair: SyncPair) => void;
}) {
  const [label, setLabel] = useState(`${connection.label} · ${remoteName}`);
  const [localPath, setLocalPath] = useState(defaultLocal);
  const target = localPath.trim().replace(/^\/+|\/+$/g, '');
  const file = kind === 'file';

  const save = () => {
    const pair: SyncPair = {
      id: `pair-${crypto.randomUUID().slice(0, 8)}`,
      connectionId: connection.id,
      label: label.trim() || `${connection.label} · ${remoteName}`,
      kind,
      remotePath,
      remoteName,
      localPath: target,
      createdAt: Date.now(),
    };
    addPair(pair);
    onPaired(pair);
    onClose();
  };

  return (
    <Dialog
      open
      title={file ? 'Pair a file' : 'Pair a folder'}
      description={`${remoteName} in ${connection.label}, kept level with ${file ? 'a file' : 'a folder'} here.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={save}>
            Pair
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">Name</Label>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{file ? 'Workspace file' : 'Workspace folder'}</Label>
          <Input
            value={localPath}
            onChange={(event) => setLocalPath(event.target.value)}
            placeholder={file ? 'data/raw/amplicon.csv' : 'empty for the workspace root, or data/raw'}
          />
          <span className="text-meta text-muted">
            {file
              ? 'That one file against that one file; the Sync scope compares the pair on its own.'
              : 'Compared with the remote folder, file by file, when you open the pair in Sync.'}
          </span>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * One row in a remote listing.
 *
 * The row itself is the action: a folder opens, a file saves into the workspace. The two
 * buttons beside it are the exceptions — open it where it lives, or save it — so the common
 * case is one press rather than a choice.
 */
function RemoteRow({
  entry,
  onOpen,
  onSave,
  onPair,
  saving,
}: {
  entry: RemoteEntry;
  onOpen: () => void;
  onSave: () => void;
  /** Offered when the store can read and write one file on its own. */
  onPair?: () => void;
  saving: boolean;
}) {
  const meta = entry.isDir ? undefined : KIND_META[kindOfName(entry.name)];
  const Icon = meta?.icon ?? Folder;
  return (
    <div className="group flex items-center gap-1 rounded-xl px-3 py-2 transition-colors hover:bg-surface-secondary">
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-lg',
          meta ? `${meta.mark} ${meta.tone}` : 'bg-default text-muted',
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <button
        type="button"
        onClick={entry.isDir ? onOpen : onSave}
        className="min-w-0 flex-1 text-left"
        aria-label={entry.isDir ? `Open ${entry.name}` : `Save ${entry.name} to the workspace`}
      >
        <span className="block truncate text-body text-foreground">{entry.name}</span>
        {entry.path && <span className="block truncate text-meta text-muted">{entry.path}</span>}
      </button>
      <span className="w-20 shrink-0 text-right text-meta tabular-nums text-muted">
        {entry.size !== undefined ? formatBytes(entry.size) : ''}
      </span>
      <span className="hidden w-16 shrink-0 text-right text-meta tabular-nums text-muted sm:block">
        {entry.modified ? relativeTime(entry.modified) : ''}
      </span>
      <div className="flex shrink-0 items-center">
        {entry.isDir ? (
          <ChevronRight className="size-4 text-muted" aria-hidden />
        ) : (
          <>
            {onPair && (
              <IconButton aria-label={`Pair ${entry.name} with a file here`} onPress={onPair}>
                <Link2 className="size-3.5" />
              </IconButton>
            )}
            <IconButton aria-label={`Open ${entry.name} where it lives`} onPress={onOpen}>
              <ExternalLink className="size-3.5" />
            </IconButton>
            <IconButton
              aria-label={`Save ${entry.name} to the workspace`}
              onPress={onSave}
              isDisabled={saving}
            >
              {saving ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

/** The Cloud panel: connections, the connect flow, and the remote browser. */
export function CloudPanel({
  onSaved,
  onPaired,
  reloadSignal = 0,
}: {
  onSaved?: (dest: string) => void;
  /** Called once a pair is made, so the page can open the Sync scope on it. */
  onPaired?: (pair: SyncPair) => void;
  /** Bumped by the page's own reload, so one button refreshes whichever scope is showing. */
  reloadSignal?: number;
} = {}) {
  const { state } = useApp();
  const connections = useConnections();
  const root = activeProject(state)?.path ?? null;

  const [picking, setPicking] = useState(false);
  const [connecting, setConnecting] = useState<CloudProvider | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RemoteEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairingFile, setPairingFile] = useState<RemoteEntry | null>(null);

  const connection = openId ? findConnection(openId) : undefined;
  const searchable = connection ? canSearch(connection) : false;
  const at = trail[trail.length - 1]?.path;

  const load = useCallback(async (target: CloudConnection, path: string | undefined) => {
    setBusy(true);
    setError(null);
    try {
      setEntries(await listRemote(target, path));
    } catch (failure) {
      setEntries([]);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  // The listing follows the trail: opening a folder and pressing a crumb are the same move.
  useEffect(() => {
    if (!connection) {
      setEntries(null);
      setTrail([]);
      setQuery('');
      setResults(null);
      return;
    }
    void load(connection, at);
  }, [connection, at, reloadSignal, load]);

  useEffect(() => {
    if (connection) {
      void hasCredential(connection.id).then(setHasKey);
    }
  }, [connection]);

  // Search asks the store itself, once the reader has typed enough to mean something.
  useEffect(() => {
    const term = query.trim();
    if (!connection || !searchable || term.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchRemote(connection, term)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch((failure) => {
          if (!cancelled) {
            setResults([]);
            setError(failure instanceof Error ? failure.message : String(failure));
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection, query, searchable]);

  /** Save one remote file into the workspace, under the store and the open folder. */
  const save = async (entry: RemoteEntry) => {
    if (!connection || !root) {
      return;
    }
    const url = await downloadRemote(connection, entry);
    if (!url) {
      setNotice('This store did not give a download link for that file.');
      return;
    }
    const dest = [
      'cloud',
      safeName(connection.label),
      ...trail.map((crumb) => safeName(crumb.name)),
      safeName(entry.name),
    ].join('/');
    setSavingKey(entry.key);
    try {
      const bytes = await importFile(connection, url, dest, root);
      setNotice(`Saved ${entry.name} (${formatBytes(bytes)}) to ${dest}`);
      onSaved?.(dest);
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSavingKey(null);
    }
  };

  /** Enter a folder: the trail grows and the listing follows it. */
  const enter = (entry: RemoteEntry) => {
    setNotice(null);
    setQuery('');
    setResults(null);
    setError(null);
    setTrail((current) => [...current, { name: entry.name, path: entry.key }]);
  };

  /** Open a file where it lives, in the browser. */
  const openEntry = async (entry: RemoteEntry) => {
    if (!connection) {
      return;
    }
    const url = await openRemote(connection, entry);
    if (url) {
      await openExternal(url);
    }
  };

  // One connection open: the trail, the search, and the listing.
  if (connection) {
    const provider = findProvider(connection.providerId);
    const shown = results ?? entries ?? [];
    const searchingNow = results !== null;
    return (
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <BrandMark
            icon={connectionIcon(connection)}
            label={connection.label}
            className="size-7 rounded-lg bg-transparent"
          />
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="rounded-lg px-1.5 py-1 text-body text-muted transition-colors hover:text-foreground"
          >
            Stores
          </button>
          <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden />
          <button
            type="button"
            onClick={() => setTrail([])}
            className={cn(
              'max-w-[220px] truncate rounded-lg px-1.5 py-1 text-body transition-colors',
              trail.length === 0 ? 'text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            {connection.label}
          </button>
          {trail.map((crumb, index) => (
            <Fragment key={crumb.path}>
              <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden />
              <button
                type="button"
                onClick={() => setTrail((current) => current.slice(0, index + 1))}
                className={cn(
                  'max-w-[220px] truncate rounded-lg px-1.5 py-1 text-body transition-colors',
                  index === trail.length - 1 ? 'text-foreground' : 'text-muted hover:text-foreground',
                )}
              >
                {crumb.name}
              </button>
            </Fragment>
          ))}
          {!hasKey && provider?.auth !== 'none' && (
            <Chip size="sm" variant="soft" color="warning" className="text-meta">
              No credential
            </Chip>
          )}

          {provider?.upload && (
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onPress={() => setPairing(true)}
              title="Compare this folder with a folder in the workspace"
            >
              <FolderSync className="size-3.5" />
              Pair
            </Button>
          )}

          {searchable && (
            <div className="relative ml-auto flex w-full max-w-[260px] min-w-0 items-center">
              <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted" aria-hidden />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${provider?.label ?? 'this store'}`}
                aria-label={`Search ${connection.label}`}
                className="w-full pl-8"
              />
              {query.length > 0 && (
                <IconButton
                  aria-label="Clear the search"
                  className="absolute right-1"
                  onPress={() => setQuery('')}
                >
                  <X className="size-3.5" />
                </IconButton>
              )}
            </div>
          )}
        </div>

        {notice && (
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded-2xl bg-accent-soft px-3 py-2 text-left text-meta text-accent-soft-foreground"
          >
            {notice}
          </button>
        )}

        {searchingNow && (
          <div className="flex items-center gap-2 text-meta text-muted">
            {searching ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Search className="size-3.5" aria-hidden />
            )}
            <span>
              {results.length} {results.length === 1 ? 'result' : 'results'} in{' '}
              {provider?.label ?? 'this store'} for “{query.trim()}”
            </span>
          </div>
        )}

        {busy && entries === null && !searchingNow ? (
          <div className="grid place-items-center py-10">
            <LoaderCircle className="size-5 animate-spin text-muted" />
          </div>
        ) : error ? (
          <div className="rounded-3xl bg-surface p-6 text-center">
            <TriangleAlert className="mx-auto size-5 text-danger" aria-hidden />
            <p className="mt-2 text-body text-muted">{error}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-3xl bg-surface p-6 text-center text-body text-muted">
            {searchingNow
              ? 'Nothing in this store matches that.'
              : busy
                ? 'Listing…'
                : 'This folder is empty.'}
          </div>
        ) : (
          <div className="flex flex-col rounded-3xl bg-surface py-1">
            {shown.map((entry) => (
              <RemoteRow
                key={entry.key}
                entry={entry}
                saving={savingKey === entry.key}
                onOpen={() => (entry.isDir ? enter(entry) : void openEntry(entry))}
                onSave={() => void save(entry)}
                // A single file can be paired with a single file, when the store can address
                // one entry by key and take it back.
                onPair={
                  !entry.isDir && provider?.stat && provider.upload ? () => setPairingFile(entry) : undefined
                }
              />
            ))}
          </div>
        )}

        {pairing && (
          <PairDialog
            connection={connection}
            kind="folder"
            remotePath={at ?? connection.config.folderId ?? connection.config.prefix ?? 'root'}
            remoteName={trail[trail.length - 1]?.name ?? connection.label}
            onClose={() => setPairing(false)}
            onPaired={(pair) => onPaired?.(pair)}
          />
        )}

        {pairingFile && (
          <PairDialog
            connection={connection}
            kind="file"
            remotePath={pairingFile.key}
            remoteName={pairingFile.name}
            defaultLocal={safeName(pairingFile.name)}
            onClose={() => setPairingFile(null)}
            onPaired={(pair) => onPaired?.(pair)}
          />
        )}
      </div>
    );
  }

  // The connections list.
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <SectionLabel>Connected stores</SectionLabel>
        <Button size="sm" variant="secondary" className="ml-auto gap-1.5" onPress={() => setPicking(true)}>
          <Plus className="size-3.5" />
          Connect a store
        </Button>
      </div>

      {connections.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl bg-surface p-8 text-center">
          <Cloud className="size-5 text-muted" aria-hidden />
          <p className="text-body text-foreground">No store is connected yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {connections.map((item) => {
            const detail = [item.config.bucket, item.config.repo, item.config.projectId]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3 transition-colors hover:bg-surface-secondary"
              >
                <BrandMark icon={connectionIcon(item)} label={item.label} />
                <button type="button" onClick={() => setOpenId(item.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-body font-medium text-foreground">{item.label}</span>
                  {detail && <span className="block truncate text-meta text-muted">{detail}</span>}
                </button>
                <IconButton
                  aria-label={`Remove ${item.label}`}
                  onPress={() => {
                    void clearCredential(item.id);
                    removeConnection(item.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}

      <ProviderPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(provider) => {
          setPicking(false);
          setConnecting(provider);
        }}
      />

      {connecting && (
        <ConnectForm
          provider={connecting}
          onClose={() => setConnecting(null)}
          onSaved={(saved) => {
            setConnecting(null);
            setOpenId(saved.id);
          }}
        />
      )}
    </div>
  );
}
