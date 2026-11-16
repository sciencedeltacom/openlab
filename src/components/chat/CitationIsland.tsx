/**
 * The cited source, as an island.
 *
 * A `record:<id>` chip in the transcript opens this. It is a fixed panel on the right, not a
 * child of the transcript, so it is never clipped by the scroll shadow and never scrolls
 * away with the message that cited it. It arrives on a spring, the way a sheet does on
 * Apple platforms, and leaves the same way.
 */

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ExternalLink, X } from 'lucide-react';

import { Chip, IconButton, ScrollShadow } from '@/components/ui';
import { useApp } from '@/store/app';
import type { ScienceRecord } from '@/lib/science/connectors';

/** One labelled line in the record's facts. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta text-muted">{label}</span>
      <span className="text-body text-foreground">{children}</span>
    </div>
  );
}

/** The body: what the source is, who wrote it, and where to read it. */
function RecordBody({ record }: { record: ScienceRecord }) {
  const extras = Object.entries(record.extra ?? {});
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip size="sm" variant="soft" color="accent" className="text-meta">
          {record.source}
        </Chip>
        <Chip size="sm" variant="soft" className="text-meta">
          {record.kind}
        </Chip>
      </div>

      <h2 className="text-title leading-snug text-foreground">{record.title}</h2>

      {record.authors.length > 0 && (
        <p className="text-meta text-muted">
          {record.authors.slice(0, 6).join(', ')}
          {record.authors.length > 6 ? ' et al.' : ''}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {record.year && <Fact label="Year">{record.year}</Fact>}
        {record.venue && <Fact label="Venue">{record.venue}</Fact>}
        {record.doi && <Fact label="DOI">{record.doi}</Fact>}
        <Fact label="Id">{record.id}</Fact>
      </div>

      {extras.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {extras.slice(0, 8).map(([key, value]) => (
            <Fact key={key} label={key}>
              {String(value)}
            </Fact>
          ))}
        </div>
      )}

      {record.abstract && (
        <div className="flex flex-col gap-1">
          <span className="text-meta text-muted">Abstract</span>
          <p className="text-body leading-relaxed text-foreground/90">{record.abstract}</p>
        </div>
      )}

      {record.url && (
        <a
          href={record.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-body text-link underline underline-offset-2"
        >
          Open the source
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </div>
  );
}

/** The island itself. */
export function CitationIsland() {
  const { state, dispatch } = useApp();
  const record = state.citationId
    ? state.records.find((candidate) => candidate.id === state.citationId)
    : undefined;

  return (
    <AnimatePresence>
      {state.citationId && (
        <motion.aside
          key="citation"
          initial={{ opacity: 0, x: 32, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 32, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.8 }}
          style={{ top: 'calc(var(--titlebar-h) + 4.25rem)' }}
          className="fixed end-4 z-50 flex max-h-[72vh] w-[380px] max-w-[92vw] flex-col overflow-hidden rounded-3xl bg-overlay shadow-[var(--island-shadow)]"
        >
          <header className="flex shrink-0 items-center gap-2 px-4 py-3">
            <span className="text-label text-muted">Cited source</span>
            <div className="ml-auto">
              <IconButton aria-label="Close" onPress={() => dispatch({ type: 'citation/close' })}>
                <X className="size-4" />
              </IconButton>
            </div>
          </header>
          <ScrollShadow className="min-h-0 flex-1">
            {record ? (
              <RecordBody record={record} />
            ) : (
              <p className="px-4 py-3.5 text-body text-muted">
                No record is stored for <span className="font-mono text-foreground">{state.citationId}</span>.
              </p>
            )}
          </ScrollShadow>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
