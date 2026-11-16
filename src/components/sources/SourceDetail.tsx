/**
 * One saved source.
 *
 * A source is a saved question against a database: the filters are kept, the records are not.
 * This is the page behind the palette's result and the catalogue's title, and it shows the
 * question, where it runs, and the first page it returned — the same preview the creation flow
 * showed.
 */

import { ExternalLink, Pencil, Trash2 } from 'lucide-react';

import { Button, Chip, IconButton, SectionLabel } from '@/components/ui';
import { Fact, FactGroup, RecordMissing, RecordPage } from '@/components/research/PageShell';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import { useDatabases } from '@/hooks/useDatabases';
import {
  findSource,
  removeSource,
  useSources,
  type SourceFilters,
  type SourceRecord,
} from '@/hooks/useSources';

/** The filters as chips, in the words of the form that set them. */
function FilterChips({ filters }: { filters: SourceFilters }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {filters.query.trim() && <Chip size="sm">{filters.query.trim()}</Chip>}
      {filters.types.map((type) => (
        <Chip key={type} size="sm">
          {type}
        </Chip>
      ))}
      {(filters.yearFrom || filters.yearTo) && (
        <Chip size="sm">
          {filters.yearFrom ?? '…'}–{filters.yearTo ?? '…'}
        </Chip>
      )}
      <Chip size="sm">{filters.limit} records</Chip>
    </span>
  );
}

/** One previewed record. */
function RecordRow({ record }: { record: SourceRecord }) {
  const target = record.doi ? `https://doi.org/${record.doi}` : record.url;
  return (
    <li className="flex flex-col gap-1 border-t border-separator py-2 first:border-t-0">
      <span className="text-body text-foreground">{record.title}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted">
        {record.year && <span>{record.year}</span>}
        {record.venue && <span>{record.venue}</span>}
        {record.authors && record.authors.length > 0 && (
          <span>
            {record.authors.slice(0, 3).join(', ')}
            {record.authors.length > 3 ? ' et al.' : ''}
          </span>
        )}
        {target && (
          <a
            href={target}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent"
          >
            Open <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </span>
    </li>
  );
}

/** The page. */
export function SourceDetail({ sourceId }: { sourceId: string }) {
  const { dispatch } = useApp();
  const sources = useSources();
  const databases = useDatabases();
  const source = sources.find((candidate) => candidate.id === sourceId) ?? findSource(sourceId);

  if (!source) {
    return <RecordMissing what="source" back="library/sources" backLabel="Sources" />;
  }

  const database = databases.find((candidate) => candidate.id === source.databaseId);

  return (
    <RecordPage
      eyebrow={<SectionLabel>Source</SectionLabel>}
      title={source.name}
      lede={
        <p className="max-w-[70ch] text-body text-muted">
          A saved question against {database?.name ?? source.databaseId}. Records are read from the database
          when the source is used.
        </p>
      }
      status={
        <>
          <Chip size="sm">{database?.name ?? source.databaseId}</Chip>
          <Chip size="sm">{source.preview.length} previewed</Chip>
        </>
      }
      aside={
        <>
          <FactGroup title="Source">
            <Fact label="Database">{database?.name ?? source.databaseId}</Fact>
            <Fact label="Created">{new Date(source.createdAt).toLocaleDateString()}</Fact>
            <Fact label="Limit">{`${source.filters.limit} records`}</Fact>
            <Fact label="ID">
              <span className="font-mono text-meta">{source.id}</span>
            </Fact>
          </FactGroup>
          <FactGroup title="Actions">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onPress={() => dispatch({ type: 'route/go', route: paths.sourceEdit(source.id) })}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="gap-1.5"
                onPress={() => {
                  removeSource(source.id);
                  dispatch({ type: 'route/go', route: 'library/sources' });
                }}
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            </div>
          </FactGroup>
        </>
      }
    >
      <section className="flex flex-col gap-3">
        <SectionLabel>The question</SectionLabel>
        <FilterChips filters={source.filters} />
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Preview</SectionLabel>
        {source.preview.length === 0 ? (
          <p className="rounded-2xl bg-surface p-4 text-body text-muted">
            No records were previewed. Edit the source and run its preview to fill this in.
          </p>
        ) : (
          <ul className="rounded-2xl bg-surface px-4 py-2">
            {source.preview.map((record) => (
              <RecordRow key={record.id} record={record} />
            ))}
          </ul>
        )}
      </section>
    </RecordPage>
  );
}
