/**
 * Why a screening cell was judged the way it was.
 *
 * The pilot's ✓ / ✕ / ? controls are the decision; the info button beside them opens this drawer,
 * which says what the criterion asks, what the model decided for this record and criterion, and
 * the sentence from the abstract it gave as its reason. A cell nobody has judged yet is still
 * opened, and says so rather than showing an invented verdict.
 */

import { Check, HelpCircle, X, type LucideIcon } from 'lucide-react';

import { Drawer, ScrollShadow, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { paperMeta, type Criterion, type Paper, type PilotVerdict } from '../data';

const VERDICT: Record<PilotVerdict, { label: string; icon: LucideIcon; tone: string }> = {
  yes: { label: 'Yes', icon: Check, tone: 'bg-success-soft text-success-soft-foreground' },
  no: { label: 'No', icon: X, tone: 'bg-danger-soft text-danger-soft-foreground' },
  maybe: { label: 'Maybe', icon: HelpCircle, tone: 'bg-warning-soft text-warning-soft-foreground' },
};

export function CriterionDrawer({
  paper,
  criterion,
  verdict,
  onClose,
}: {
  paper: Paper | null;
  criterion: Criterion | null;
  verdict?: PilotVerdict;
  onClose: () => void;
}) {
  const open = Boolean(paper && criterion);
  const meta = paper ? paperMeta(paper.id) : undefined;
  const judged = paper && criterion ? meta?.criteria?.[criterion.id] : undefined;
  const mark = verdict ? VERDICT[verdict] : undefined;
  const Icon = mark?.icon;

  return (
    <Drawer isOpen={open} onOpenChange={(next) => !next && onClose()}>
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-[420px] max-w-[94vw]">
            <Drawer.Header className="justify-end">
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 pt-1">
              {paper && criterion && (
                <ScrollShadow className="flex min-h-0 flex-1 flex-col gap-6 px-5 pb-8">
                  <div className="flex flex-col gap-2">
                    <span className="text-meta text-muted">Screening judgement</span>
                    <h2 className="text-[1.125rem] leading-snug font-semibold text-foreground">
                      {criterion.label}
                    </h2>
                    <p className="text-body leading-relaxed text-muted">{criterion.question}</p>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-separator pt-5">
                    <div className="flex items-center gap-2">
                      {mark && Icon ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label',
                            mark.tone,
                          )}
                        >
                          <Icon className="size-3.5" aria-hidden />
                          {mark.label}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-surface-secondary px-2.5 py-1 text-label text-muted">
                          Not judged yet
                        </span>
                      )}
                      <span className="text-meta text-muted">for this record</span>
                    </div>
                    <p className="text-body leading-[1.7] text-foreground/90">
                      {judged?.reason ??
                        (mark
                          ? 'The model recorded no reason for this cell.'
                          : 'No decision or reason has been recorded for this cell yet.')}
                    </p>
                    {judged && verdict && judged.verdict !== verdict && (
                      <p className="text-meta text-muted">
                        The model's own verdict was {VERDICT[judged.verdict].label.toLowerCase()}; the current
                        one is yours.
                      </p>
                    )}
                  </div>

                  <section className="flex flex-col gap-1.5">
                    <SectionLabel>Record</SectionLabel>
                    <p className="text-body leading-snug text-foreground">{paper.title}</p>
                    <p className="text-meta tabular-nums text-muted">
                      {paper.venue} · {paper.year}
                    </p>
                  </section>

                  {meta?.rationale && (
                    <section className="flex flex-col gap-1.5">
                      <SectionLabel>Overall screening note</SectionLabel>
                      <p className="text-body leading-[1.7] text-foreground/90">{meta.rationale}</p>
                    </section>
                  )}
                </ScrollShadow>
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
