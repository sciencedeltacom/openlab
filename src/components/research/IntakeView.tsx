/**
 * Intake: the queue that needs a decision.
 *
 * Two things wait here. Work the tracker has taken on but nobody owns — which is every task
 * the agent opens, since it cannot decide who should do the work — and what the inbox has
 * not been read yet.
 *
 * Accept and Decline are real: they move the task, and the row leaves the queue because the
 * data moved rather than because the screen remembered a click. Snooze is the one decision
 * held in the session, and says so.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, Check } from 'lucide-react';

import { Button, SectionLabel } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { notify } from '@/lib/toast';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import { intakeQueue, intakeStatus, type IntakeDecision, type IntakeRow } from '@/store/research';
import { MOTION } from '@/theme/tokens';
import { ActorMark, InboxKindGlyph, TaskKey } from './shared';

/** The triage queue. */
export function IntakeView() {
  const { state, dispatch } = useApp();
  const [snoozedIds, setSnoozedIds] = useState<readonly string[]>([]);
  const intake = intakeQueue(state.inbox, state.tasks);

  /**
   * Take a decision.
   *
   * A task is moved rather than remembered: accepting puts it in the plan, declining closes
   * it, and either way it stops being backlog work nobody owns. An inbox entry has no state
   * to move, so reading it is the decision.
   */
  const decide = (item: IntakeRow, decision: IntakeDecision) => {
    if (item.task) {
      dispatch({
        type: 'task/patch',
        id: item.task.id,
        patch: { status: intakeStatus(decision), updatedAt: Date.now() },
      });
      notify(decision === 'accepted' ? `Planned ${item.task.key}` : `Closed ${item.task.key}`, {
        tone: decision === 'accepted' ? 'success' : 'default',
      });
      return;
    }
    // An entry with no task is a note about something that happened; both answers read it.
    if (item.entryId) dispatch({ type: 'inbox/read', id: item.entryId, read: true });
    notify(decision === 'accepted' ? 'Kept for the record' : 'Dismissed', { tone: 'default' });
  };

  const snooze = (id: string) => setSnoozedIds((current) => [...current, id]);
  const restore = (id: string) => setSnoozedIds((current) => current.filter((one) => one !== id));
  const queue = intake.filter((item) => !snoozedIds.includes(item.id));
  const snoozed = intake.filter((item) => snoozedIds.includes(item.id));

  return (
    <div className="h-full min-h-0 overflow-y-auto px-7 pb-9">
      <div className="flex w-full flex-col gap-4 pt-4">
        <header className="flex flex-wrap items-center gap-2">
          <SectionLabel>Needs a decision</SectionLabel>
          <span className=" text-meta tabular-nums text-muted">{queue.length}</span>
          {snoozed.length > 0 && (
            <Button size="sm" variant="secondary" className="ml-auto" onPress={() => setSnoozedIds([])}>
              Bring everything back
            </Button>
          )}
        </header>
        <p className="max-w-[70ch] text-body text-muted">
          Accept plans the work, decline closes it. Snooze hides a row until this window closes.
        </p>
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {queue.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: MOTION.duration.micro, ease: MOTION.micro }}
                className="flex items-start gap-3 rounded-2xl bg-surface p-3"
              >
                <ActorMark id={item.actorId} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <InboxKindGlyph kind={item.kind} className="text-muted" />
                    <span className="min-w-0 flex-1 text-body text-foreground">{item.body}</span>
                    <span className="shrink-0 text-meta tabular-nums text-muted">
                      {relativeTime(item.createdAt)}
                    </span>
                  </div>
                  {item.task && (
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'route/go', route: paths.task(item.task!.id) })}
                      className="mt-1 flex min-w-0 items-center gap-2 text-left text-link hover:underline"
                    >
                      <TaskKey task={item.task} className="shrink-0" />
                      <span className="min-w-0 truncate text-body">{item.task.title}</span>
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="primary"
                    className="gap-1"
                    onPress={() => decide(item, 'accepted')}
                  >
                    <Check className="size-3.5" aria-hidden />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    className="gap-1"
                    onPress={() => decide(item, 'declined')}
                  >
                    <Ban className="size-3.5" aria-hidden />
                    Decline
                  </Button>
                  <Button size="sm" variant="ghost" onPress={() => snooze(item.id)}>
                    Snooze
                  </Button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {queue.length === 0 && (
            <div className="rounded-3xl bg-surface p-8 text-center">
              <Check className="mx-auto size-5 text-success" aria-hidden />
              <p className="mt-2 text-body text-muted">
                The queue is clear. Work the agent opens lands here until it has a plan and an owner.
              </p>
            </div>
          )}
        </div>
        {snoozed.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <SectionLabel>Snoozed</SectionLabel>
              <span className=" text-meta tabular-nums text-muted">{snoozed.length}</span>
            </div>
            <ul className="flex flex-col gap-1">
              {snoozed.map((item) => (
                <li key={item.id} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-body text-muted">{item.body}</span>
                  <Button size="sm" variant="ghost" onPress={() => restore(item.id)}>
                    Bring back
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {snoozed.length > 0 && (
          <p className="text-meta text-muted">
            Snoozing is for this window only; the tasks themselves are unchanged.
          </p>
        )}{' '}
      </div>
    </div>
  );
}
