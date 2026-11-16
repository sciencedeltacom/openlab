/**
 * Create a source.
 *
 * Pick the database to read, then the question to ask it: a topic, the kinds of document, a year
 * range, and how many records to pull when the source is used. Preview runs that first request
 * so you can see the shape of the answer before saving; the filters are what is kept, and the
 * records are fetched from the database again whenever the source is used.
 */

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Eye, Save } from 'lucide-react';

import { Button, Input, NumberInput, ScrollShadow, SectionLabel, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import { useDatabases } from '@/hooks/useDatabases';
import {
  addSource,
  findSource,
  patchSource,
  previewSource,
  SOURCE_TYPES,
  type SourceFilters,
  type SourceRecord,
  type SourceType,
} from '@/hooks/useSources';

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

/**
 * Create or edit a source.
 *
 * The same page does both: with no `sourceId` it starts from the defaults, and with one it
 * starts from the saved source and writes back to it. A source is a question, so editing it
 * is editing the question — the database, the filters, the limit — not the records.
 */
export function SourceCreate({ sourceId }: { sourceId?: string } = {}) {
  const { dispatch } = useApp();
  const databases = useDatabases();
  const leave = () => dispatch({ type: 'route/go', route: 'library/sources' });

  const editing = sourceId ? findSource(sourceId) : undefined;

  const [name, setName] = useState(editing?.name ?? '');
  const [databaseId, setDatabaseId] = useState(editing?.databaseId ?? databases[0]?.id ?? '');
  const [query, setQuery] = useState(editing?.filters.query ?? '');
  const [types, setTypes] = useState<Set<SourceType>>(new Set(editing?.filters.types ?? ['article']));
  const [yearFrom, setYearFrom] = useState(editing?.filters.yearFrom ? String(editing.filters.yearFrom) : '');
  const [yearTo, setYearTo] = useState(editing?.filters.yearTo ? String(editing.filters.yearTo) : '');
  const [limit, setLimit] = useState(editing?.filters.limit ?? 25);
  const [preview, setPreview] = useState<SourceRecord[]>(editing?.preview ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filters = (): SourceFilters => ({
    query,
    types: [...types],
    ...(yearFrom ? { yearFrom: Number(yearFrom) } : {}),
    ...(yearTo ? { yearTo: Number(yearTo) } : {}),
    limit,
  });

  const toggleType = (type: SourceType) => {
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const runPreview = async () => {
    if (!databaseId) {
      setError('Create a database first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewSource(databaseId, filters()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!name.trim() || !databaseId) {
      setError('A name and a database are required.');
      return;
    }
    if (editing) {
      patchSource(editing.id, { name: name.trim(), databaseId, filters: filters(), preview });
      leave();
      return;
    }
    addSource({
      id: `src-${name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}-${Date.now().toString(36).slice(-4)}`,
      name: name.trim(),
      databaseId,
      filters: filters(),
      preview,
      createdAt: Date.now(),
    });
    leave();
  };

  if (sourceId && !editing) {
    return (
      <ScrollShadow className="h-full">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-7 py-7">
          <Button variant="ghost" size="sm" className="w-fit gap-1.5" onPress={leave}>
            <ArrowLeft className="size-3.5" />
            Sources
          </Button>
          <p className="text-body text-muted">This source no longer exists.</p>
        </div>
      </ScrollShadow>
    );
  }

  return (
    <ScrollShadow className="h-full">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-7 py-7">
        <header className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="w-fit gap-1.5" onPress={leave}>
            <ArrowLeft className="size-3.5" />
            Sources
          </Button>
          <h1 className="text-[1.5rem] font-semibold text-foreground">
            {editing ? 'Edit source' : 'Create a source'}
          </h1>
          <p className="max-w-[70ch] text-body text-muted">
            {editing
              ? 'Change the question this source asks (its database, its filters and its limit), then re-preview or save.'
              : 'A saved question against a database. The filters are kept; the records are fetched when the source is used.'}
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Off-target literature"
              />
            </Field>
            <Field
              label="Database"
              hint={databases.length === 0 ? 'No databases yet. Create one first.' : undefined}
            >
              <Select
                value={databaseId}
                options={databases.map((database) => ({ value: database.id, label: database.name }))}
                onChange={setDatabaseId}
                placeholder="Choose a database"
              />
            </Field>
          </div>

          <Field label="Topic or keywords">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="CRISPR off-target chromatin"
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Document types</span>
            <div className="flex flex-wrap gap-2">
              {SOURCE_TYPES.map((type) => {
                const on = types.has(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleType(type)}
                    className={cn(
                      'rounded-full px-3 py-1 text-body capitalize transition-colors',
                      on
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-surface-secondary text-muted hover:text-foreground',
                    )}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="From year">
              <NumberInput
                label="From year"
                min={1900}
                max={2100}
                value={yearFrom ? Number(yearFrom) : undefined}
                onChange={(next) => setYearFrom(next === undefined ? '' : String(next))}
                fullWidth
              />
            </Field>
            <Field label="To year">
              <NumberInput
                label="To year"
                min={1900}
                max={2100}
                value={yearTo ? Number(yearTo) : undefined}
                onChange={(next) => setYearTo(next === undefined ? '' : String(next))}
                fullWidth
              />
            </Field>
            <Field label="Fetch limit" hint="How many records to pull when used.">
              <NumberInput
                label="Fetch limit"
                min={1}
                max={200}
                value={limit}
                onChange={(next) => setLimit(Math.max(1, Math.min(200, next ?? 25)))}
                fullWidth
              />
            </Field>
          </div>

          <div className="flex justify-start">
            <Button
              variant="secondary"
              className="gap-1.5"
              isDisabled={busy || !databaseId}
              onPress={() => void runPreview()}
            >
              <Eye className="size-3.5" />
              {busy ? 'Requesting…' : 'Preview first results'}
            </Button>
          </div>
        </section>

        {error && <p className="rounded-2xl bg-danger-soft p-3 text-body text-danger">{error}</p>}

        {preview.length > 0 && (
          <section className="flex flex-col gap-2 rounded-3xl bg-surface p-5">
            <SectionLabel>Preview · first {preview.length} results</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {preview.map((record) => (
                <div key={record.id} className="flex min-w-0 flex-col">
                  <span className="truncate text-body text-foreground">{record.title}</span>
                  <span className="truncate text-meta text-muted">
                    {[record.year, record.venue].filter(Boolean).join(' · ') || record.id}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="flex items-center justify-end gap-2">
          <Button variant="ghost" onPress={leave}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="gap-1.5"
            isDisabled={!name.trim() || !databaseId}
            onPress={save}
          >
            <Save className="size-3.5" />
            {editing ? 'Save changes' : 'Save source'}
          </Button>
        </footer>
      </div>
    </ScrollShadow>
  );
}
