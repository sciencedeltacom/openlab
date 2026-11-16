/**
 * A database's record page, and the half that matters: the place a reader connects and
 * runs a request.
 *
 * Three panels, in the order the work happens — connection, request, response — then what
 * the database holds. The key is written to the operating system's credential store through
 * the `secret_set` command and is never read back into the webview; when a request needs it,
 * the provider id travels with the request and the desktop service resolves the secret.
 *
 * There is no live request service in development, so a Run attempts one and, when it does
 * not answer, shows the database's own sample response and says that it is a sample.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  Archive,
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  Hash,
  KeyRound,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Scale,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import { Button, Chip, IconButton, Input, Select, SectionLabel, TextArea } from '@/components/ui';
import { Fact, FactGroup, RecordMissing, RecordPage } from '@/components/research/PageShell';
import { invokeCommand, isDesktop } from '@/lib/ipc';
import { operationUrl, runOperation } from '@/lib/catalog/request';
import { parseBody } from '@/lib/catalog/request';
import { notify } from '@/lib/toast';
import { usePageTitle } from '@/store/app';
import { DatabaseMark, DatabaseStateMark } from './Marks';
import { databaseOperation, operationDefaults, type Operation } from './data';
import { useDatabases } from './store';
import {
  AUTHORIZATION_LABEL,
  DATABASE_STATE,
  type Database,
  type DatabaseAuthorization,
  type DatabaseMethod,
  type DatabaseResponse,
  type DatabaseTable,
} from './data';

/** One header row the editor can edit. The id is local to the list. */
interface EditableHeader {
  id: string;
  name: string;
  value: string;
}

/** What a Run produced, and whether it was the real service or the sample. */
interface RunResult {
  source: 'live' | 'sample';
  /** Why the sample is shown, when it is. */
  reason?: string;
  status: number;
  elapsedMs: number;
  content: DatabaseResponse;
  count: number;
}

/** A labelled field, stacked. Long values get the width; the settings idiom does not fit. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <span className="flex flex-col gap-1.5">
      <span className="text-label text-muted">{label}</span>
      {children}
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </span>
  );
}

/** A table's record count, or the document count for text. */
function countOf(content: DatabaseResponse): number {
  return content.kind === 'table' ? content.rows.length : 1;
}

/** Render one API value as a short cell. Objects and arrays are flattened, never dropped. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map(cellText).join(', ');
  if (typeof value === 'object') {
    return JSON.stringify(value) ?? String(value);
  }
  return String(value);
}

/**
 * Turn a decoded response into something the page can draw.
 *
 * An array of objects becomes a table with the union of its keys; anything else is shown as
 * text. That is the whole rule, and it is enough for the APIs in the catalogue.
 */
function toResponse(value: unknown): DatabaseResponse {
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
  ) {
    const records = value as Record<string, unknown>[];
    const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record)))).slice(0, 6);
    return {
      kind: 'table',
      columns,
      rows: records.slice(0, 50).map((record) => columns.map((column) => cellText(record[column]))),
    };
  }
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value));
  return { kind: 'text', text };
}

