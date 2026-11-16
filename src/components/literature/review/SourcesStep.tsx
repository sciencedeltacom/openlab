/**
 * The Sources step.
 *
 * The question is fixed here, and everything below it is the search that answers it: which
 * service to look in, a filter over title, author and venue, and the records that come back.
 * A source row is the same record the screening table judges, so a citation can be opened and
 * checked before it is screened.
 */

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Database, FileText, Link2, Quote, Search, Users } from 'lucide-react';

import { Chip, Input, ScrollShadow, Select, ToggleButton, ToggleButtonGroup } from '@/components/ui';
import { MOTION } from '@/theme/tokens';
import { SOURCES, paperMeta, type Paper, type Review } from '../data';
import { StepFrame, StepPanel, FieldLabel } from './shell';
import { FullTextPanel } from './FullTextPanel';

/** One retrieved record: what it is, what it reports, and where it came from. */
function SourceRow({ paper, index, onOpen }: { paper: Paper; index: number; onOpen: () => void }) {
  const meta = paperMeta(paper.id);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: MOTION.duration.panel,
        ease: MOTION.signature,
        delay: Math.min(index, 12) * 0.02,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-2 rounded-2xl bg-surface p-4 text-left transition-colors hover:bg-surface-tertiary"
      >
        <span className="line-clamp-2 text-body font-medium text-foreground">{paper.title}</span>
        <span className="text-meta text-muted">
          {paper.authors.join(', ')} · {paper.venue} · {paper.year}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {meta && (
            <span className="inline-flex items-center gap-1 text-meta text-muted">
              <Database className="size-3.5 shrink-0" aria-hidden />
              {meta.database ?? meta.source}
            </span>
          )}
          {typeof meta?.citations === 'number' && (
            <span className="inline-flex items-center gap-1 text-meta tabular-nums text-muted">
              <Quote className="size-3.5 shrink-0" aria-hidden />
              {meta.citations.toLocaleString()} citations
            </span>
          )}
          {paper.doi ? (
            <Chip size="sm" variant="soft">
              <Link2 className="size-3 shrink-0" aria-hidden />
              {paper.doi}
            </Chip>
          ) : (
            <span className="inline-flex items-center gap-1 text-meta text-muted">
              <FileText className="size-3.5 shrink-0" aria-hidden />
              No DOI
            </span>
          )}
        </span>
      </button>
    </motion.div>
  );
}

/** The Sources step: the question, the search controls, and the records that answered them. */
export function SourcesStep({
  review,
  papers,
  onOpenPaper,
}: {
  review: Review;
  papers: Paper[];
  onOpenPaper: (paperId: string) => void;
}) {
  const [source, setSource] = useState<string>('all');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const results = useMemo(
    () =>
      papers.filter((paper) => {
        if (source !== 'all' && paperMeta(paper.id)?.source !== source) return false;
        if (!needle) return true;
        return [paper.title, ...paper.authors, paper.venue, String(paper.year)]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      }),
    [papers, source, needle],
  );

  const sourceOptions = [
    { value: 'all', label: 'All sources' },
    ...SOURCES.map((name) => ({ value: name, label: name })),
  ];

  const controls = (
    <>
      <div className="relative flex w-full items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title or author"
          aria-label="Search records"
          className="w-full pl-9"
        />
      </div>
      <Select value={source} options={sourceOptions} onChange={setSource} label="Source" className="w-full" />
      <span className="text-meta tabular-nums text-muted">
        {results.length} of {papers.length} records
      </span>
    </>
  );

  return (
    <StepFrame
      aside={
        <>
          <StepPanel title="Find">{controls}</StepPanel>
          <StepPanel title="Protocol">
            {review.protocol.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-0.5">
                <span className="text-meta text-muted">{fact.label}</span>
                <span className="text-body text-foreground">{fact.value}</span>
              </div>
            ))}
          </StepPanel>
          <StepPanel title="Search">
            <div className="flex items-center justify-between text-body text-foreground">
              <span className="inline-flex items-center gap-1.5 text-muted">
                <Users className="size-3.5" aria-hidden />
                Retrieved
              </span>
              <span className="tabular-nums">{review.total}</span>
            </div>
            <div className="flex items-center justify-between text-body text-foreground">
              <span className="inline-flex items-center gap-1.5 text-muted">
                <FileText className="size-3.5" aria-hidden />
                In workspace
              </span>
              <span className="tabular-nums">{papers.length}</span>
            </div>
          </StepPanel>
        </>
      }
    >
      {papers.length === 0 ? (
        <div className="flex w-full flex-col items-start gap-2 rounded-3xl bg-surface p-6">
          <p className="text-body text-foreground">No records have been added to this review yet.</p>
        </div>
      ) : results.length === 0 ? (
        <ScrollShadow className="rounded-3xl bg-surface">
          <p className="p-6 text-body text-muted">No record matches the current filters.</p>
        </ScrollShadow>
      ) : (
        <div className="flex flex-col gap-2">
          {results.map((paper, index) => (
            <SourceRow key={paper.id} paper={paper} index={index} onOpen={() => onOpenPaper(paper.id)} />
          ))}
        </div>
      )}

      <FullTextPanel papers={papers} />
    </StepFrame>
  );
}
