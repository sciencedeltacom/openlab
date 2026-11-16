/**
 * The provider registry.
 *
 * The OpenCode idea, kept in the app's own store: a provider is data — a protocol, a base URL
 * and a list of models — and adding one is a form, not a code change. Everything models.dev
 * knows is already here, so the catalog is the starting point and a custom entry is the
 * escape hatch. A custom entry with a known id overrides it.
 *
 * Keys stay in the OS credential store; open a provider here to add one, or use Models.
 */

import { useMemo, useState } from 'react';
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Plus, Search, Trash2, Wrench } from 'lucide-react';

import {
  Button,
  Cell,
  CellGroup,
  CellSeparator,
  Chip,
  Dialog,
  IconButton,
  Input,
  Label,
  ScrollShadow,
  SectionLabel,
  Select,
  Spinner,
  SwitchRow,
  TextArea,
  Tip,
} from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { useApp, usePageTitle } from '@/store/app';
import { allProviders } from '@/store/types';
import { invokeCommand } from '@/lib/ipc';
import { notify } from '@/lib/toast';
import { PROVIDERS, createProvider, parseModelLine, type Protocol, type Provider } from '@/lib/providers';
import { MODELS_DEV_SOURCE } from '@/lib/models-dev';

/** The wire protocols a provider can speak. */
const PROTOCOLS: { value: Protocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI-compatible' },
  { value: 'anthropic', label: 'Anthropic Messages' },
  { value: 'google', label: 'Google Generative Language' },
  { value: 'local', label: 'Local server (OpenAI-compatible)' },
];

/** A protocol as a phrase. */
function protocolLabel(protocol: Protocol): string {
  return PROTOCOLS.find((entry) => entry.value === protocol)?.label ?? protocol;
}

/** How many catalog rows to render before a search has to narrow them. */
const CATALOG_PAGE = 60;

