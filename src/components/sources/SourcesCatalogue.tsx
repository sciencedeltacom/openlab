/**
 * The sources catalogue.
 *
 * A source is a saved question against a database — one set of filters, and a preview of what
 * the first request returned. This lists them, says which database each reads, and opens the
 * page that creates another.
 */

import { Pencil, Plus, Search, Trash2 } from 'lucide-react';

import { Button, Chip, IconButton, Input, ScrollShadow, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import { useDatabases } from '@/hooks/useDatabases';
import { useSources, removeSource } from '@/hooks/useSources';

/** The filters of a source, as a one-line summary. */
function filterSummary(types: readonly string[], query: string, from?: number, to?: number): string {
  const parts: string[] = [];
  if (query.trim()) parts.push(`“${query.trim()}”`);
  if (types.length > 0) parts.push(types.join(', '));
  if (from || to) parts.push(`${from ?? '…'}–${to ?? '…'}`);
  return parts.join(' · ') || 'No filters';
}

export function SourcesCatalogue() {
  const { dispatch } = useApp();
  const sources = useSources();
  const databases = useDatabases();
  const databaseName = (id: string) =>
    databases.find((database) => database.id === id)?.name ?? 'Unknown database';

  return (
    <ScrollShadow className="h-full min-h-0">
      <div className="flex w-full flex-col gap-4 px-7 py-7">
        <div className="flex flex-wrap items-start gap-2">
          <p className="max-w-[80ch] text-body text-muted">
            A source is a saved question against a database: the filters are kept, not the records.
          </p>
          <Button
            variant="primary"
            className="ml-auto shrink-0 gap-1.5"
            onPress={() => dispatch({ type: 'route/go', route: 'library/sources/new' })}
          >
            <Plus className="size-3.5" />
            Create source
          </Button>
        </div>

        {sources.length === 0 ? (
          <div className="grid place-items-center rounded-3xl bg-surface px-6 py-16 text-center">
            <div>
              <Search className="mx-auto size-5 text-muted" aria-hidden />
              <p className="mt-2 text-body text-muted">No sources yet. Create one from a database.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {sources.map((source) => (
              <section key={source.id} className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <button
                      type="button"
                      className="truncate text-start text-body text-foreground hover:underline"
                      onClick={() => dispatch({ type: 'route/go', route: paths.source(source.id) })}
                    >
                      {source.name}
                    </button>
                    <span className="truncate text-meta text-muted">{databaseName(source.databaseId)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton
                      aria-label={`Edit ${source.name}`}
                      onPress={() => dispatch({ type: 'route/go', route: paths.sourceEdit(source.id) })}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton aria-label={`Remove ${source.name}`} onPress={() => removeSource(source.id)}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
                <p className="text-meta text-muted">
                  {filterSummary(
                    source.filters.types,
                    source.filters.query,
                    source.filters.yearFrom,
                    source.filters.yearTo,
                  )}
                </p>
                <div className="mt-auto flex flex-wrap gap-1.5">
                  <Chip size="sm" variant="soft" color="default">
                    {source.filters.limit} max
                  </Chip>
                  <Chip size="sm" variant="soft" color="accent">
                    {source.preview.length} previewed
                  </Chip>
                </div>
                {source.preview.slice(0, 3).map((record) => (
                  <div key={record.id} className={cn('truncate text-meta text-muted')}>
                    {record.title}
                    {record.year ? ` · ${record.year}` : ''}
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </ScrollShadow>
  );
}
