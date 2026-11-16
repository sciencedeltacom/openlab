/**
 * The Report step.
 *
 * The end of the review, and the point of it: the question as a heading, a summary, and the
 * written sections, with every claim carrying a marker back to the paper it came from. The panel
 * repeats the four work stops with their counts and links into them, so the report reads as the
 * output of the work rather than a document that appeared on its own.
 */

import { useState } from 'react';
import { Check, ChevronRight, FileDown, SendHorizontal } from 'lucide-react';

import { Button, Cell, CellGroup, IconButton, ScrollShadow, SectionLabel, TextArea } from '@/components/ui';
import { Markdown } from '@/components/chat/Markdown';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import {
  collectCitations,
  contentOf,
  findPaper,
  paperIdByKey,
  paperMeta,
  type Paper,
  type Review,
} from '../data';
import { extractionStatus } from './ExtractionStep';
import { StepFrame, StepPanel } from './shell';
import type { ReviewStepId } from './shell';

/** One message in the report's chat. */
interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * A paragraph of the report with its `[[paperId]]` markers turned into numbered citation links.
 *
 * The number is the paper's place in the citation list, so the same paper keeps one number
 * wherever it is cited.
 */
function ReportParagraph({
  text,
  citations,
  onOpen,
}: {
  text: string;
  citations: string[];
  onOpen: (paperId: string) => void;
}) {
  return (
    <p className="text-body leading-relaxed text-foreground/90">
      {text.split(/(\[\[[^\]]+\]\])/g).map((part, index) => {
        const match = /^\[\[([^\]]+)\]\]$/.exec(part);
        if (!match) {
          return <span key={index}>{part}</span>;
        }
        const paperId = match[1];
        const number = citations.indexOf(paperId) + 1;
        const paper = findPaper(paperId);
        return (
          <button
            key={index}
            type="button"
            title={paper ? paper.title : paperId}
            onClick={() => onOpen(paperId)}
            className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-md bg-accent-soft px-1 text-meta tabular-nums text-accent-soft-foreground align-baseline"
          >
            {number}
          </button>
        );
      })}
    </p>
  );
}

/** One status row: what the stop did, its count, and the way back into it. */
function StatusRow({ label, detail, onOpen }: { label: string; detail: string; onOpen: () => void }) {
  return (
    <Cell
      label={label}
      description={detail}
      onClick={onOpen}
      control={<ChevronRight className="size-4 text-muted" aria-hidden />}
    />
  );
}

/** The report's own chat: a question box and the answers it gives back. */
function ReportChat({
  review,
  evaluated,
  included,
  citations,
}: {
  review: Review;
  evaluated: number;
  included: number;
  citations: string[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Ask anything about the included records, the extraction, or a number in the report.',
    },
  ]);
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const first = citations[0];
    const source = first ? findPaper(first)?.title : undefined;
    const answer = `The review judged ${evaluated} of ${review.total} records and kept ${included}. The report's evidence rests on ${citations.length} cited records${source ? `, starting from “${source}”` : ''}.`;
    setMessages((current) => [...current, { role: 'user', text }, { role: 'assistant', text: answer }]);
    setDraft('');
  };

  return (
    <StepPanel title="Ask anything about the results">
      <ScrollShadow className="max-h-64">
        <div className="flex flex-col gap-2">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                'max-w-[90%] rounded-2xl px-2.5 py-1.5 text-meta',
                message.role === 'user'
                  ? 'ml-auto bg-accent text-accent-foreground'
                  : 'bg-surface-secondary text-foreground',
              )}
            >
              {message.text}
            </div>
          ))}
        </div>
      </ScrollShadow>

      <div className="flex items-end gap-2">
        <TextArea
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask anything about the results"
          aria-label="Ask anything about the results"
          className="min-w-0 flex-1"
        />
        <IconButton aria-label="Send" isDisabled={!draft.trim()} onPress={send}>
          <SendHorizontal className="size-4" aria-hidden />
        </IconButton>
      </div>
    </StepPanel>
  );
}

