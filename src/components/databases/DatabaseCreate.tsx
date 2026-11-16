/**
 * Create a database.
 *
 * A database is a connection: where it lives, how it authenticates, and the requests that make
 * sense against it. Writing that by hand from an API's documentation is the boring part, so the
 * page does it for you — paste the docs link, pick the model that should read it, and press
 * Generate; the model returns the endpoint, the auth and the routes as a definition you can
 * check and adjust before adding.
 *
 * It is a page, not a modal: there is more to say than a dialog wants to hold, and a definition
 * being built deserves the room.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Cloud, Sparkles, Wand2 } from 'lucide-react';

import { Button, Input, ScrollShadow, SectionLabel, Select, TextArea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { invokeCommand } from '@/lib/ipc';
import { askOnce, firstJsonObject } from '@/lib/ai/oneshot';
import { useApp } from '@/store/app';
import { allProviders } from '@/store/types';
import { addDatabase } from './store';
import {
  DATABASE_MARKS,
  AUTHORIZATION_LABEL,
  type Database,
  type DatabaseAuthorization,
  type Operation,
} from './data';

/** The model's answer, as the generator asks for it. */
interface GeneratedApi {
  endpoint?: string;
  authorization?: string;
  operations?: unknown[];
  methods?: string[];
  headers?: { name: string; value: string }[];
  holds?: string;
  recordCount?: string;
  licence?: string;
  updateCadence?: string;
  purpose?: string;
}

/** What a hand-made database starts from: one search, one record lookup. */
const DEFAULT_OPERATIONS = JSON.stringify(
  [
    {
      id: 'find',
      label: 'Search',
      method: 'GET',
      path: '/',
      parameters: [{ name: 'query', label: 'Search', kind: 'text', in: 'query' }],
    },
  ],
  null,
  2,
);

/** How many characters of a docs page are sent to the model. Enough to see the routes. */
const DOCS_LIMIT = 24_000;

const SYSTEM = [
  'You are an API integration assistant for a research workbench.',
  'Given a database name, a documentation URL and the text of its documentation, describe how to',
  'query it. Answer with a single JSON object and nothing else, using exactly these keys:',
  '{ "endpoint": base URL string, "authorization": "none" | "api-key" | "bearer",',
  '  "operations": array of the requests the API understands, each',
  '    { "id": "find", "label": short label, "method": "GET" | "POST", "path": path template,',
  '      "parameters": [ { "name": semantic name, "label", "kind": "text" | "number" | "select",',
  '        "in": "query" | "path" | "body", "param": the API name when it differs, "default" } ] }.',
  '    Give a "find" operation for a search and a "fetch" one for a single record by id,',
  '  "headers": array of {name, value} the API expects by default,',
  '  "holds": one sentence on what the API holds, "recordCount": a short count phrase,',
  '  "licence": the licence if stated else "Unknown", "updateCadence": how often it updates,',
  '  "purpose": one sentence on what the database is for }.',
  'If something is not in the documentation, give your best, concise answer rather than null.',
].join('\n');

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

