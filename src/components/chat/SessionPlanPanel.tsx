/**
 * The session plan, above the composer.
 *
 * The agent writes it with `plan_update` before work that takes more than a step or two. It
 * sits beside the transcript rather than in it: the reader needs it while the turn runs, not
 * after scrolling past three tool calls. It folds into a pill like the subagents panel does,
 * and the open/closed choice is remembered — a preference for a quiet column is a standing one.
 */

import { useState } from 'react';
import { Check, Circle, ListOrdered, Loader2, Minus } from 'lucide-react';

import { cn } from '@/lib/cn';
import { activeSession, type PlanStep } from '@/store/types';
import { useApp } from '@/store/app';
import { DockPanel } from './DockPanel';

/** Whether the panel is open, remembered across sessions. */
const KEY = 'openlab.plan.open';

/** The mark one step wears, from where it stands. */
function StepMark({ status }: { status: PlanStep['status'] }) {
  if (status === 'done') {
    return <Check className="size-3 shrink-0 text-success" aria-label="done" />;
  }
  if (status === 'active') {
    return <Loader2 className="size-3 shrink-0 animate-spin text-accent" aria-label="in progress" />;
  }
  if (status === 'skipped') {
    return <Minus className="size-3 shrink-0 text-muted" aria-label="skipped" />;
  }
  return <Circle className="size-3 shrink-0 text-muted" aria-label="pending" />;
}

export function SessionPlanPanel() {
  const { state } = useApp();
  const plan = activeSession(state)?.plan;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== 'closed';
    } catch {
      return true;
    }
  });

  if (!plan || plan.steps.length === 0) {
    return null;
  }

  const settled = plan.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
  const active = plan.steps.find((step) => step.status === 'active');

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(KEY, next ? 'open' : 'closed');
    } catch {
      // A blocked storage leaves the panel as it is; nothing else depends on it.
    }
  };

  return (
    <DockPanel
      layoutId="session-plan"
      icon={ListOrdered}
      label="Plan"
      meta={`${settled}/${plan.steps.length}`}
      open={open}
      onToggle={toggle}
      status={active ? <Loader2 className="size-3 animate-spin text-accent" aria-hidden /> : undefined}
      pill={
        <>
          <span>Plan</span>
          <span className="tabular-nums">
            {' '}
            · {settled}/{plan.steps.length}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-1 px-1.5 pb-1">
        {plan.goal && <p className="truncate text-meta text-muted">{plan.goal}</p>}
        <ol className="flex flex-col gap-1">
          {plan.steps.map((step) => (
            <li key={step.id} className="flex items-baseline gap-2">
              <StepMark status={step.status} />
              <span
                className={cn(
                  'min-w-0 text-body',
                  step.status === 'done' || step.status === 'skipped'
                    ? 'text-muted line-through'
                    : step.status === 'active'
                      ? 'text-foreground'
                      : 'text-muted',
                )}
              >
                {step.title}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </DockPanel>
  );
}