/** The Report step: the document, its status list, and its chat. */
export function ReportStep({
  review,
  papers,
  evaluated,
  includedPapers,
  onSelectStep,
  onOpenPaper,
}: {
  review: Review;
  papers: Paper[];
  evaluated: number;
  includedPapers: Paper[];
  onSelectStep: (id: ReviewStepId) => void;
  onOpenPaper: (paperId: string) => void;
}) {
  const report = contentOf(review)?.report;
  const citations = report ? collectCitations(report) : [];
  const extraction = extractionStatus(includedPapers);
  const included = includedPapers.length;
  const [saved, setSaved] = useState(false);

  /** A cited key opens its record's island; a legacy `[[id]]` already carries a paper id. */
  const openKey = (key: string) => onOpenPaper(paperIdByKey(key) ?? key);
  const resolveRecord = (key: string) => {
    const paperId = paperIdByKey(key);
    const paper = paperId ? findPaper(paperId) : undefined;
    return paper ? { title: paper.title, onOpen: () => onOpenPaper(paper.id) } : undefined;
  };
  const dateLabel = report
    ? new Date(`${report.date}T00:00:00`).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : undefined;

  const status: { label: string; detail: string; step: ReviewStepId }[] = [
    { label: 'Gather sources', detail: `${review.total} records retrieved`, step: 'sources' },
    { label: 'Screen sources', detail: `${evaluated} of ${review.total} judged`, step: 'screening' },
    {
      label: 'Extract data',
      detail: `${extraction.quoted} of ${extraction.cells} cells quoted`,
      step: 'extraction',
    },
    {
      label: 'Generate report',
      detail: dateLabel ?? 'Not generated yet',
      step: 'report',
    },
  ];

  return (
    <StepFrame
      aside={
        <>
          <StepPanel title="Report">
            <span className="text-meta tabular-nums text-muted">
              {dateLabel ? `${dateLabel} · ${citations.length} cited records` : 'No report yet'}
            </span>
          </StepPanel>

          <div className="flex flex-col gap-3">
            <CellGroup title="Workflow">
              {status.map((entry) => (
                <StatusRow
                  key={entry.label}
                  label={entry.label}
                  detail={entry.detail}
                  onOpen={() => onSelectStep(entry.step)}
                />
              ))}
            </CellGroup>

            <Button
              variant="secondary"
              className="w-full gap-1.5"
              aria-label="Save the report as a PDF"
              onPress={() => setSaved(true)}
            >
              {saved ? <Check className="size-4" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
              {saved ? 'Saved' : 'Save PDF'}
            </Button>
          </div>

          <ReportChat review={review} evaluated={evaluated} included={included} citations={citations} />
        </>
      }
    >
      <article className="mx-auto flex w-full max-w-[74ch] flex-col gap-5 rounded-3xl bg-surface p-6">
        <header className="flex flex-col gap-1">
          {dateLabel && <span className="text-meta text-muted">{dateLabel}</span>}
        </header>

        {!report ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-body text-foreground">No report yet. Run the review.</p>
            <p className="text-body text-muted">
              Written from the included records; nothing to read until a run gathers them.
            </p>
          </div>
        ) : report.body ? (
          <Markdown resolveRecord={resolveRecord}>{report.body}</Markdown>
        ) : (
          <>
            {report.summary && (
              <p className="text-body leading-relaxed text-foreground/90">{report.summary}</p>
            )}
            {(report.sections ?? []).map((section) => (
              <section key={section.id} className="flex flex-col gap-2">
                <SectionLabel>{section.heading}</SectionLabel>
                {(section.body ?? '').split('\n\n').map((paragraph, index) => (
                  <ReportParagraph key={index} text={paragraph} citations={citations} onOpen={openKey} />
                ))}
              </section>
            ))}
          </>
        )}

        {report && (
          <section className="flex flex-col gap-2 pt-2">
            <SectionLabel>Cited records</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {citations.length === 0 && (
                <p className="text-meta text-muted">This report cites no records yet.</p>
              )}
              {citations.map((key, index) => {
                const paperId = paperIdByKey(key);
                const paper = paperId ? findPaper(paperId) : undefined;
                const meta = paperId ? paperMeta(paperId) : undefined;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => openKey(key)}
                    className="flex items-start gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-surface-secondary"
                  >
                    <span className="w-5 shrink-0 text-right text-meta tabular-nums text-muted">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-meta text-foreground">{paper ? paper.title : key}</span>
                      <span className="block text-meta tabular-nums text-muted">
                        {paper ? `${paper.venue} · ${paper.year} · ` : ''}
                        {typeof meta?.citations === 'number'
                          ? `${meta.citations.toLocaleString()} citations`
                          : 'citation count not reported'}
                        {meta?.database ? ` · ${meta.database}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {papers.length === 0 && (
          <p className="text-body text-muted">
            No records have been screened, so there is nothing to report yet.
          </p>
        )}
      </article>
    </StepFrame>
  );
}
