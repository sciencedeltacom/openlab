/**
 * Adding a target.
 *
 * A target is a machine, and every machine wants a different set of answers: a host and a key
 * for SSH, a queue and a region for Batch, a token for Modal, a folder for Kaggle. Asking for
 * all of it in one dialog is how a form becomes a wall of unrelated inputs, so this is a page:
 * pick the kind first, and the page then asks exactly what that kind needs.
 *
 * The check is not decoration. Pressing it runs the provider's own CLI through the workspace
 * host — `ssh` for a login node, an authenticated API call for Kaggle, `sts get-caller-identity`
 * for AWS — and the target is added carrying the answer. A machine that has not answered yet
 * is added as needing setup, with the reason in its record.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, CircleAlert, CircleCheck, KeyRound, PlugZap, Server, Terminal } from 'lucide-react';

import { Button, Chip, Input, Label, NumberInput, ScrollShadow, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { isDesktop } from '@/lib/ipc';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import { newTarget, type Readiness, type Target } from '@/store/compute';
import { useTargets } from '@/hooks/useCompute';
import {
  ADAPTER_ORDER,
  adapterFor,
  defaultConfig,
  hostOf,
  missingConfig,
  missingSecrets,
  type ConfigField,
} from '@/lib/compute/adapters';
import { checkTarget, saveTargetSecrets, type TargetCheck } from '@/lib/compute/run';
import { TargetKindMark } from '../compute/Marks';
import { TARGET_KIND_META } from '../compute/data';

/** A labelled field. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-foreground">{label}</span>
      {children}
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </label>
  );
}

/** The header a section of the form shares. */
function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
      <div className="flex flex-col gap-0.5">
        <SectionLabel>{title}</SectionLabel>
        {note && <p className="text-meta text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** One configuration input, rendered by what the field says it holds. */
function ConfigInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={field.required ? field.label : `${field.label} (optional)`} hint={field.hint}>
      <Input
        type={field.kind === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(event) => onChange((event.target as HTMLInputElement).value)}
        placeholder={field.placeholder}
        aria-label={field.label}
      />
    </Field>
  );
}

