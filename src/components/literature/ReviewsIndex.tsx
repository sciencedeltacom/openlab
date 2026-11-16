/**
 * The reviews index.
 *
 * The starting page for systematic review work. The top half is the overview shape — a
 * sentence and four numbers — and the rest is one card per review, so a reader sees the
 * state of every question before choosing one to open. Starting a review is a modal rather
 * than a page: four fields, then back to the list.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  CircleCheck,
  ExternalLink,
  ListChecks,
  LoaderCircle,
  OctagonAlert,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import { Button, Chip, ProgressBar, ScrollShadow, SectionLabel } from '@/components/ui';
import { ChoiceModal, RenameModal, RowMenu, type RowAction } from '@/components/common/RowMenu';
import { notify } from '@/lib/toast';
import { RecordLink } from '@/components/research/PageShell';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import { MOTION } from '@/theme/tokens';
import { dismissReviewRun, useReviewRuns, type ReviewRunState } from '@/lib/literature/runner';
import { patchReview, removeReview, useReviews } from './store';
import { REVIEWS, reviewProgress, touchedLabel, type Review, type ReviewState } from './data';

/** A review's state, as a chip and a mark. One vocabulary for the list and the workspace. */
const REVIEW_STATE: Record<ReviewState, { label: string; chip: string; icon: typeof Search }> = {
  screening: { label: 'Screening', chip: 'bg-accent/15 text-accent', icon: Search },
  extracting: { label: 'Extracting', chip: 'bg-warning/15 text-warning', icon: ListChecks },
  complete: { label: 'Complete', chip: 'bg-success/15 text-success', icon: CircleCheck },
};

/** One headline number, the overview's stat shape. */
function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'accent' | 'success';
}) {
  return (
    <div className="rounded-2xl bg-surface p-3">
      <div className="text-meta text-muted">{label}</div>
      <div
        className={cn(
          'text-title tabular-nums',
          tone === 'accent' ? 'text-accent' : tone === 'success' ? 'text-success' : 'text-foreground',
        )}
      >
        {value}
      </div>
      {note && <div className="text-meta text-muted">{note}</div>}
    </div>
  );
}

/** One review as a card: its question, its progress, its protocol and when it was touched. */
function ReviewCard({ review, index, actions }: { review: Review; index: number; actions: RowAction[] }) {
  const meta = REVIEW_STATE[review.state];
  const Icon = meta.icon;
  const progress = reviewProgress(review);
  const ratio = review.total > 0 ? progress.screened / review.total : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: MOTION.duration.panel,
        ease: MOTION.signature,
        delay: Math.min(index, 12) * 0.03,
      }}
      className="group relative"
    >
      <RecordLink
        route={`literature-reviews/${review.id}`}
        className="flex h-full w-full flex-col gap-3 rounded-2xl bg-surface p-4 pr-10 transition-colors hover:bg-surface-tertiary"
      >
        <div className="flex items-center gap-2">
          <span className={cn('flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label', meta.chip)}>
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {meta.label}
          </span>
          <span className="ml-auto text-meta text-muted">Last touched {touchedLabel(review)}</span>
        </div>

        <p className="line-clamp-3 text-body text-foreground">{review.question}</p>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-meta">
            <span className="text-muted">Screening progress</span>
            <span className="tabular-nums text-foreground">
              {progress.screened} of {review.total} screened
            </span>
          </div>
          <ProgressBar
            value={Math.round(ratio * 100)}
            size="sm"
            color="accent"
            aria-label={`${review.short} screening progress`}
            className="w-full"
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <div className="flex items-center gap-3 text-meta tabular-nums text-muted">
            <span className="text-success">{progress.included} included</span>
            <span className="text-danger">{progress.excluded} excluded</span>
            <span className="ml-auto">
              {Math.max(0, progress.screened - progress.included - progress.excluded)} maybe
            </span>
          </div>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5">
          {review.protocol.slice(0, 4).map((fact) => (
            <div key={fact.label} className="min-w-0">
              <SectionLabel>{fact.label}</SectionLabel>
              <p className="line-clamp-2 text-meta text-muted">{fact.value}</p>
            </div>
          ))}
        </div>
      </RecordLink>
      <div className="absolute right-3 top-3 z-10">
        <RowMenu label={`Actions for review ${review.short}`} actions={actions} />
      </div>
    </motion.div>
  );
}

/**
 * A review that is running, or one whose run failed — drawn as the card it will become.
 *
 * The point is that a run in the background reads like every other review on the page: same
 * card, same chip, one state apart. When it finishes, its own review card takes its place.
 */
