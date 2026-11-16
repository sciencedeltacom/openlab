/**
 * The Screening step, in its two passes.
 *
 * The pilot is the rehearsal: a few records judged yes, no or maybe against every criterion, so a
 * criterion that is doing no work can be changed before the whole set is judged. The full pass is
 * the decision itself: include, maybe or exclude, with a score out of five, the reasoning written
 * down, and the criterion verdicts carried over from the pilot.
 *
 * Both passes share this file because they share the filters and the record set; only the columns
 * and the top controls differ. A cell's verdict carries the model's reason, shown on demand.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Check, HelpCircle, Info, Search, X, type LucideIcon } from 'lucide-react';

import { Input, SectionLabel, Slider, ToggleButton, ToggleButtonGroup } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  RECOMMENDATIONS,
  RECOMMENDATION_LABEL,
  paperMeta,
  type Criterion,
  type Paper,
  type PilotVerdict,
  type Recommendation,
} from '../data';
import { CriterionDrawer } from './CriterionDrawer';
import { StepFrame, tableMinWidth } from './shell';

/* ================================================================================================
 * Decisions and verdicts
 * ============================================================================================== */

/** The tint a recommendation wears, on and off. Tone only, never a stroke. */
const RECOMMENDATION_TONE: Record<Recommendation, { on: string; off: string }> = {
  include: { on: 'bg-success text-success-foreground', off: 'bg-success-soft text-success-soft-foreground' },
  maybe: { on: 'bg-warning text-warning-foreground', off: 'bg-warning-soft text-warning-soft-foreground' },
  exclude: { on: 'bg-danger text-danger-foreground', off: 'bg-danger-soft text-danger-soft-foreground' },
};

/** The mark and tint each pilot verdict wears. */
const VERDICT_META: Record<PilotVerdict, { label: string; icon: LucideIcon; on: string }> = {
  yes: { label: 'Yes', icon: Check, on: 'bg-success-soft text-success-soft-foreground' },
  no: { label: 'No', icon: X, on: 'bg-danger-soft text-danger-soft-foreground' },
  maybe: { label: 'Maybe', icon: HelpCircle, on: 'bg-warning-soft text-warning-soft-foreground' },
};

const PILOT_ORDER: PilotVerdict[] = ['yes', 'no', 'maybe'];