export function TargetCreate() {
  const { state, dispatch } = useApp();
  const edits = useTargets();
  const leave = () => dispatch({ type: 'route/go', route: 'compute/targets' });

  const [kind, setKind] = useState<Target['kind'] | null>(null);
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [cores, setCores] = useState('8');
  const [memory, setMemory] = useState('32');
  const [gpus, setGpus] = useState('');
  const [concurrency, setConcurrency] = useState('1');
  const [check, setCheck] = useState<TargetCheck | null>(null);
  const [busy, setBusy] = useState(false);

  const adapter = kind ? adapterFor(kind) : null;
  const workspace = activeProject(state)?.path ?? null;

  /** The required configuration this kind has not been given. */
  const missingFields = useMemo(() => (kind ? missingConfig(kind, config) : []), [kind, config]);

  /** The required credentials that are neither stored nor typed in. */
  const missingKeys = useMemo(() => {
    if (!kind) return [];
    const typed = Object.entries(secrets)
      .filter(([, value]) => value.trim() !== '')
      .map(([key]) => key);
    return missingSecrets(kind, typed);
  }, [kind, secrets]);

  const canAdd = Boolean(kind && name.trim() && missingFields.length === 0 && missingKeys.length === 0);

  /** Pick a kind: the form below is rebuilt from that adapter's own schema. */
  const choose = (next: Target['kind']) => {
    setKind(next);
    setConfig(defaultConfig(next));
    setSecrets({});
    setCheck(null);
    if (!name.trim()) setName(adapterFor(next).label);
  };

  /** A target shaped like the record, so the probe can be run before it exists. */
  const draft = (): Target =>
    newTarget({
      name: name.trim() || adapter?.label || 'Target',
      kind: kind ?? 'local',
      host: kind ? hostOf(kind, config) : '',
      summary: adapter?.summary,
      cores: Number(cores) || 1,
      memoryGb: Number(memory) || 1,
      gpus: gpus.trim() || undefined,
      concurrency: Number(concurrency) || 0,
      config,
    });

  /**
   * Check the machine before it is added.
   *
   * The draft has no record yet, so its credentials cannot come from the keyring: the values
   * typed on this page are handed to the one probe call. They are written to the keyring when
   * the target is added, and every later check reads them from there.
   */
  const test = async () => {
    if (!kind || !workspace) return;
    setBusy(true);
    try {
      setCheck(await checkTarget(draft(), workspace, secrets));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!kind) return;
    const target = draft();
    const readiness: Readiness =
      check === null
        ? 'needs-setup'
        : check.ok
          ? 'ready'
          : check.tone === 'warning'
            ? 'needs-setup'
            : 'offline';
    const record: Target = {
      ...target,
      readiness,
      needs: check === null ? ['A successful connection check'] : check.ok ? [] : [check.detail],
      credentials: adapter?.secrets.map((field) => field.label) ?? [],
      check:
        check === null
          ? { at: 'never', tone: 'warning', detail: 'Not checked yet.' }
          : { at: 'just now', tone: check.tone, detail: check.detail },
    };

    if (isDesktop()) {
      const typed = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value.trim() !== ''));
      if (Object.keys(typed).length > 0) {
        const written = await saveTargetSecrets(record.id, typed);
        if (written.length !== Object.keys(typed).length) {
          // The record is still worth keeping; the page says which key did not land.
          record.needs = [...record.needs, 'A credential could not be written to the keyring'];
        }
      }
    }

    edits.add(record, record.name);
    dispatch({ type: 'route/go', route: `compute/targets/${record.id}` });
  };

  return (
    <ScrollShadow className="h-full">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-7 py-7">
        <header className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="w-fit gap-1.5" onPress={leave}>
            <ArrowLeft className="size-3.5" />
            Targets
          </Button>
          <h1 className="text-[1.5rem] font-semibold text-foreground">Add a target</h1>
          <p className="max-w-[70ch] text-body text-muted">
            A machine a job can be sent to. The check runs the provider&rsquo;s own command before it is
            added.
          </p>
        </header>

        <Block title="Kind" note="How jobs reach this machine. Each kind declares its own inputs below.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ADAPTER_ORDER.map((candidate) => {
              const meta = adapterFor(candidate);
              const on = candidate === kind;
              return (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={on}
                  onClick={() => choose(candidate)}
                  className={cn(
                    'flex flex-col gap-2 rounded-2xl border p-3 text-left transition-colors',
                    on
                      ? 'border-accent bg-accent/10'
                      : 'border-transparent bg-surface hover:bg-surface-secondary',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <TargetKindMark kind={candidate} className="size-7 rounded-lg" />
                    <span className="text-body text-foreground">{TARGET_KIND_META[candidate].label}</span>
                    {on && <CircleCheck className="ml-auto size-4 text-accent" aria-hidden />}
                  </span>
                  <span className="text-meta text-muted">{meta.summary}</span>
                  {meta.requires.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {meta.requires.map((binary) => (
                        <Chip key={binary} size="sm" variant="soft" color="default">
                          needs {binary}
                        </Chip>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Block>

        {adapter && kind && (
          <>
            <Block title="Name">
              <Field label="Name" hint="How the machine is listed in the ledger.">
                <Input
                  value={name}
                  onChange={(event) => setName((event.target as HTMLInputElement).value)}
                  placeholder={adapter.label}
                  aria-label="Target name"
                />
              </Field>
            </Block>

            <Block
              title={`${TARGET_KIND_META[kind].label} configuration`}
              note="Where it is and how it is reached. Stored with the target."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {adapter.config.map((field) => (
                  <ConfigInput
                    key={field.key}
                    field={field}
                    value={config[field.key] ?? ''}
                    onChange={(next) => setConfig((current) => ({ ...current, [field.key]: next }))}
                  />
                ))}
              </div>
            </Block>

            {adapter.secrets.length > 0 && (
              <Block
                title="Credentials"
                note="Kept in the credential vault, keyed to this target. Never written into the target record."
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {adapter.secrets.map((field) => (
                    <Field
                      key={field.key}
                      label={field.required ? field.label : `${field.label} (optional)`}
                      hint={field.hint ?? `Exported as ${field.key}.`}
                    >
                      <Input
                        type="password"
                        value={secrets[field.key] ?? ''}
                        onChange={(event) =>
                          setSecrets((current) => ({
                            ...current,
                            [field.key]: (event.target as HTMLInputElement).value,
                          }))
                        }
                        placeholder={field.key}
                        aria-label={field.label}
                      />
                    </Field>
                  ))}
                </div>
                {!isDesktop() && (
                  <p className="text-meta text-warning">
                    The keyring is only available in the desktop app; credentials cannot be stored in a
                    browser.
                  </p>
                )}
              </Block>
            )}

            <Block title="Capacity" note="What a job may ask this machine for.">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Cores">
                  <NumberInput
                    label="Cores"
                    min={1}
                    value={cores ? Number(cores) : undefined}
                    onChange={(next) => setCores(next === undefined ? '' : String(next))}
                    fullWidth
                  />
                </Field>
                <Field label="Memory (GB)">
                  <NumberInput
                    label="Memory in gigabytes"
                    min={1}
                    value={memory ? Number(memory) : undefined}
                    onChange={(next) => setMemory(next === undefined ? '' : String(next))}
                    fullWidth
                  />
                </Field>
                <Field label="GPU">
                  <Input
                    value={gpus}
                    onChange={(event) => setGpus((event.target as HTMLInputElement).value)}
                    placeholder="e.g. A100 40GB"
                    aria-label="GPU"
                  />
                </Field>
                <Field label="Concurrency">
                  <NumberInput
                    label="Concurrency"
                    min={0}
                    value={concurrency ? Number(concurrency) : undefined}
                    onChange={(next) => setConcurrency(next === undefined ? '' : String(next))}
                    fullWidth
                  />
                </Field>
              </div>
            </Block>

            <Block title="Connection check" note="Runs this kind's own command in the workspace.">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  className="gap-1.5"
                  isDisabled={busy || !workspace}
                  onPress={() => void test()}
                >
                  <PlugZap className="size-3.5" />
                  {busy ? 'Checking…' : 'Check connection'}
                </Button>
                {!workspace && (
                  <span className="text-meta text-warning">Open a workspace before checking.</span>
                )}
                {missingFields.length > 0 && (
                  <span className="flex items-center gap-1.5 text-meta text-warning">
                    <CircleAlert className="size-3.5" aria-hidden />
                    Missing {missingFields.map((field) => field.label.toLowerCase()).join(', ')}
                  </span>
                )}
              </div>

              {check && (
                <div
                  className={cn(
                    'flex flex-col gap-2 rounded-2xl p-3',
                    check.ok ? 'bg-success/10' : 'bg-danger/10',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {check.ok ? (
                      <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
                    ) : (
                      <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden />
                    )}
                    <span className="text-body text-foreground">{check.detail}</span>
                  </span>
                  <pre className="max-h-40 overflow-auto rounded-xl bg-code-wrapper p-2.5 text-meta text-foreground">
                    <code>{`$ ${check.command}\n${check.output || '(no output)'}`}</code>
                  </pre>
                </div>
              )}
            </Block>
          </>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-meta text-muted">
            {adapter && adapter.secrets.length > 0 ? (
              <>
                <KeyRound className="size-3.5" aria-hidden />
                {adapter.secrets.length} credential{adapter.secrets.length === 1 ? '' : 's'} to the keyring.
              </>
            ) : (
              <>
                <Server className="size-3.5" aria-hidden />
                No credential needed.
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onPress={leave}>
              Cancel
            </Button>
            <Button variant="primary" isDisabled={!canAdd} onPress={() => void add()}>
              <Terminal className="size-3.5" />
              Add target
            </Button>
          </div>
        </footer>
      </div>
    </ScrollShadow>
  );
}