export function DatabaseCreate() {
  const { state, dispatch } = useApp();
  const leave = () => dispatch({ type: 'route/go', route: 'library/databases' });

  const [name, setName] = useState('');
  const [family, setFamily] = useState('Scholarly');
  const [mark, setMark] = useState('book');
  const [purpose, setPurpose] = useState('');
  const [docsUrl, setDocsUrl] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [authorization, setAuthorization] = useState<DatabaseAuthorization>('none');
  const [operationsText, setOperationsText] = useState(DEFAULT_OPERATIONS);
  const [holds, setHolds] = useState('');
  const [recordCount, setRecordCount] = useState('');
  const [licence, setLicence] = useState('');
  const [updateCadence, setUpdateCadence] = useState('');
  const [modelRef, setModelRef] = useState(state.modelRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The operations text as the record expects it; a bad edit falls back to the default. */
  const parsedOperations = (): Operation[] => {
    try {
      const parsed = JSON.parse(operationsText) as unknown;
      return Array.isArray(parsed) && parsed.length > 0
        ? (parsed as Operation[])
        : (JSON.parse(DEFAULT_OPERATIONS) as Operation[]);
    } catch {
      return JSON.parse(DEFAULT_OPERATIONS) as Operation[];
    }
  };

  const modelOptions = useMemo(
    () =>
      allProviders(state).flatMap((provider) =>
        provider.models.map((model) => ({
          value: `${provider.id}/${model.id}`,
          label: `${provider.label} · ${model.id}`,
        })),
      ),
    [state],
  );

  const accessFor = (auth: DatabaseAuthorization): string =>
    auth === 'none' ? 'Open' : auth === 'api-key' ? 'API key' : 'Bearer token';

  /** Read the docs and let the chosen model turn them into a definition. */
  const generate = async () => {
    if (!docsUrl.trim()) {
      setError('Paste the API documentation URL first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fetched = await invokeCommand<string>('fetch_url', { url: docsUrl.trim() });
      if (!fetched.ok) {
        throw new Error(fetched.error.message);
      }
      const docs = fetched.value.slice(0, DOCS_LIMIT);
      const answer = await askOnce(
        { ...state, modelRef },
        `Database: ${name.trim() || 'unnamed'}\nDocs URL: ${docsUrl.trim()}\n\nDocumentation:\n${docs}`,
        { system: SYSTEM },
      );
      const spec = firstJsonObject<GeneratedApi>(answer);
      if (!spec) {
        throw new Error('The model did not return a usable definition. Try again, or fill it in by hand.');
      }
      if (typeof spec.endpoint === 'string') setEndpoint(spec.endpoint);
      if (
        spec.authorization === 'none' ||
        spec.authorization === 'api-key' ||
        spec.authorization === 'bearer'
      ) {
        setAuthorization(spec.authorization);
      }
      if (Array.isArray(spec.operations) && spec.operations.length > 0) {
        setOperationsText(JSON.stringify(spec.operations, null, 2));
      }
      if (typeof spec.holds === 'string') setHolds(spec.holds);
      if (typeof spec.recordCount === 'string') setRecordCount(spec.recordCount);
      if (typeof spec.licence === 'string') setLicence(spec.licence);
      if (typeof spec.updateCadence === 'string') setUpdateCadence(spec.updateCadence);
      if (typeof spec.purpose === 'string') setPurpose(spec.purpose);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** A ready-made definition for a database everyone reaches for. */
  const addOpenAlex = () => {
    setName('OpenAlex');
    setFamily('Scholarly');
    setMark('book');
    setPurpose('An open index of scholarly works, authors, institutions and citations.');
    setDocsUrl('https://docs.openalex.org/');
    setEndpoint('https://api.openalex.org');
    setAuthorization('none');
    setOperationsText(
      JSON.stringify(
        [
          {
            id: 'find',
            label: 'Search works',
            method: 'GET',
            path: '/works',
            parameters: [
              { name: 'query', label: 'Search', kind: 'text', in: 'query', param: 'search' },
              {
                name: 'limit',
                label: 'Per page',
                kind: 'number',
                in: 'query',
                param: 'per-page',
                default: 25,
              },
              { name: 'page', label: 'Page', kind: 'number', in: 'query', param: 'page', default: 1 },
            ],
          },
        ],
        null,
        2,
      ),
    );
    setHolds('Works, authors, sources, institutions and citations.');
    setRecordCount('250M+ works');
    setLicence('CC0');
    setUpdateCadence('Updated daily');
  };

  const add = () => {
    const cleanName = name.trim();
    if (!cleanName || !endpoint.trim()) {
      setError('A name and an endpoint are required.');
      return;
    }
    const database: Database = {
      id: `db-${cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}-${Date.now().toString(36).slice(-4)}`,
      name: cleanName,
      family: family.trim() || 'Other',
      mark,
      purpose: purpose.trim() || 'A database added to the workbench.',
      recordCount: recordCount.trim() || '—',
      access: accessFor(authorization),
      state: authorization === 'none' ? 'connected' : 'needs-key',
      authorization,
      endpoint: endpoint.trim().replace(/\/$/, ''),
      operations: parsedOperations(),
      defaultHeaders: [{ name: 'Accept', value: 'application/json' }],
      holds: holds.trim() || 'Not described yet.',
      updateCadence: updateCadence.trim() || 'Unknown',
      licence: licence.trim() || 'Unknown',
      docsUrl: docsUrl.trim(),
      sample: { kind: 'text', text: 'No sample yet. Run a request to see the response.' },
    };
    addDatabase(database);
    dispatch({ type: 'route/go', route: `library/databases/${database.id}` });
  };

  return (
    <ScrollShadow className="h-full">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-7 py-7">
        <header className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="w-fit gap-1.5" onPress={leave}>
            <ArrowLeft className="size-3.5" />
            Databases
          </Button>
          <h1 className="text-[1.5rem] font-semibold text-foreground">Create a database</h1>
          <p className="max-w-[70ch] text-body text-muted">
            Describe the API, or paste its documentation and let the model read it.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>Generated from documentation</SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
            <Field label="API documentation URL" hint="The model reads this page to find the endpoints.">
              <Input
                value={docsUrl}
                onChange={(event) => setDocsUrl((event.target as HTMLInputElement).value)}
                placeholder="https://docs.example.org/"
              />
            </Field>
            <Field label="AI model">
              <Select
                value={modelRef}
                options={modelOptions}
                onChange={setModelRef}
                placeholder="Choose a model"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" className="gap-1.5" isDisabled={busy} onPress={() => void generate()}>
              <Wand2 className="size-3.5" />
              {busy ? 'Reading the docs…' : 'Generate definition'}
            </Button>
            <Button variant="secondary" className="gap-1.5" isDisabled={busy} onPress={addOpenAlex}>
              <Sparkles className="size-3.5" />
              Use OpenAlex template
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>Definition</SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName((event.target as HTMLInputElement).value)}
                placeholder="OpenAlex"
              />
            </Field>
            <Field label="Family">
              <Input
                value={family}
                onChange={(event) => setFamily((event.target as HTMLInputElement).value)}
                placeholder="Scholarly"
              />
            </Field>
          </div>

          <Field label="Purpose">
            <TextArea
              rows={2}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="One sentence on what the database is for."
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <Field label="Endpoint">
              <Input
                value={endpoint}
                onChange={(event) => setEndpoint((event.target as HTMLInputElement).value)}
                placeholder="https://api.example.org"
              />
            </Field>
            <Field label="Authorization">
              <Select
                value={authorization}
                options={(Object.keys(AUTHORIZATION_LABEL) as DatabaseAuthorization[]).map((value) => ({
                  value,
                  label: AUTHORIZATION_LABEL[value],
                }))}
                onChange={(value) => setAuthorization(value as DatabaseAuthorization)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Mark">
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(DATABASE_MARKS).map((key) => {
                  const Icon = DATABASE_MARKS[key].icon;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={key}
                      aria-pressed={key === mark}
                      onClick={() => setMark(key)}
                      className={cn(
                        'grid size-8 place-items-center rounded-lg transition-colors',
                        key === mark
                          ? 'bg-surface-secondary text-foreground ring-1 ring-border'
                          : 'text-muted hover:bg-surface-secondary',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>

          <Field
            label="Operations"
            hint="The requests this API understands: a `find` for a search and a `fetch` for one record by id."
          >
            <TextArea
              rows={10}
              value={operationsText}
              onChange={(event) => setOperationsText((event.target as HTMLTextAreaElement).value)}
              aria-label="Operations"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Holds">
              <Input
                value={holds}
                onChange={(event) => setHolds((event.target as HTMLInputElement).value)}
                placeholder="What the API returns"
              />
            </Field>
            <Field label="Records">
              <Input
                value={recordCount}
                onChange={(event) => setRecordCount((event.target as HTMLInputElement).value)}
                placeholder="250M+ works"
              />
            </Field>
            <Field label="Licence">
              <Input
                value={licence}
                onChange={(event) => setLicence((event.target as HTMLInputElement).value)}
                placeholder="CC0"
              />
            </Field>
          </div>
        </section>

        {error && <p className="rounded-2xl bg-danger-soft p-3 text-body text-danger">{error}</p>}

        <footer className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-meta text-muted">
            <Cloud className="size-3.5" aria-hidden />
            Stored on this machine.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onPress={leave}>
              Cancel
            </Button>
            <Button variant="primary" isDisabled={!name.trim() || !endpoint.trim()} onPress={add}>
              Add database
            </Button>
          </div>
        </footer>
      </div>
    </ScrollShadow>
  );
}