/** The add/edit form. */
function ProviderForm({ initial, onClose }: { initial: Provider | null; onClose: () => void }) {
  const { dispatch } = useApp();
  const [id, setId] = useState(initial?.id ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [protocol, setProtocol] = useState<Protocol>(initial?.protocol ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(initial?.defaultBaseUrl ?? '');
  const [requiresKey, setRequiresKey] = useState(initial?.requiresKey ?? true);
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [models, setModels] = useState(
    (initial?.models ?? [])
      .map((model) =>
        [model.id, model.label, model.contextWindow].filter((part) => part !== undefined).join(' | '),
      )
      .join('\n'),
  );

  const cleanId = id.trim();
  const canSave = cleanId.length > 0 && baseUrl.trim().length > 0 && !cleanId.includes(' ');

  const save = () => {
    const parsed = models
      .split('\n')
      .map((line) => parseModelLine(line))
      .filter((model): model is NonNullable<typeof model> => model !== undefined);
    if (initial && initial.id !== cleanId) {
      dispatch({ type: 'provider/remove', id: initial.id });
    }
    dispatch({
      type: 'provider/add',
      provider: createProvider({
        id: cleanId,
        label,
        protocol,
        baseUrl,
        requiresKey,
        summary,
        models: parsed,
      }),
    });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={initial ? 'Edit provider' : 'Add provider'}
      description="A protocol, a base URL and the models it serves."
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!canSave} onPress={save}>
            Save provider
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Id</span>
            <Input
              value={id}
              onChange={(event) => setId((event.target as HTMLInputElement).value)}
              placeholder="my-gateway"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Name</span>
            <Input
              value={label}
              onChange={(event) => setLabel((event.target as HTMLInputElement).value)}
              placeholder="My gateway"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-label text-foreground">Protocol</span>
          <Select
            value={protocol}
            options={PROTOCOLS}
            onChange={(value) => setProtocol(value as Protocol)}
            label="Protocol"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label text-foreground">Base URL</span>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl((event.target as HTMLInputElement).value)}
            placeholder="https://gateway.example.edu/v1"
          />
        </label>

        <SwitchRow
          label="Requires an API key"
          hint="Stored in the OS credential store, added from Models."
          checked={requiresKey}
          onChange={setRequiresKey}
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-label text-foreground">Summary</span>
          <Input
            value={summary}
            onChange={(event) => setSummary((event.target as HTMLInputElement).value)}
            placeholder="One line about this provider"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label text-foreground">Models</span>
          <TextArea
            value={models}
            onChange={(event) => setModels((event.target as HTMLTextAreaElement).value)}
            placeholder={'gpt-5.2 | GPT-5.2 | 400000\nmy-model | My Model'}
          />
          <span className="text-meta text-muted">
            One per line: <span className="font-mono">id | label | context</span>. Label and context are
            optional.
          </span>
        </label>
      </div>
    </Dialog>
  );
}

/**
 * One provider, open: connect a key, point it at a base URL, pick a model.
 *
 * The catalog row said "add key", so this is where a key is actually added — the same OS
 * credential store the Models panel writes to, reached from the registry instead.
 */
function ProviderDialog({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const { state, dispatch, refreshProviderKeys } = useApp();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasKey = state.providerKeys[provider.id] ?? false;
  const needsKey = provider.requiresKey && provider.protocol !== 'local';

  const saveKey = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    const result = await invokeCommand('secret_set', { provider: provider.id, value: key.trim() });
    setBusy(false);
    if (result.ok) {
      setKey('');
      await refreshProviderKeys();
      notify(`Saved the ${provider.label} key`, { tone: 'success' });
    } else {
      setError(result.error.message);
      notify(`Could not save the ${provider.label} key`, {
        description: result.error.message,
        tone: 'danger',
      });
    }
  };

  const clearKey = async () => {
    setBusy(true);
    const result = await invokeCommand('secret_delete', { provider: provider.id });
    setBusy(false);
    await refreshProviderKeys();
    if (result.ok) {
      notify(`Removed the ${provider.label} key`, { tone: 'success' });
    } else {
      notify(`Could not remove the ${provider.label} key`, {
        description: result.error.message,
        tone: 'danger',
      });
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={provider.label}
      description={`${provider.models.length} models · ${protocolLabel(provider.protocol)}`}
      width={560}
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onPress={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {needsKey && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Label className="text-label">API key</Label>
              {hasKey && (
                <Chip size="sm" color="success" className="text-meta">
                  <Check className="size-3" />
                  stored
                </Chip>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                variant="secondary"
                type={reveal ? 'text' : 'password'}
                value={key}
                onChange={(event) => setKey((event.target as HTMLInputElement).value)}
                placeholder={hasKey ? 'Stored. Enter a new key to replace it' : 'Paste a key'}
                className="flex-1"
              />
              <Tip content={reveal ? 'Hide' : 'Show'}>
                <IconButton aria-label="Toggle key visibility" onPress={() => setReveal(!reveal)}>
                  {reveal ? <EyeOff /> : <Eye />}
                </IconButton>
              </Tip>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                isDisabled={busy || !key.trim()}
                onPress={() => void saveKey()}
                className="gap-1.5"
              >
                <KeyRound className="size-3.5" />
                Save key
              </Button>
              {hasKey && (
                <Button variant="danger-soft" size="sm" isDisabled={busy} onPress={() => void clearKey()}>
                  Remove
                </Button>
              )}
              {busy && <Spinner />}
            </div>
            {provider.docsUrl && (
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-meta text-link underline underline-offset-2"
              >
                Where to get a key
              </a>
            )}
            {error && <p className="text-body text-danger">{error}</p>}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label className="text-label">Base URL</Label>
          <Input
            variant="secondary"
            value={state.providerBaseUrls[provider.id] ?? provider.defaultBaseUrl ?? ''}
            onChange={(event) =>
              dispatch({
                type: 'provider/baseUrl',
                providerId: provider.id,
                baseUrl: (event.target as HTMLInputElement).value,
              })
            }
            placeholder="https://…/v1"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-label">Models</Label>
          <ScrollShadow className="max-h-[300px]">
            <div className="flex flex-col gap-1">
              {provider.models.map((model) => {
                const ref = `${provider.id}/${model.id}`;
                const active = state.modelRef === ref;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => dispatch({ type: 'model/selected', modelRef: ref })}
                    className={
                      active
                        ? 'flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-start'
                        : 'flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-start hover:bg-surface-secondary'
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-foreground">{model.label}</span>
                      <span className="block truncate font-mono text-meta text-muted">{model.id}</span>
                    </span>
                    {model.contextWindow && (
                      <Chip size="sm" className="text-meta text-muted">
                        {Math.round(model.contextWindow / 1000)}k
                      </Chip>
                    )}
                    {active && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </ScrollShadow>
        </div>
      </div>
    </Dialog>
  );
}

/** The provider registry. */
export function ProvidersScreen() {
  const { state, dispatch } = useApp();
  usePageTitle('Providers');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [viewing, setViewing] = useState<Provider | null>(null);
  const [query, setQuery] = useState('');

  const custom = state.customProviders;
  const all = useMemo(() => allProviders(state), [state.customProviders, state.catalogProviders]);

  const customIds = useMemo(() => new Set(custom.map((provider) => provider.id)), [custom]);

  const catalog = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rest = all
      .filter((provider) => !customIds.has(provider.id))
      .filter((provider) => {
        if (!needle) return true;
        if (`${provider.label} ${provider.id}`.toLowerCase().includes(needle)) return true;
        return provider.models.some((model) => model.label.toLowerCase().includes(needle));
      })
      .sort((a, b) => b.models.length - a.models.length || a.label.localeCompare(b.label));
    return needle ? rest : rest.slice(0, CATALOG_PAGE);
  }, [all, customIds, query]);

  const totalModels = useMemo(() => all.reduce((sum, provider) => sum + provider.models.length, 0), [all]);
  const connected = all.filter(
    (provider) => state.providerKeys[provider.id] || provider.protocol === 'local',
  ).length;

  const startAdd = () => {
    setEditing(null);
    setOpen(true);
  };
  const startEdit = (provider: Provider) => {
    setEditing(provider);
    setOpen(true);
  };

  return (
    <SettingsPage
      aside={[
        {
          title: 'Registry',
          items: [
            { label: 'Providers', value: String(all.length) },
            { label: 'Models', value: totalModels.toLocaleString('en-US') },
            { label: 'Ready', value: String(connected) },
          ],
        },
        {
          title: 'Catalog source',
          items: [{ label: 'models.dev', value: 'embedded' }],
        },
      ]}
    >
      <div className="flex w-full flex-col gap-8">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <SectionLabel>Your providers</SectionLabel>
              <p className="text-meta text-muted">
                Overrides a built-in or catalog provider with the same id.
              </p>
            </div>
            <Button size="sm" variant="secondary" className="shrink-0 gap-1.5" onPress={startAdd}>
              <Plus className="size-3.5" />
              Add provider
            </Button>
          </div>

          {custom.length === 0 ? (
            <CellGroup footnote="A custom provider is saved on this machine.">
              <Cell
                label="None yet"
                description="Add one to point openlab at a gateway, a lab server or a local endpoint."
              />
            </CellGroup>
          ) : (
            <CellGroup>
              {custom.map((provider, index) => (
                <div key={provider.id}>
                  {index > 0 && <CellSeparator />}
                  <Cell
                    leading={<Wrench className="size-4 shrink-0 text-accent" aria-hidden />}
                    label={provider.label}
                    description={`${provider.id} · ${protocolLabel(provider.protocol)} · ${provider.models.length} models`}
                    control={
                      <>
                        <Button size="sm" variant="ghost" onPress={() => startEdit(provider)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          aria-label={`Remove ${provider.label}`}
                          onPress={() => dispatch({ type: 'provider/remove', id: provider.id })}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    }
                  />
                </div>
              ))}
            </CellGroup>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <SectionLabel>Catalog</SectionLabel>
            <p className="text-meta text-muted">
              {all.length} providers from models.dev and the built-ins
              {query ? ` · ${catalog.length} match` : ` · showing the ${catalog.length} largest`}
              {' · '}
              {catalog
                .reduce((sum, provider) => sum + provider.models.length, 0)
                .toLocaleString('en-US')}{' '}
              models listed.
            </p>
          </div>

          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
            <Input
              type="search"
              variant="secondary"
              value={query}
              onChange={(event) => setQuery((event.target as HTMLInputElement).value)}
              placeholder="Search providers or models"
              aria-label="Search providers"
              className="w-full pl-9"
            />
          </div>

          <CellGroup>
            {catalog.map((provider, index) => {
              const ready = Boolean(state.providerKeys[provider.id]) || provider.protocol === 'local';
              return (
                <div key={provider.id}>
                  {index > 0 && <CellSeparator />}
                  <Cell
                    onClick={() => setViewing(provider)}
                    label={provider.label}
                    description={`${protocolLabel(provider.protocol)} · ${provider.models.length} model${provider.models.length === 1 ? '' : 's'}`}
                    control={
                      ready ? (
                        <Chip size="sm" color="success" className="text-meta">
                          <Check className="size-3" />
                          {provider.protocol === 'local' ? 'local' : 'ready'}
                        </Chip>
                      ) : (
                        <Chip size="sm" color="accent" className="text-meta">
                          <KeyRound className="size-3" />
                          add key
                        </Chip>
                      )
                    }
                  />
                </div>
              );
            })}
          </CellGroup>
          <p className="px-1 text-meta text-muted">
            Catalog from{' '}
            <a
              href={MODELS_DEV_SOURCE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              models.dev
              <ExternalLink className="size-3" aria-hidden />
            </a>
            , embedded in the app. {PROVIDERS.length} built-in providers ship alongside it.
          </p>
        </section>
      </div>

      {open && <ProviderForm initial={editing} onClose={() => setOpen(false)} />}
      {viewing && <ProviderDialog provider={viewing} onClose={() => setViewing(null)} />}
    </SettingsPage>
  );
}