/** A tabular response: one island, no rules between rows. */
function ResultTable({ content }: { content: DatabaseTable }) {
  const template = content.columns.map(() => 'minmax(0, 1fr)').join(' ');

  return (
    <div className="overflow-x-auto rounded-2xl bg-surface">
      <div
        className="grid gap-x-4 bg-surface-tertiary px-3 py-2"
        style={{ gridTemplateColumns: template, minWidth: '36rem' }}
      >
        {content.columns.map((column) => (
          <div key={column} className="section-label">
            {column}
          </div>
        ))}
      </div>
      <div className="flex flex-col">
        {content.rows.map((row, index) => (
          <div
            key={index}
            className="grid gap-x-4 rounded-lg px-3 py-2 transition-colors hover:bg-surface-secondary"
            style={{ gridTemplateColumns: template, minWidth: '36rem' }}
          >
            {row.map((cell, cellIndex) => (
              <div key={cellIndex} className="min-w-0 truncate text-meta tabular-nums text-foreground">
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The response, with its status, its elapsed time and how many records came back. */
function ResponsePanel({ result }: { result: RunResult | null }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>Response</SectionLabel>
        {result && (
          <>
            <Chip size="sm" color={result.source === 'live' ? 'success' : 'default'}>
              {result.source === 'live' ? 'Live' : 'Sample'}
            </Chip>
            <span className="text-meta tabular-nums text-muted">Status {result.status}</span>
            <span className="text-meta tabular-nums text-muted">{result.elapsedMs} ms</span>
            <span className="text-meta tabular-nums text-muted">
              {result.count}{' '}
              {result.content.kind === 'table' ? (result.count === 1 ? 'record' : 'records') : 'document'}
            </span>
          </>
        )}
      </div>

      {result === null ? (
        <div className="rounded-2xl bg-surface p-6">
          <p className="max-w-[70ch] text-body text-muted">
            Run the request to see a response. With no live service, the sample response is shown.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {result.source === 'sample' && (
            <p className="flex items-start gap-2 rounded-2xl bg-warning/10 px-3 py-2 text-meta text-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              <span>Sample response. {result.reason}</span>
            </p>
          )}
          {result.content.kind === 'table' ? (
            <ResultTable content={result.content} />
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-surface p-4 text-meta text-foreground">
              {result.content.text}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

/** A form's opening values for an operation: its declared defaults. */
function defaultsFor(operation: Operation | undefined): Record<string, string> {
  if (!operation) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(operationDefaults(operation)).map(([name, value]) => [name, String(value)]),
  );
}

/** The form's strings as the operation's arguments: numbers where the parameter is one. */
function coerceArgs(operation: Operation, values: Record<string, string>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const parameter of operation.parameters) {
    const value = values[parameter.name];
    if (value === undefined || value === '') {
      continue;
    }
    args[parameter.name] = parameter.kind === 'number' ? Number(value) : value;
  }
  return args;
}

/** The page body, keyed by id so switching databases re-reads cleanly. */
function DatabaseDetailBody({ database }: { database: Database }) {
  usePageTitle(database.name);

  const [authorization, setAuthorization] = useState<DatabaseAuthorization>(database.authorization);
  const [headers, setHeaders] = useState<EditableHeader[]>(() =>
    database.defaultHeaders.map((header, index) => ({ id: `header-${index}`, ...header })),
  );
  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const [operationId, setOperationId] = useState(database.operations[0]?.id ?? '');
  const [args, setArgs] = useState<Record<string, string>>(() => defaultsFor(database.operations[0]));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  // The credential is filed under the database id, prefixed so it cannot collide with a
  // model provider's entry in the same OS store.
  const secretProvider = `database-${database.id}`;
  const operation = databaseOperation(database, operationId);
  const url = operation
    ? operationUrl(database, operationId, coerceArgs(operation, args))
    : database.endpoint;
  const keyLabel = AUTHORIZATION_LABEL[authorization];

  // Ask whether a key exists, never for the key itself. The store is the only reader.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await invokeCommand<{ provider: string; hasKey: boolean }[]>('secrets_status', {
        providers: [secretProvider],
      });
      if (!cancelled && response.ok) {
        setHasKey(response.value[0]?.hasKey ?? false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [secretProvider]);

  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    setKeyBusy(true);
    setKeyError(null);
    const response = await invokeCommand('secret_set', { provider: secretProvider, value: keyDraft.trim() });
    setKeyBusy(false);
    if (response.ok) {
      setKeyDraft('');
      setHasKey(true);
      notify(`Saved the ${database.name} key`, { tone: 'success' });
    } else {
      setKeyError(response.error.message);
      notify(`Could not save the ${database.name} key`, {
        description: response.error.message,
        tone: 'danger',
      });
    }
  };

  const removeKey = async () => {
    setKeyBusy(true);
    const response = await invokeCommand('secret_delete', { provider: secretProvider });
    setKeyBusy(false);
    if (response.ok) {
      setHasKey(false);
      setKeyDraft('');
      notify(`Removed the ${database.name} key`, { tone: 'success' });
    } else {
      notify(`Could not remove the ${database.name} key`, {
        description: response.error.message,
        tone: 'danger',
      });
    }
  };

  const updateHeader = (id: string, field: 'name' | 'value', value: string) =>
    setHeaders((current) =>
      current.map((header) => (header.id === id ? { ...header, [field]: value } : header)),
    );

  const addHeader = () =>
    setHeaders((current) => [...current, { id: `header-${Date.now()}`, name: '', value: '' }]);

  const removeHeader = (id: string) => setHeaders((current) => current.filter((header) => header.id !== id));

  const run = async () => {
    const started = performance.now();
    setRunning(true);
    setResult(null);

    const requestHeaders: Record<string, string> = {};
    for (const header of headers) {
      if (header.name.trim()) requestHeaders[header.name.trim()] = header.value;
    }

    const sample = (reason: string): RunResult => ({
      source: 'sample',
      reason,
      status: 200,
      elapsedMs: Math.round(performance.now() - started),
      content: database.sample,
      count: countOf(database.sample),
    });

    if (!operation) {
      setRunning(false);
      setResult(sample('This database has no operations defined.'));
      return;
    }

    if (!isDesktop()) {
      setRunning(false);
      setResult(sample('The desktop request service is not attached, so nothing was sent.'));
      return;
    }

    const response = await runOperation(database, operationId, coerceArgs(operation, args), {
      headers: requestHeaders,
    });
    setRunning(false);

    if (response.ok) {
      const content = toResponse(response.data);
      setResult({
        source: 'live',
        status: 200,
        elapsedMs: Math.round(performance.now() - started),
        content,
        count: countOf(content),
      });
    } else {
      setResult(sample(`The desktop request service did not answer (${response.error ?? 'no answer'}).`));
    }
  };

  return (
    <RecordPage
      eyebrow={<SectionLabel>Database</SectionLabel>}
      title={database.name}
      status={<DatabaseStateMark state={database.state} />}
      lede={<p className="max-w-[70ch] text-body text-muted">{database.purpose}</p>}
    >
      <section className="flex flex-col gap-2">
        <SectionLabel>Connection</SectionLabel>
        <div className="flex flex-col gap-4 rounded-2xl bg-surface p-4">
          <Field label="Endpoint">
            <Input readOnly value={database.endpoint} aria-label="Endpoint" />
          </Field>

          <Field label="Authentication">
            <Select
              label="Authentication"
              value={authorization}
              options={[
                { value: 'none' as const, label: AUTHORIZATION_LABEL.none },
                { value: 'api-key' as const, label: AUTHORIZATION_LABEL['api-key'] },
                { value: 'bearer' as const, label: AUTHORIZATION_LABEL.bearer },
              ]}
              onChange={setAuthorization}
              className="w-56"
            />
          </Field>

          {authorization !== 'none' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-label text-muted">{keyLabel}</span>
              <div className="flex items-center gap-1.5">
                <Input
                  type={reveal ? 'text' : 'password'}
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  placeholder={hasKey ? 'Stored. Enter a new key to replace it' : 'Paste a key'}
                  aria-label={keyLabel}
                  className="min-w-0 flex-1"
                />
                <IconButton
                  aria-label="Toggle key visibility"
                  onPress={() => setReveal((current) => !current)}
                >
                  {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </IconButton>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  isDisabled={keyBusy || !keyDraft.trim()}
                  onPress={() => void saveKey()}
                  className="gap-1.5"
                >
                  <KeyRound className="size-3.5" />
                  Save key
                </Button>
                {hasKey && (
                  <Chip size="sm" color="success">
                    <CircleCheck className="size-3" />
                    Stored
                  </Chip>
                )}
                {hasKey && (
                  <Button
                    variant="danger-soft"
                    size="sm"
                    isDisabled={keyBusy}
                    onPress={() => void removeKey()}
                    className="gap-1.5"
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                )}
              </div>
              <span className="text-meta text-muted">
                Stored in the operating system&rsquo;s credential store, never in this app&rsquo;s files.
              </span>
              {keyError && <span className="text-meta text-danger">{keyError}</span>}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-label text-muted">Headers</span>
              <Button size="sm" variant="ghost" className="ml-auto gap-1.5" onPress={addHeader}>
                <Plus className="size-3.5" />
                Add header
              </Button>
            </div>
            {headers.length === 0 ? (
              <p className="text-meta text-muted">No headers. The request is sent with no extra headers.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {headers.map((header) => (
                  <div
                    key={header.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2"
                  >
                    <Input
                      value={header.name}
                      onChange={(event) => updateHeader(header.id, 'name', event.target.value)}
                      placeholder="Name"
                      aria-label="Header name"
                      className="w-40"
                    />
                    <Input
                      value={header.value}
                      onChange={(event) => updateHeader(header.id, 'value', event.target.value)}
                      placeholder="Value"
                      aria-label="Header value"
                      className="min-w-0 flex-1"
                    />
                    <IconButton
                      aria-label={`Remove ${header.name || 'header'}`}
                      onPress={() => removeHeader(header.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Request</SectionLabel>
        <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-52">
              <Field label="Operation">
                <Select
                  label="Operation"
                  value={operationId}
                  options={database.operations.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.label,
                  }))}
                  onChange={(value) => {
                    setOperationId(value);
                    setArgs(defaultsFor(databaseOperation(database, value)));
                  }}
                />
              </Field>
            </div>
            {(operation?.parameters ?? []).map((parameter) => (
              <div key={parameter.name} className="min-w-[9rem] flex-1">
                <Field label={parameter.label}>
                  {parameter.kind === 'select' && parameter.options ? (
                    <Select
                      label={parameter.label}
                      value={args[parameter.name] ?? ''}
                      options={[
                        { value: '', label: 'Any' },
                        ...parameter.options.map((option) => ({ value: option, label: option })),
                      ]}
                      onChange={(value) => setArgs((current) => ({ ...current, [parameter.name]: value }))}
                    />
                  ) : (
                    <Input
                      value={args[parameter.name] ?? ''}
                      onChange={(event) =>
                        setArgs((current) => ({ ...current, [parameter.name]: event.target.value }))
                      }
                      placeholder={parameter.required ? 'required' : String(parameter.default ?? '')}
                      aria-label={parameter.label}
                    />
                  )}
                </Field>
              </div>
            ))}
            <Button
              variant="primary"
              className="gap-1.5"
              isDisabled={running || !operation}
              onPress={() => void run()}
            >
              <Play className="size-3.5" />
              {running ? 'Running…' : 'Run'}
            </Button>
          </div>

          <span className="text-meta text-muted">
            {operation ? `${operation.method} · ${operation.label}` : 'No operations defined.'}
          </span>
          <span className="truncate text-meta tabular-nums text-muted">{url}</span>
        </div>
      </section>

      <ResponsePanel result={result} />

      <FactGroup title="What it holds">
        <Fact icon={Layers} label="Family">
          {database.family}
        </Fact>
        <Fact icon={Hash} label="Records">
          {database.recordCount}
        </Fact>
        <Fact icon={Archive} label="Holds">
          {database.holds}
        </Fact>
        <Fact icon={RefreshCw} label="Updated">
          {database.updateCadence}
        </Fact>
        <Fact icon={Scale} label="Licence">
          {database.licence}
        </Fact>
        <Fact icon={Lock} label="Access">
          <span className="flex items-center gap-1.5">
            <DatabaseMark database={database} />
            {database.access} · {DATABASE_STATE[database.state].label}
          </span>
        </Fact>
        <Fact icon={ExternalLink} label="Documentation">
          <a
            href={database.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex w-fit items-center gap-1 text-link underline underline-offset-2"
          >
            Documentation
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Fact>
      </FactGroup>
    </RecordPage>
  );
}

/** A database's page; an unknown id gets the shared not-found state. */
export function DatabaseDetail({ databaseId }: { databaseId: string }) {
  const databases = useDatabases();
  const database = databases.find((candidate) => candidate.id === databaseId);
  if (!database) {
    return <RecordMissing what="database" back="library/databases" backLabel="Databases" />;
  }
  return <DatabaseDetailBody key={database.id} database={database} />;
}
