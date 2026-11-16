/**
 * The tracker's list layout.
 *
 * One row per task, grouped by whichever key the toolbar chose. The row is dense on
 * purpose: a researcher scans a hundred of these looking for the two that are late, so
 * priority, status and due date sit in fixed columns and never move between rows.
 */

import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';

import { ScrollShadow, SectionLabel } from '@/components/ui';
import { filterTasks, STATUS_META, type WorkStatus } from '@/store/research';
import { useApp } from '@/store/app';
import { cn } from '@/lib/cn';
import { groupTasks, sortTasks, TaskRow } from './shared';
import { useTaskEdits } from './useTaskEdits';

/** The status's own icon, at the size a group heading wants. */
function StatusIcon({ status }: { status: WorkStatus }) {
  const Icon = STATUS_META[status].icon;
  return <Icon className="size-3.5 shrink-0" aria-hidden />;
}

/** The task list. */
export function TaskList() {
  const { state } = useApp();
  const { tasks: allTasks, actionsFor, modals } = useTaskEdits();
  const tasks = useMemo(() => filterTasks(allTasks, state.taskFilter), [allTasks, state.taskFilter]);
  const groups = useMemo(
    () => groupTasks(sortTasks(tasks, state.taskSort), state.taskGroupBy, state.members),
    [tasks, state.taskSort, state.taskGroupBy],
  );

  return (
    <ScrollShadow className="flex h-full min-h-0 flex-col px-4 pb-8">
      {tasks.length === 0 && (
        <div className="grid flex-1 place-items-center py-16 text-center">
          <div>
            <ListChecks className="mx-auto size-5 text-muted" />
            <p className="mt-2 text-body text-muted">
              {state.tasks.length === 0
                ? 'No tasks yet. Start one from the toolbar.'
                : 'No task matches the current filter.'}
            </p>
          </div>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.id} className="mt-4 first:mt-2">
          <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur">
            {/* Grouped by status, the heading *is* a status, and it should look like one:
                the same icon and tint it wears in the board, the filter and the record. */}
            {state.taskGroupBy === 'status' ? (
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label',
                  STATUS_META[group.id as WorkStatus].chip,
                )}
              >
                <StatusIcon status={group.id as WorkStatus} />
                {group.label}
              </span>
            ) : (
              <SectionLabel>{group.label}</SectionLabel>
            )}
            <span className="text-meta tabular-nums text-muted">{group.tasks.length}</span>
          </header>
          <div className="flex flex-col gap-0.5">
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} actions={actionsFor(task)} />
            ))}
          </div>
        </section>
      ))}

      {modals}
    </ScrollShadow>
  );
}
