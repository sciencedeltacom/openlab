/**
 * A review record, as a drawer.
 *
 * Clicking a record anywhere in the review — the sources list, a screening row, an extraction
 * cell, a citation in the report — slides this in from the right, the HeroUI way. It carries the
 * record's provenance: which database it came from, the DOI behind it, and the abstract the
 * screening judged it on.
 */

import type { ReactNode } from 'react';
import { ArrowUpRight, Quote } from 'lucide-react';

import { Drawer, ScrollShadow, SectionLabel } from '@/components/ui';
import { paperMeta, type Paper } from './data';

/** One labelled fact in the record's definition grid. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-meta text-muted">{label}</span>
      <span
        className="text-body leading-snug text-foreground"
        title={typeof children === 'string' ? children : undefined}
      >
        {children}
      </span>
    </div>
  );
}

/** A link that reads as a quiet pill button. */
function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3.5 py-1.5 text-body font-medium text-foreground transition-colors hover:bg-surface-tertiary"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </a>
  );
}

/** The record's body: what it is, where it came from, and what it says. */
function RecordBody({ paper }: { paper: Paper }) {
  const meta = paperMeta(paper.id);
  const authors = paper.authors;
  const doiId = paper.doi ? paper.doi.replace(/^https?:\/\/doi\.org\//i, '') : undefined;
  const doiUrl = paper.doi
    ? paper.doi.startsWith('http')
      ? paper.doi
      : `https://doi.org/${paper.doi}`
    : meta?.url;

  return (
    <ScrollShadow className="flex min-h-0 flex-1 flex-col gap-6 px-5 pb-8">
      <h2 className="text-[1.25rem] leading-snug font-semibold tracking-[-0.01em] text-foreground">
        {paper.title}
      </h2>

      {authors.length > 0 && (
        <p className="-mt-3 text-body leading-relaxed text-muted">
          {authors.slice(0, 8).join(', ')}
          {authors.length > 8 ? ' et al.' : ''}
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-t border-separator pt-5">
        <Fact label="Year">{paper.year}</Fact>
        <Fact label="Venue">{paper.venue || <span className="text-muted">—</span>}</Fact>
        {typeof meta?.citations === 'number' && (
          <Fact label="Citations">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Quote className="size-3.5 text-muted" aria-hidden />
              {meta.citations.toLocaleString()}
            </span>
          </Fact>
        )}
        {meta?.source && <Fact label="Source">{meta.source}</Fact>}
        {doiId && (
          <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
            <span className="text-meta text-muted">DOI</span>
            <span className="truncate text-body text-foreground" title={doiId}>
              {doiId}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {doiUrl && <LinkButton href={doiUrl}>View</LinkButton>}
        {meta?.pdf && (
          <LinkButton href={meta.pdf}>
            {/* The label is a word, the mark is the same, so the two read as a pair. */}
            View PDF
          </LinkButton>
        )}
      </div>

      {paper.abstract && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Abstract</SectionLabel>
          <p className="text-body leading-[1.7] text-foreground/90">{paper.abstract}</p>
        </section>
      )}

      {meta?.rationale && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Screening note</SectionLabel>
          <p className="text-body leading-[1.7] text-foreground/90">{meta.rationale}</p>
        </section>
      )}
    </ScrollShadow>
  );
}

/** The drawer itself; nothing renders when no record is open. */
export function PaperIsland({ paper, onClose }: { paper: Paper | undefined; onClose: () => void }) {
  return (
    <Drawer isOpen={paper !== undefined} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-[440px] max-w-[94vw]">
            <Drawer.Header className="justify-end">
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 pt-1">
              {paper ? <RecordBody paper={paper} /> : null}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
