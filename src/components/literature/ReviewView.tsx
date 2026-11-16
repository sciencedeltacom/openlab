/**
 * The stepped workspace for one systematic review.
 *
 * The review is not one table but a workflow: sources are gathered, a pilot settles the criteria
 * and the columns, the full passes screen and extract, and the report is written from what they
 * produced. This file owns the workflow state — which step is open, the decisions, the pilot
 * verdicts and the maybe threshold — and hands each step only what it needs. Keyed by review id,
 * so opening another review starts from that review's own protocol rather than carrying the last
 * one over.
 */

import { useMemo, useState } from 'react';

import { Select } from '@/components/ui';
import { RecordMissing } from '@/components/research/PageShell';
import { useApp, usePageTitle } from '@/store/app';
import {
  contentOf,
  findPaper,
  findReview,
  paperMeta,
  type Paper,
  type PilotVerdict,
  type Recommendation,
  type Review,
} from './data';
import { useReviews } from './store';
import { ExtractionStep } from './review/ExtractionStep';
import { PaperIsland } from './PaperIsland';
import { ReportStep } from './review/ReportStep';
import { ScreeningStep, screenCounts } from './review/ScreeningStep';
import { ReviewChrome, REVIEW_STEPS, type ReviewStepId } from './review/shell';
import { SourcesStep } from './review/SourcesStep';

/** A step, with the icon it is known by, so the list reads as stops rather than as words. */
function StepOption({ id, label }: { id: string; label: string }) {
  const Icon = REVIEW_STEPS.find((step) => step.id === (id as ReviewStepId))?.icon;
  return (
    <span className="flex items-center gap-2">
      {Icon && <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />}
      <span className="truncate text-body">{label}</span>
    </span>
  );
}

