/**
 * The inbox feed.
 *
 * Grouped by day because "what happened today" is the only question this screen is
 * opened to answer. Read state is local: the seed is not a store yet, and the one
 * action the header offers is the one everyone reaches for — mark all read.
 */

import { ExternalLink, Inbox, Mail, MailOpen, Trash2 } from 'lucide-react';

import { Button, ScrollShadow, SectionLabel } from '@/components/ui';
import { RowMenu, type RowAction } from '@/components/common/RowMenu';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import type { InboxEntry } from '@/store/research';
import { ActorMark, InboxKindGlyph, TaskKey } from './shared';

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** `Today`, `Yesterday`, or the date. */
function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, today)) {
    return 'Today';
  }
  if (sameDay(date, yesterday)) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** The inbox. */
export function InboxView() {
  const { state, dispatch } = useApp();
  const entries = state.inbox;

  const unread = entries.filter((entry) => !entry.read).length;
  const days: { label: string; entries: InboxEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt);
    const bucket = days.find((candidate) => candidate.label === label);
    if (bucket) {
      bucket.entries.push(entry);
    } else {
      days.push({ label, entries: [entry] });
    }
  }

  const openTask = (taskId: string) => {
    dispatch({ type: 'route/go', route: 'research/tasks' });
    dispatch({ type: 'route/go', route: paths.task(taskId) });
  };

  /** The actions an inbox entry offers: open its task, flip read state, remove it. */
  const actionsFor = (entry: InboxEntry): RowAction[] => {
    const task = state.tasks.find((candidate) => candidate.id === entry.taskId);
    const isUnread = !entry.read;
    const actions: RowAction[] = [];
    if (task) {
      actions.push({ id: 'open', label: 'Open task', icon: ExternalLink, onSelect: () => openTask(task.id) });
    }
    actions.push({
      id: 'read',
      label: isUnread ? 'Mark as read' : 'Mark as unread',
      icon: isUnread ? MailOpen : Mail,
      onSelect: () => dispatch({ type: 'inbox/read', id: entry.id, read: isUnread }),
    });
    actions.push({
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => dispatch({ type: 'inbox/remove', id: entry.id }),
    });
    return actions;
  };

  return (
    <ScrollShadow className="h-full min-h-0 px-7 pb-9">
      <div className="flex w-full flex-col gap-4 pt-4">
        <header className="flex items-center gap-2">
          <SectionLabel>Inbox</SectionLabel>
          <span className=" text-meta tabular-nums text-muted">
            {unread} unread · {entries.length} total
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            isDisabled={unread === 0}
            onPress={() => {
              for (const entry of entries) {
                if (!entry.read) dispatch({ type: 'inbox/read', id: entry.id, read: true });
              }
            }}
          >
            Mark all read
          </Button>
        </header>

        {entries.length === 0 && (
          <div className="grid place-items-center rounded-3xl bg-surface px-6 py-16 text-center">
            <div>
              <Inbox className="mx-auto size-5 text-muted" aria-hidden />
              <p className="mt-2 text-body text-muted">Nothing in the inbox yet.</p>
            </div>
          </div>
        )}

        {days.map((day) => (
          <section key={day.label} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 px-1">
              <span className="text-label text-muted">{day.label}</span>
              <span className=" text-meta tabular-nums text-muted">{day.entries.length}</span>
            </div>

            {day.entries.map((entry) => {
              const task = state.tasks.find((candidate) => candidate.id === entry.taskId);
              const isUnread = !entry.read;
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'group flex items-start gap-3 rounded-2xl p-3 transition-colors',
                    isUnread ? 'bg-accent/5' : 'hover:bg-surface',
                  )}
                >
                  <ActorMark id={entry.actorId} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <InboxKindGlyph kind={entry.kind} className="text-muted" />
                      <span className="min-w-0 flex-1 text-body text-foreground">{entry.body}</span>
                      <span className="shrink-0 text-meta tabular-nums text-muted">
                        {relativeTime(entry.createdAt)}
                      </span>
                      {isUnread && (
                        <span className="size-1.5 shrink-0 rounded-full bg-accent" title="Unread" />
                      )}
                    </div>
                    {task && (
                      <button
                        type="button"
                        onClick={() => openTask(task.id)}
                        className="mt-1 flex min-w-0 items-center gap-2 text-left text-link hover:underline"
                      >
                        <TaskKey task={task} className="shrink-0" />
                        <span className="min-w-0 truncate text-body">{task.title}</span>
                      </button>
                    )}
                  </div>
                  <RowMenu
                    label={`Actions for this entry`}
                    actions={actionsFor(entry)}
                    className="shrink-0"
                  />
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </ScrollShadow>
  );
}