/** One recommendation control: three tinted chips, one of them on. */
function ScreeningChoice({
  value,
  onChange,
}: {
  value?: Recommendation;
  onChange: (next: Recommendation) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Screening decision">
      {RECOMMENDATIONS.map((recommendation) => {
        const on = value === recommendation;
        return (
          <button
            key={recommendation}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(recommendation)}
            className={cn(
              'rounded-full px-2.5 py-1 text-label transition-colors',
              on ? RECOMMENDATION_TONE[recommendation].on : RECOMMENDATION_TONE[recommendation].off,
            )}
          >
            {RECOMMENDATION_LABEL[recommendation]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One criterion's three-way pilot control, with the reason on demand.
 *
 * The verdict is the decision; the `why` button beside it opens the drawer that says what the
 * model decided for this cell and why, so a "no" is never silent. A cell nobody has judged
 * yet shows none of the three marks — the drawer says the cell is unjudged rather than
 * borrowing a verdict from anywhere.
 */
function PilotChoice({
  paper,
  criterion,
  value,
  onChange,
  onWhy,
}: {
  paper: Paper;
  criterion: Criterion;
  value?: PilotVerdict;
  onChange: (next: PilotVerdict) => void;
  onWhy: () => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label={`${criterion.label} for ${paper.title}`}
    >
      {PILOT_ORDER.map((verdict) => {
        const meta = VERDICT_META[verdict];
        const Icon = meta.icon;
        const on = value === verdict;
        return (
          <button
            key={verdict}
            type="button"
            title={meta.label}
            aria-label={meta.label}
            aria-pressed={on}
            onClick={() => onChange(verdict)}
            className={cn(
              'grid size-6 place-items-center rounded-lg transition-colors',
              on ? meta.on : 'text-muted hover:bg-surface-secondary',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
      <button
        type="button"
        aria-label={
          value
            ? `Why ${criterion.label} is ${VERDICT_META[value].label}`
            : `Why ${criterion.label} is not judged yet`
        }
        onClick={onWhy}
        className="grid size-6 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
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

/** The counts a screening pass reports, with maybes at or above the threshold counted as included. */
export function screenCounts(
  papers: Paper[],
  decisions: Record<string, Recommendation>,
  threshold: number,
): { evaluated: number; included: number; excluded: number; maybe: number } {
  let evaluated = 0;
  let included = 0;
  let excluded = 0;
  let maybe = 0;
  for (const paper of papers) {
    const decision = decisions[paper.id];
    if (!decision) continue;
    evaluated += 1;
    if (decision === 'maybe') {
      maybe += 1;
      // A maybe with no score yet has cleared nothing, so it is not counted as included.
      const score = paperMeta(paper.id)?.score;
      if (typeof score === 'number' && score >= threshold) included += 1;
      else excluded += 1;
    } else if (decision === 'include') {
      included += 1;
    } else {
      excluded += 1;
    }
  }
  return { evaluated, included, excluded, maybe };
}

/* ================================================================================================
 * The pilot table
 * ============================================================================================== */

/** The pilot table: one column per criterion, one three-way control per cell. */
function ScreeningPilot({
  criteria,
  rows,
  pilot,
  onPilot,
  onOpenPaper,
  onWhy,
  controls,
}: {
  criteria: Criterion[];
  rows: Paper[];
  pilot: Record<string, Record<string, PilotVerdict>>;
  onPilot: (paperId: string, criterionId: string, next: PilotVerdict) => void;
  onOpenPaper: (paperId: string) => void;
  onWhy: (paper: Paper, criterion: Criterion, value: PilotVerdict) => void;
  controls: ReactNode;
}) {
  const template = ['minmax(16rem,1fr)', ...criteria.map(() => '9rem')].join(' ');

  return (
    <StepFrame toolbar={controls}>
      <div className="w-full overflow-x-auto rounded-3xl bg-surface">
        <div
          className="grid items-center gap-x-4 bg-surface-tertiary px-3 py-2"
          style={{ gridTemplateColumns: template, minWidth: tableMinWidth(template), width: '100%' }}
        >
          <div className="sticky left-0 z-10 bg-surface-tertiary section-label">Paper</div>
          {criteria.map((criterion) => (
            <div key={criterion.id} className="section-label truncate" title={criterion.question}>
              {criterion.label}
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="p-6 text-body text-muted">Nothing matches the current filters.</p>
        ) : (
          <div className="flex flex-col">
            {rows.map((paper) => {
              const judged = paperMeta(paper.id)?.criteria;
              return (
                <div
                  key={paper.id}
                  className="group grid items-start gap-x-4 px-3 py-2.5 transition-colors hover:bg-surface-secondary"
                  style={{ gridTemplateColumns: template, minWidth: tableMinWidth(template), width: '100%' }}
                >
                  <PaperCell paper={paper} onOpen={() => onOpenPaper(paper.id)} />
                  {criteria.map((criterion) => {
                    const value = judged?.[criterion.id]?.verdict ?? pilot[paper.id]?.[criterion.id];
                    return (
                      <PilotChoice
                        key={criterion.id}
                        paper={paper}
                        criterion={criterion}
                        value={value}
                        onChange={(next) => onPilot(paper.id, criterion.id, next)}
                        onWhy={() => onWhy(paper, criterion, value)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </StepFrame>
  );
}

/* ================================================================================================
 * The full table
 * ============================================================================================== */

const FULL_TEMPLATE = ['minmax(18rem,1fr)', '11rem', '5rem', '18rem', '20rem'].join(' ');

/** The full table: judgement, score, rationale, and the criterion verdicts as chip rows. */
function ScreeningFull({
  criteria,
  rows,
  decisions,
  onDecide,
  pilot,
  onOpenPaper,
  controls,
}: {
  criteria: Criterion[];
  rows: Paper[];
  decisions: Record<string, Recommendation>;
  onDecide: (paperId: string, next: Recommendation) => void;
  pilot: Record<string, Record<string, PilotVerdict>>;
  onOpenPaper: (paperId: string) => void;
  controls: ReactNode;
}) {
  return (
    <StepFrame toolbar={controls}>
      <div className="w-full overflow-x-auto rounded-3xl bg-surface">
        <div
          className="grid items-center gap-x-4 bg-surface-tertiary px-3 py-2"
          style={{
            gridTemplateColumns: FULL_TEMPLATE,
            minWidth: tableMinWidth(FULL_TEMPLATE),
            width: '100%',
          }}
        >
          <div className="sticky left-0 z-10 bg-surface-tertiary section-label">Paper</div>
          <div className="section-label">Screening judgement</div>
          <div className="section-label">Score</div>
          <div className="section-label">Rationale</div>
          <div className="section-label">Criteria</div>
        </div>

        {rows.length === 0 ? (
          <p className="p-6 text-body text-muted">Nothing matches the current filters.</p>
        ) : (
          <div className="flex flex-col">
            {rows.map((paper) => {
              const meta = paperMeta(paper.id);
              return (
                <div
                  key={paper.id}
                  className="group grid items-start gap-x-4 px-3 py-2.5 transition-colors hover:bg-surface-secondary"
                  style={{
                    gridTemplateColumns: FULL_TEMPLATE,
                    minWidth: tableMinWidth(FULL_TEMPLATE),
                    width: '100%',
                  }}
                >
                  <PaperCell paper={paper} onOpen={() => onOpenPaper(paper.id)} />
                  <ScreeningChoice
                    value={decisions[paper.id]}
                    onChange={(next) => onDecide(paper.id, next)}
                  />
                  <span className="text-body tabular-nums text-foreground">
                    {typeof meta?.score === 'number' ? (
                      <>
                        {meta.score}
                        <span className="text-muted">/5</span>
                      </>
                    ) : (
                      <span className="text-muted" title="No score recorded for this record">
                        —
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-3 text-meta text-muted">
                    {meta?.rationale ?? 'Not assessed yet.'}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {criteria.map((criterion) => {
                      const judged = meta?.criteria?.[criterion.id];
                      const verdict = judged?.verdict ?? pilot[paper.id]?.[criterion.id];
                      if (!verdict) {
                        return (
                          <span
                            key={criterion.id}
                            title={`${criterion.question}: not judged yet`}
                            className="inline-flex items-center gap-1 rounded-full bg-surface-secondary px-2 py-0.5 text-meta text-muted"
                          >
                            {criterion.label}
                          </span>
                        );
                      }
                      const mark = VERDICT_META[verdict];
                      const Icon = mark.icon;
                      return (
                        <span
                          key={criterion.id}
                          title={
                            judged?.reason
                              ? `${criterion.question}: ${mark.label}. ${judged.reason}`
                              : `${criterion.question}: ${mark.label}`
                          }
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta',
                            mark.on,
                          )}
                        >
                          <Icon className="size-3 shrink-0" aria-hidden />
                          {criterion.label}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </StepFrame>
  );
}

/* ================================================================================================
 * The step
 * ============================================================================================== */

/** The Screening step: the pilot pass or the full pass, over the review's own records. */
export function ScreeningStep({
  papers,
  mode,
  criteria,
  decisions,
  onDecide,
  pilot,
  onPilot,
  threshold,
  onThreshold,
  onOpenPaper,
}: {
  papers: Paper[];
  mode: 'pilot' | 'full';
  criteria: Criterion[];
  decisions: Record<string, Recommendation>;
  onDecide: (paperId: string, next: Recommendation) => void;
  pilot: Record<string, Record<string, PilotVerdict>>;
  onPilot: (paperId: string, criterionId: string, next: PilotVerdict) => void;
  threshold: number;
  onThreshold: (value: number) => void;
  onOpenPaper: (paperId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [why, setWhy] = useState<{ paper: Paper; criterion: Criterion; verdict?: PilotVerdict } | null>(null);
  const needle = query.trim().toLowerCase();

  const rows = useMemo(
    () =>
      papers.filter((paper) => {
        if (mode === 'full' && recommendation && decisions[paper.id] !== recommendation) return false;
        if (!needle) return true;
        return [paper.title, ...paper.authors].join(' ').toLowerCase().includes(needle);
      }),
    [needle],
  );

  const counts = screenCounts(papers, decisions, threshold);

  // One row under the question: the search, the filters, and the columns/decision controls.
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
          aria-label="Recommendation"
          selectionMode="single"
          selectedKeys={[recommendation ?? 'all']}
          onSelectionChange={(keys) => {
            const [first] = keys as Set<string>;
            if (first) setRecommendation(first === 'all' ? null : (first as Recommendation));
          }}
        >
          <ToggleButton id="all">All</ToggleButton>
          {RECOMMENDATIONS.map((item) => (
            <ToggleButton key={item} id={item}>
              {RECOMMENDATION_LABEL[item]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          <SectionLabel>Columns</SectionLabel>
          {criteria.map((criterion) => (
            <span
              key={criterion.id}
              title={criterion.question}
              className="rounded-full bg-surface-secondary px-2 py-0.5 text-meta text-muted"
            >
              {criterion.label}
            </span>
          ))}
        </span>
      )}

      <span className="text-meta tabular-nums text-muted">
        {rows.length} of {papers.length} records
      </span>

      {mode === 'full' && (
        <span className="ml-auto flex items-center gap-3">
          <span className="text-meta tabular-nums text-muted">
            <span className="text-success">{counts.included} included</span> ·{' '}
            <span className="text-danger">{counts.excluded} excluded</span> · {counts.maybe} maybe
          </span>
          <span className="flex items-center gap-2 text-meta text-muted">
            Maybe ≥
            <Slider
              value={threshold}
              minValue={1}
              maxValue={5}
              step={1}
              onChange={(next) => {
                if (typeof next === 'number') onThreshold(next);
              }}
              aria-label="Maybe threshold"
              className="w-28"
            >
              <Slider.Track>
                <Slider.Fill />
                <Slider.Thumb />
              </Slider.Track>
            </Slider>
            <span className="tabular-nums text-foreground">{threshold}</span>
          </span>
        </span>
      )}
    </>
  );

  if (papers.length === 0) {
    return (
      <StepFrame>
        <div className="flex w-full flex-col items-start gap-2 rounded-3xl bg-surface p-6">
          <p className="text-body text-foreground">No records have been added to this review yet.</p>
          <p className="text-body text-muted">Add records on the Sources step before screening them.</p>
        </div>
      </StepFrame>
    );
  }

  return (
    <>
      {mode === 'pilot' ? (
        <ScreeningPilot
          criteria={criteria}
          rows={rows}
          pilot={pilot}
          onPilot={onPilot}
          onOpenPaper={onOpenPaper}
          onWhy={(paper, criterion, verdict) => setWhy({ paper, criterion, verdict })}
          controls={controls}
        />
      ) : (
        <ScreeningFull
          criteria={criteria}
          rows={rows}
          decisions={decisions}
          onDecide={onDecide}
          pilot={pilot}
          onOpenPaper={onOpenPaper}
          controls={controls}
        />
      )}
      <CriterionDrawer
        paper={why?.paper ?? null}
        criterion={why?.criterion ?? null}
        verdict={why?.verdict}
        onClose={() => setWhy(null)}
      />
    </>
  );
}
