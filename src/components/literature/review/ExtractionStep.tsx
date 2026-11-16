/**
 * The Extraction step, in its two passes.
 *
 * The pilot rehearses the columns: every included record is read into the same fields, and each
 * value shows whether a supporting sentence has been captured. The full pass is that work at
 * scale; the columns do not change, but the top row turns from a description of the columns into
 * the status of the extraction — how many values are in and how many still need their quote.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { MessageSquareQuote, Search, TriangleAlert } from 'lucide-react';

import { IconButton, Input, Popover, SectionLabel, ToggleButton, ToggleButtonGroup } from '@/components/ui';
import { cn } from '@/lib/cn';
import { EXTRACTION_FIELDS, type Extraction, type Paper } from '../data';
import { StepFrame, tableMinWidth } from './shell';

const EXTRACTION_TEMPLATE = ['minmax(16rem,1fr)', ...EXTRACTION_FIELDS.map(() => '12rem')].join(' ');

/** One extracted value and the sentence behind it, or a quiet note that there is none. */
function ExtractionCell({ label, cell }: { label: string; cell: Extraction }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-meta text-foreground">{cell.value}</span>
      {cell.quote ? (
        <Popover
          className="w-[320px]"
          trigger={
            <IconButton aria-label={`Show the supporting quote for ${label}`}>
              <MessageSquareQuote className="size-3.5" aria-hidden />
            </IconButton>
          }
        >
          <div className="flex flex-col gap-2 p-1">
            <SectionLabel>Supporting quote</SectionLabel>
            <blockquote className="text-body text-foreground">“{cell.quote.text}”</blockquote>
            <span className="text-meta text-muted">{cell.quote.citation}</span>
          </div>
        </Popover>
      ) : (
        <span className="flex items-center gap-1 text-meta text-muted">
          <TriangleAlert className="size-3" aria-hidden />
          Needs a quote
        </span>
      )}
    </div>
  );
}

/** A paper's title, authors and venue as the table's first column; clicking it opens the record. */
function PaperCell({ paper, onOpen }: { paper: Paper; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="sticky left-0 z-10 flex min-w-0 flex-col gap-1 bg-surface pr-4 text-left group-hover:bg-surface-secondary"
    >
      <span className="line-clamp-2 text-body font-medium text-foreground">{paper.title}</span>
      <span className="truncate text-meta text-muted">{paper.authors.join(', ')}</span>
      <span className="text-meta tabular-nums text-muted">
        {paper.venue} · {paper.year}
      </span>
    </button>
  );
}

/** The extraction table itself: one column per field, each cell carrying its value and quote mark. */
function ExtractionTable({ rows, onOpenPaper }: { rows: Paper[]; onOpenPaper: (paperId: string) => void }) {
  const min = tableMinWidth(EXTRACTION_TEMPLATE);
  return (
    <div className="w-full overflow-x-auto rounded-3xl bg-surface">
      <div
        className="grid items-center gap-x-4 bg-surface-tertiary px-3 py-2"
        style={{ gridTemplateColumns: EXTRACTION_TEMPLATE, minWidth: min, width: '100%' }}
      >
        <div className="sticky left-0 z-10 bg-surface-tertiary section-label">Paper</div>
        {EXTRACTION_FIELDS.map((field) => (
          <div key={field.key} className="section-label">
            {field.label}
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-body text-muted">Nothing matches the current filters.</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((paper) => (
            <div
              key={paper.id}
              className="group grid items-start gap-x-4 px-3 py-2.5 transition-colors hover:bg-surface-secondary"
              style={{ gridTemplateColumns: EXTRACTION_TEMPLATE, minWidth: min, width: '100%' }}
            >
              <PaperCell paper={paper} onOpen={() => onOpenPaper(paper.id)} />
              {EXTRACTION_FIELDS.map((field) => (
                <ExtractionCell key={field.key} label={field.label} cell={paper.extraction[field.key]} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the extraction reports: how many of its cells have a supporting sentence. */
export function extractionStatus(papers: Paper[]): {
  cells: number;
  quoted: number;
  missing: number;
  fields: { label: string; quoted: number; total: number }[];
} {
  const fields = EXTRACTION_FIELDS.map((field) => ({
    label: field.label,
    quoted: papers.filter((paper) => Boolean(paper.extraction[field.key].quote)).length,
    total: papers.length,
  }));
  const cells = papers.length * EXTRACTION_FIELDS.length;
  const quoted = fields.reduce((sum, field) => sum + field.quoted, 0);
  return { cells, quoted, missing: cells - quoted, fields };
}

/** The Extraction step: the pilot pass or the full pass, over the review's records. */
export function ExtractionStep({
  papers,
  mode,
  reason,
  onOpenPaper,
}: {
  papers: Paper[];
  mode: 'pilot' | 'full';
  reason?: string;
  onOpenPaper: (paperId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [field, setField] = useState<string>('all');
  const needle = query.trim().toLowerCase();

  const rows = useMemo(
    () =>
      papers.filter((paper) => {
        if (
          mode === 'full' &&
          field !== 'all' &&
          !paper.extraction[field as keyof Paper['extraction']]?.quote
        ) {
          return false;
        }
        if (!needle) return true;
        return [paper.title, ...paper.authors].join(' ').toLowerCase().includes(needle);
      }),
    [needle, field, mode, papers],
  );

  const status = extractionStatus(rows);

  const controls = (
    <>
      <div className="relative flex w-full min-w-[220px] max-w-sm items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title or author"
          aria-label="Search papers"
          className="w-full pl-9"
        />
      </div>

      {mode === 'full' ? (
        <ToggleButtonGroup
          aria-label="Field"
          selectionMode="single"
          selectedKeys={[field]}
          onSelectionChange={(keys) => {
            const [first] = keys as Set<string>;
            if (first) setField(first);
          }}
        >
          <ToggleButton id="all">All</ToggleButton>
          {EXTRACTION_FIELDS.map((item) => (
            <ToggleButton key={item.key} id={item.key}>
              {item.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          <SectionLabel>Columns</SectionLabel>
          {EXTRACTION_FIELDS.map((item) => (
            <span
              key={item.key}
              className="rounded-full bg-surface-secondary px-2 py-0.5 text-meta text-muted"
            >
              {item.label}
            </span>
          ))}
        </span>
      )}

      <span className="text-meta tabular-nums text-muted">
        {rows.length} of {papers.length} records
      </span>

      {mode === 'full' && (
        <span className="ml-auto flex items-center gap-3 text-meta tabular-nums text-muted">
          <span className="text-success">{status.quoted} with a quote</span>
          <span className={cn(status.missing > 0 ? 'text-warning' : 'text-muted')}>
            {status.missing} need one
          </span>
        </span>
      )}
    </>
  );

  if (papers.length === 0) {
    return (
      <StepFrame>
        <div className="flex w-full flex-col items-start gap-2 rounded-3xl bg-surface p-6">
          <p className="text-body text-foreground">Nothing to extract.</p>
          <p className="text-body text-muted">
            {reason ?? 'Screen the sources first; the included records are what gets extracted.'}
          </p>
        </div>
      </StepFrame>
    );
  }

  return (
    <StepFrame toolbar={controls}>
      <ExtractionTable rows={rows} onOpenPaper={onOpenPaper} />
    </StepFrame>
  );
}
