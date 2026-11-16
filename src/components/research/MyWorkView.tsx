/**
 * Everything assigned to the reader.
 *
 * Four buckets, ordered by what needs attention rather than by status: late work first,
 * then work that will be late, then work in motion, then everything else. The header
 * carries the counts so the shape of the week is visible before any scrolling. There is no
 * account yet, so the reader is the first member in the workspace.
 */

import { Chip, ScrollShadow, SectionLabel } from '@/components/ui';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import { isOverdue, type Task } from '@/store/research';
import { addDays, TaskRow, toIso } from './shared';
import { useTaskEdits } from './useTaskEdits';

interface Bucket {
  id: string;
  label: string;
  hint: string;
  color: 'danger' | 'warning' | 'accent' | 'default';
  tasks: Task[];
}

function bucketize(open: Task[]): Bucket[] {
  const weekAhead = toIso(addDays(new Date(), 7));
  const overdue: Task[] = [];
  const dueSoon: Task[] = [];
  const inProgress: Task[] = [];
  const rest: Task[] = [];

  for (const task of open) {
    if (isOverdue(task)) {
      overdue.push(task);
    } else if (task.dueDate !== null && task.dueDate <= weekAhead) {
      dueSoon.push(task);
    } else if (task.status === 'active') {
      inProgress.push(task);
    } else {
      rest.push(task);
    }
  }

  return [
    { id: 'overdue', label: 'Overdue', hint: 'past the due date', color: 'danger', tasks: overdue },
    { id: 'due-soon', label: 'Due soon', hint: 'within seven days', color: 'warning', tasks: dueSoon },
    {
      id: 'in-progress',
      label: 'In progress',
      hint: 'being worked on now',
      color: 'accent',
      tasks: inProgress,
    },
    { id: 'rest', label: 'Everything else', hint: 'open, not urgent yet', color: 'default', tasks: rest },
  ];
}

/** The personal work view. */
export function MyWorkView() {
  const { state, dispatch } = useApp();
  const { tasks: allTasks, actionsFor, modals } = useTaskEdits();
  // There is no account yet, so the reader is the first member in the workspace — the same
  // list the member pickers read. With no members nothing can be assigned to the reader.
  const me = state.members[0] ?? null;
  const open = allTasks.filter(
    (task) =>
      me !== null && task.assigneeId === me.id && task.status !== 'done' && task.status !== 'cancelled',
  );
  const buckets = bucketize(open);

  // My work has no peek of its own, so a row sends the tracker to the task and opens it
  // in the panel there rather than doing nothing.
  const openTask = (taskId: string) => {
    dispatch({ type: 'route/go', route: 'research/tasks' });
    dispatch({ type: 'route/go', route: paths.task(taskId) });
  };

  return (
    <ScrollShadow className="h-full min-h-0 px-7 pb-9">
      <div className="flex w-full flex-col gap-4 pt-4">
        <header className="flex flex-wrap items-center gap-2">
          <SectionLabel>My work</SectionLabel>
          <span className="text-meta text-muted">
            {me ? `${me.name} · ${open.length} open` : 'No team members yet'}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {buckets.map((bucket) => (
              <Chip key={bucket.id} size="sm" variant="soft" color={bucket.color} className="gap-1.5">
                {bucket.label}
                <span className=" text-meta tabular-nums">{bucket.tasks.length}</span>
              </Chip>
            ))}
          </span>
        </header>

        {open.length === 0 && (
          <p className="rounded-3xl bg-surface p-8 text-center text-body text-muted">
            {me ? 'Nothing is assigned to you right now.' : 'Nothing is assigned to you.'}
          </p>
        )}

        {buckets
          .filter((bucket) => bucket.tasks.length > 0)
          .map((bucket) => (
            <section key={bucket.id} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2 px-1">
                <SectionLabel>{bucket.label}</SectionLabel>
                <span className=" text-meta tabular-nums text-muted">{bucket.tasks.length}</span>
                <span className="text-meta text-muted">{bucket.hint}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {bucket.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    actions={actionsFor(task)}
                    onOpen={() => openTask(task.id)}
                  />
                ))}
              </div>
            </section>
          ))}

        {modals}
      </div>
    </ScrollShadow>
  );
}
