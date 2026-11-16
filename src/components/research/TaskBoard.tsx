/**
 * The tracker's board layout.
 *
 * One column per working status. Cards carry the same facts as a list row, arranged
 * vertically so a column can be read as a queue; motion layout keeps a card's identity
 * visible when a filter changes which column it sits in.
 */

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import {
  byStatus,
  filterTasks,
  STATUS_META,
  WORK_STATUSES,
  type WorkStatus,
  type Task,
} from '@/store/research';
import { ScrollShadow } from '@/components/ui';
import { RowMenu, type RowAction } from '@/components/common/RowMenu';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import { MOTION } from '@/theme/tokens';
import { DueDate, KindGlyph, LabelDots, MemberAvatar, PriorityGlyph, TaskKey } from './shared';
import { useTaskEdits } from './useTaskEdits';
import { cn } from '@/lib/cn';

/** The status's own icon, at the size a column header wants. */
function StatusIcon({ status }: { status: WorkStatus }) {
  const Icon = STATUS_META[status].icon;
  return <Icon className="size-3.5 shrink-0" aria-hidden />;
}

function BoardCard({ task, actions }: { task: Task; actions?: RowAction[] }) {
  const { dispatch } = useApp();
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => dispatch({ type: 'route/go', route: paths.task(task.id) })}
        className={cn(
          'w-full rounded-2xl bg-surface p-3 pr-9 text-left transition-colors hover:bg-surface-tertiary',
        )}
      >
        <div className="flex items-center gap-2">
          <KindGlyph kind={task.kind} />
          <TaskKey task={task} />
        </div>
        <p className="mt-1.5 line-clamp-2 text-body text-foreground">{task.title}</p>
        <LabelDots task={task} className="mt-1.5 flex-wrap" />
        <div className="mt-2.5 flex items-center gap-2">
          <PriorityGlyph priority={task.priority} />
          <MemberAvatar id={task.assigneeId} />
          <span className=" text-meta tabular-nums text-muted">
            {task.estimate !== null ? `${task.estimate}d` : ''}
          </span>
          <span className="ml-auto">
            <DueDate task={task} />
          </span>
        </div>
      </button>
      {actions && (
        <div className="absolute right-1.5 top-1.5 z-10">
          <RowMenu label={`Actions for ${task.key}`} actions={actions} />
        </div>
      )}
    </div>
  );
}

function Column({
  status,
  tasks,
  actionsFor,
}: {
  status: WorkStatus;
  tasks: Task[];
  actionsFor: (task: Task) => RowAction[];
}) {
  return (
    <section className="flex w-[276px] shrink-0 flex-col">
      <header className="flex items-center gap-2 px-1.5 py-2">
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label',
            STATUS_META[status].chip,
          )}
        >
          <StatusIcon status={status} />
          {STATUS_META[status].label}
        </span>
        <span className="text-meta tabular-nums text-muted">{tasks.length}</span>
      </header>
      <ScrollShadow className="flex min-h-0 flex-1 flex-col gap-1.5 px-0.5 pb-3">
        <AnimatePresence initial={false}>
          {tasks.map((task) => (
            <motion.div
              key={task.id}
              layout
              layoutId={task.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: MOTION.duration.micro, ease: MOTION.micro }}
            >
              <BoardCard task={task} actions={actionsFor(task)} />
            </motion.div>
          ))}
        </AnimatePresence>
        {tasks.length === 0 && <p className="px-1.5 py-2 text-meta text-muted">Nothing here.</p>}
      </ScrollShadow>
    </section>
  );
}

/** The kanban board. */
export function TaskBoard() {
  const { state } = useApp();
  const { tasks: allTasks, actionsFor, modals } = useTaskEdits();
  const tasks = useMemo(() => filterTasks(allTasks, state.taskFilter), [allTasks, state.taskFilter]);
  const groups = useMemo(() => byStatus(tasks), [tasks]);
  const columns = WORK_STATUSES.filter((status) => status !== 'cancelled' || groups.cancelled.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 pt-1">
        {columns.map((status) => (
          <Column key={status} status={status} tasks={groups[status]} actionsFor={actionsFor} />
        ))}
      </div>
      {modals}
    </div>
  );
}