/** One review's workflow. Keyed by id at the call site so another review rebuilds the state. */
function ReviewWorkspace({ review }: { review: Review }) {
  const { state, dispatch } = useApp();
  usePageTitle(review.short);

  // The step is chosen from the top bar, so it lives in the store rather than here.
  const step = state.reviewStep as ReviewStepId;
  const [decisions, setDecisions] = useState<Record<string, Recommendation>>(() => ({ ...review.seed }));
  const [threshold, setThreshold] = useState(3);
  // The record whose island is open; clicking any record in any step sets it.
  const [viewPaperId, setViewPaperId] = useState<string | null>(null);
  const openPaper = (paperId: string) => setViewPaperId(paperId);

  const papers = useMemo(
    () => review.paperIds.map((id) => findPaper(id)).filter((paper): paper is Paper => Boolean(paper)),
    [review],
  );
  const criteria = useMemo(() => contentOf(review)?.criteria ?? [], [review]);
  // Verdicts start empty: only a decision somebody made, or one the model recorded, fills a cell.
  const [pilot, setPilot] = useState<Record<string, Record<string, PilotVerdict>>>({});

  const counts = useMemo(() => screenCounts(papers, decisions, threshold), [papers, decisions, threshold]);
  const includedPapers = useMemo(
    () =>
      papers.filter((paper) => {
        const decision = decisions[paper.id];
        if (decision === 'include') return true;
        if (decision === 'maybe') {
          const score = paperMeta(paper.id)?.score;
          return typeof score === 'number' && score >= threshold;
        }
        return false;
      }),
    [papers, decisions, threshold],
  );

  const decide = (paperId: string, next: Recommendation) =>
    setDecisions((current) => ({ ...current, [paperId]: next }));

  /**
   * Why the extraction step is empty, when it is.
   *
   * "Nothing here" is not an answer. If every record was excluded — or nothing has been
   * screened yet — the step says which, and what to do about it.
   */
  const extractionReason = useMemo(() => {
    if (papers.length === 0) {
      return 'This review has no records yet. Run it from a source; the retrieved records appear on the Sources step.';
    }
    if (counts.evaluated === 0) {
      return `None of the ${papers.length} records has been screened yet. Screen them on the screening step; the included records are what gets extracted.`;
    }
    if (includedPapers.length === 0) {
      const decided = papers.filter((paper) => decisions[paper.id]);
      const byDecision = decided.filter((paper) => decisions[paper.id] === 'include').length;
      const maybe = decided.filter((paper) => decisions[paper.id] === 'maybe');
      const maybeBelow = maybe.filter((paper) => {
        const score = paperMeta(paper.id)?.score;
        return typeof score === 'number' && score < threshold;
      }).length;
      const unscored = maybe.filter((paper) => paperMeta(paper.id)?.score === undefined).length;
      const excluded = decided.length - byDecision - maybe.length;
      return `Nothing is included, so there is nothing to extract: of ${decided.length} screened records, ${excluded} were excluded and ${maybe.length} are maybe, ${maybeBelow} of them below the score threshold of ${threshold}${
        unscored > 0 ? `, and ${unscored} not scored yet` : ''
      }. Include one, or lower the threshold, on the screening step.`;
    }
    return undefined;
  }, [papers, decisions, counts.evaluated, includedPapers.length, threshold]);

  const markCriterion = (paperId: string, criterionId: string, next: PilotVerdict) =>
    setPilot((current) => ({
      ...current,
      [paperId]: { ...current[paperId], [criterionId]: next },
    }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The step is a control on the review, so it lives with the review. It used to sit in
          the application's top bar, which meant the one page that has steps kept its most
          important control outside itself. */}
      <div className="flex shrink-0 items-center gap-2 px-7 pt-4">
        <Select
          label="Review step"
          value={step}
          options={REVIEW_STEPS.map((entry) => ({ value: entry.id, label: entry.label }))}
          onChange={(value) => dispatch({ type: 'review/step', step: value })}
          className="w-[190px]"
          renderOption={(option) => <StepOption id={option.value} label={option.label} />}
          renderValue={(option) => option && <StepOption id={option.value} label={option.label} />}
        />
      </div>

      {/* Every step but the report answers the question, so the question is that page's title.
          The report *is* the answer: it carries its own heading and the question above it would
          be the same sentence twice, with the second one smaller. */}
      {step !== 'report' && <ReviewChrome review={review} />}

      {step === 'sources' && <SourcesStep review={review} papers={papers} onOpenPaper={openPaper} />}

      {(step === 'screening-pilot' || step === 'screening') && (
        <ScreeningStep
          papers={papers}
          mode={step === 'screening-pilot' ? 'pilot' : 'full'}
          criteria={criteria}
          decisions={decisions}
          onDecide={decide}
          pilot={pilot}
          onPilot={markCriterion}
          threshold={threshold}
          onThreshold={setThreshold}
          onOpenPaper={openPaper}
        />
      )}

      {(step === 'extraction-pilot' || step === 'extraction') && (
        <ExtractionStep
          papers={includedPapers}
          mode={step === 'extraction-pilot' ? 'pilot' : 'full'}
          reason={extractionReason}
          onOpenPaper={openPaper}
        />
      )}

      {step === 'report' && (
        <ReportStep
          review={review}
          papers={papers}
          evaluated={counts.evaluated}
          includedPapers={includedPapers}
          onSelectStep={(id) => dispatch({ type: 'review/step', step: id })}
          onOpenPaper={openPaper}
        />
      )}

      <PaperIsland
        paper={viewPaperId ? findPaper(viewPaperId) : undefined}
        onClose={() => setViewPaperId(null)}
      />
    </div>
  );
}

/** One review's workflow; an unknown id gets the shared not-found state. */
export function ReviewView({ reviewId }: { reviewId: string }) {
  useReviews();
  const review = findReview(reviewId);
  if (!review) {
    return <RecordMissing what="review" back="literature-reviews" backLabel="Reviews" />;
  }
  return <ReviewWorkspace key={review.id} review={review} />;
}