function RunCard({ run, index }: { run: ReviewRunState; index: number }) {
  const tone =
    run.status === 'error'
      ? 'bg-danger/15 text-danger'
      : run.status === 'running'
        ? 'bg-accent/15 text-accent'
        : 'bg-success/15 text-success';
  const Icon = run.status === 'running' ? LoaderCircle : run.status === 'done' ? CircleCheck : OctagonAlert;
  const label = run.status === 'running' ? 'Running' : run.status === 'done' ? 'Complete' : 'Failed';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: MOTION.duration.panel,
        ease: MOTION.signature,
        delay: Math.min(index, 12) * 0.03,
      }}
      className="group relative"
    >
      <RecordLink
        route={`literature-reviews/${run.id}`}
        className="flex h-full w-full flex-col gap-3 rounded-2xl bg-surface p-4 pr-10 transition-colors hover:bg-surface-tertiary"
      >
        <div className="flex items-center gap-2">
          <span className={cn('flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label', tone)}>
            <Icon
              className={cn('size-3.5 shrink-0', run.status === 'running' && 'animate-spin')}
              aria-hidden
            />
            {label}
          </span>
          <span className="ml-auto text-meta text-muted">
            {run.status === 'running' ? 'Working in the background' : 'Just now'}
          </span>
        </div>

        <p className="line-clamp-3 text-body text-foreground">{run.question}</p>

        <p className="line-clamp-2 text-meta text-muted">
          {run.status === 'error' ? run.error : (run.log.at(-1) ?? run.progress)}
        </p>

        {run.log.length > 0 && (
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-default p-2 font-mono text-[11px] leading-relaxed text-muted">
            {run.log.join('\n')}
          </pre>
        )}

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-meta text-muted">
            {run.status === 'running'
              ? 'Open it to watch the records arrive.'
              : run.status === 'error'
                ? 'Open it to see why the run stopped.'
                : 'The review is ready.'}
          </span>
        </div>
      </RecordLink>
      {run.status !== 'running' && (
        <div className="absolute right-3 top-3 z-10">
          <Button size="sm" variant="ghost" onPress={() => dismissReviewRun(run.id)}>
            Dismiss
          </Button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * The reviews index.
 *
 * Reviews live in the literature store, so a review the create page runs appears here at once.
 * New review opens the create page rather than a modal — a protocol is more than four fields.
 */
export function ReviewsIndex() {
  const { dispatch } = useApp();
  useReviews();
  const [renameTarget, setRenameTarget] = useState<Review | null>(null);
  const [stateTarget, setStateTarget] = useState<Review | null>(null);

  /** The actions a review card offers. Its question stands in for a name. */
  const actionsFor = (review: Review): RowAction[] => [
    {
      id: 'open',
      label: 'Open',
      icon: ExternalLink,
      onSelect: () => dispatch({ type: 'route/go', route: `literature-reviews/${review.id}` }),
    },
    { id: 'rename', label: 'Rename question…', icon: Pencil, onSelect: () => setRenameTarget(review) },
    {
      id: 'state',
      label: 'Change state…',
      icon: CircleCheck,
      onSelect: () => setStateTarget(review),
    },
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => {
        removeReview(review.id);
        notify(`Removed “${review.short}”`);
      },
    },
  ];

  const reviews = REVIEWS;
  // A run still working (or failed) is its own card; the review it started is hidden behind it
  // so the two never show at once. When the run finishes, the review card takes over.
  const activeRuns = useReviewRuns().filter((run) => run.status !== 'done');
  const visibleReviews = reviews.filter((review) => !activeRuns.some((run) => run.id === review.id));
  const totals = reviews.reduce(
    (sum, review) => {
      const progress = reviewProgress(review);
      return {
        screened: sum.screened + progress.screened,
        included: sum.included + progress.included,
        excluded: sum.excluded + progress.excluded,
      };
    },
    { screened: 0, included: 0, excluded: 0 },
  );
  const awaiting = totals.screened - totals.included - totals.excluded;

  return (
    <ScrollShadow className="h-full min-h-0">
      <div className="flex w-full flex-col gap-5 px-7 py-7">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title text-foreground">Reviews</h1>
            <Button
              variant="primary"
              className="ml-auto gap-1.5"
              onPress={() => dispatch({ type: 'route/go', route: 'literature-reviews/new' })}
            >
              <Plus className="size-3.5" />
              New review
            </Button>
          </div>
          <p className="max-w-[80ch] text-body text-muted">
            Each review is one question, one protocol and one screening table.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Reviews"
            value={String(reviews.length)}
            note={`${reviews.filter((r) => r.state === 'screening').length} screening`}
          />
          <Stat label="Records screened" value={String(totals.screened)} tone="accent" />
          <Stat label="Included" value={String(totals.included)} tone="success" />
          <Stat
            label="Awaiting a decision"
            value={String(Math.max(0, awaiting))}
            note="of the screened records"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {activeRuns.map((run, index) => (
            <RunCard key={run.id} run={run} index={index} />
          ))}
          {visibleReviews.map((review, index) => (
            <ReviewCard
              key={review.id}
              review={review}
              index={activeRuns.length + index}
              actions={actionsFor(review)}
            />
          ))}
        </div>
      </div>

      {reviews.length === 0 && activeRuns.length === 0 && (
        <p className="px-6 text-body text-muted">No reviews yet. Start one above.</p>
      )}

      <RenameModal
        open={renameTarget !== null}
        title="Rename question"
        label="Question"
        value={renameTarget?.question ?? ''}
        onClose={() => setRenameTarget(null)}
        onSubmit={(question) => {
          if (renameTarget) {
            patchReview(renameTarget.id, { question, short: question.slice(0, 48) });
            notify(`Renamed to “${question}”`);
          }
        }}
      />
      {stateTarget && (
        <ChoiceModal
          open
          title="Change state"
          label="State"
          value={stateTarget.state}
          options={(Object.keys(REVIEW_STATE) as ReviewState[]).map((state) => ({
            value: state,
            label: REVIEW_STATE[state].label,
          }))}
          onClose={() => setStateTarget(null)}
          onSubmit={(state) => {
            patchReview(stateTarget.id, { state });
            notify(`State changed to ${REVIEW_STATE[state].label}`);
          }}
        />
      )}
    </ScrollShadow>
  );
}
