/**
 * The tracker's timeline layout.
 *
 * A gantt over the current wave. The axis is the wave's window, widened when a task's
 * bar falls outside it, so nothing is ever clipped: the grid scrolls sideways instead.
 * Rows are grouped by status because a due date only means something next to its neighbours.
 */

import { useMemo, type ReactNode } from 'react';

import { ScrollShadow, SectionLabel } from '@/components/ui';
import { RowMenu } from '@/components/common/RowMenu';
import { cn } from '@/lib/cn';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import { currentWave, filterTasks, type Task, type Wave, type WorkStatus } from '@/store/research';
import { useTaskEdits } from './useTaskEdits';
import {
  addDays,
  DAY_MS,
  dayLabel,
  daysBetween,
  groupTasks,
  parseDay,
  sortTasks,
  toIso,
  KindGlyph,
  TaskKey,
} from './shared';

/** Width of the fixed label column, in pixels. */
const LABEL_WIDTH = 264;

/** A bar's fill per status. Tone alone carries the state; nothing is lettered twice. */
const BAR_TINT: Record<WorkStatus, string> = {
  backlog: 'bg-muted/40',
  planned: 'bg-warning/70',
  active: 'bg-accent/80',
  review: 'bg-accent-secondary/70',
  blocked: 'bg-danger/80',
  done: 'bg-success/70',
  cancelled: 'bg-muted/30',
};

interface Domain {
  start: number;
  end: number;
  today: number;
  wave: { start: number; end: number } | null;
}

/** The span the axis covers: the wave window, widened to fit every bar and today. */
function timelineDomain(tasks: readonly Task[], waves: readonly Wave[]): Domain {
  const now = new Date();
  const wave = currentWave(waves);
  let start = (wave ? parseDay(wave.startDate) : addDays(now, -21)).getTime();
  let end = (wave ? parseDay(wave.endDate) : addDays(now, 21)).getTime();

  for (const task of tasks) {
    if (!task.dueDate) {
      continue;
    }
    const due = parseDay(task.dueDate).getTime();
    start = Math.min(start, due - (task.estimate ?? 3) * DAY_MS);
    end = Math.max(end, due);
  }
  start = Math.min(start, now.getTime()) - DAY_MS;
  end = Math.max(end, now.getTime()) + DAY_MS;

  return {
    start,
    end,
    today: now.getTime(),
    wave: wave ? { start: parseDay(wave.startDate).getTime(), end: parseDay(wave.endDate).getTime() } : null,
  };
}

/** Mondays inside the domain, for the week header and the gridlines. */
function weekTicks(domain: Domain): number[] {
  const first = new Date(domain.start);
  first.setDate(first.getDate() + ((8 - first.getDay()) % 7));
  const ticks: number[] = [];
  for (let time = first.getTime(); time <= domain.end; time = addDays(new Date(time), 7).getTime()) {
    ticks.push(time);
  }
  return ticks;
}

function TrackBackground({
  domain,
  ticks,
  children,
}: {
  domain: Domain;
  ticks: number[];
  children?: ReactNode;
}) {
  const percent = (time: number) => ((time - domain.start) / (domain.end - domain.start)) * 100;
  return (
    <>
      {domain.wave && (
        <span
          aria-hidden
          className="absolute inset-y-0 bg-accent/5"
          style={{
            left: `${percent(domain.wave.start)}%`,
            width: `${percent(domain.wave.end) - percent(domain.wave.start)}%`,
          }}
        />
      )}
      {ticks.map((tick) => (
        <span
          key={tick}
          aria-hidden
          className="absolute inset-y-0 w-px bg-surface-tertiary"
          style={{ left: `${percent(tick)}%` }}
        />
      ))}
      <span
        aria-hidden
        className="absolute inset-y-0 w-px bg-danger/60"
        style={{ left: `${percent(domain.today)}%` }}
      />
      {children}
    </>
  );
}

/** The gantt. */
export function TaskTimeline() {
  const { state, dispatch } = useApp();
  const { tasks: allTasks, actionsFor, modals } = useTaskEdits();
  const tasks = useMemo(
    () => filterTasks(allTasks, state.taskFilter).filter((task) => task.dueDate !== null),
    [allTasks, state.taskFilter],
  );
  const groups = useMemo(
    () => groupTasks(sortTasks(tasks, 'due'), 'status', state.members),
    [tasks, state.members],
  );
  const domain = useMemo(() => timelineDomain(tasks, state.waves), [tasks, state.waves]);
  const ticks = useMemo(() => weekTicks(domain), [domain]);
  const trackWidth = Math.max(720, daysBetween(domain.start, domain.end) * 9);
  const percent = (time: number) => ((time - domain.start) / (domain.end - domain.start)) * 100;

  return (
    <ScrollShadow className="h-full min-h-0">
      <div style={{ minWidth: trackWidth + LABEL_WIDTH }}>
        <header className="sticky top-0 z-20 flex bg-background/90 backdrop-blur">
          <div className="shrink-0 px-4 py-2" style={{ width: LABEL_WIDTH }}>
            <SectionLabel>Task</SectionLabel>
          </div>
          <div className="relative h-9 shrink-0" style={{ width: trackWidth }}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute top-1/2 -translate-y-1/2 pl-1 text-meta tabular-nums text-muted"
                style={{ left: `${percent(tick)}%` }}
              >
                {dayLabel(toIso(new Date(tick)))}
              </span>
            ))}
          </div>
        </header>

        {tasks.length === 0 && (
          <p className="px-4 py-10 text-center text-body text-muted">
            No task with a due date matches the current filter.
          </p>
        )}

        {groups.map((group) => (
          <section key={group.id}>
            <div className="flex items-center bg-surface">
              <div className="shrink-0 px-4 py-1.5" style={{ width: LABEL_WIDTH }}>
                <SectionLabel>{group.label}</SectionLabel>
              </div>
              <div className="relative h-8 shrink-0" style={{ width: trackWidth }}>
                <TrackBackground domain={domain} ticks={ticks} />
              </div>
            </div>

            {group.tasks.map((task) => {
              const due = parseDay(task.dueDate!).getTime();
              const start = Math.max(domain.start, due - (task.estimate ?? 3) * DAY_MS);
              const left = percent(start);
              const width = Math.max(0.6, percent(due) - left);
              return (
                <div key={task.id} className="group relative flex items-center hover:bg-surface/60">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'route/go', route: paths.task(task.id) })}
                    className="flex min-w-0 shrink-0 items-center gap-2 px-4 py-1.5 text-left"
                    style={{ width: LABEL_WIDTH }}
                  >
                    <KindGlyph kind={task.kind} className="shrink-0" />
                    <TaskKey task={task} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate pr-6 text-body text-foreground">
                      {task.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'route/go', route: paths.task(task.id) })}
                    className="relative h-9 shrink-0"
                    style={{ width: trackWidth }}
                    title={`${task.key} · ${task.title} · due ${dayLabel(task.dueDate!)}`}
                  >
                    <TrackBackground domain={domain} ticks={ticks}>
                      <span
                        className={cn(
                          'absolute top-1/2 h-3 -translate-y-1/2 rounded-full',
                          BAR_TINT[task.status],
                        )}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    </TrackBackground>
                  </button>
                  <div className="absolute top-1/2 z-10 -translate-y-1/2" style={{ left: LABEL_WIDTH - 32 }}>
                    <RowMenu label={`Actions for ${task.key}`} actions={actionsFor(task)} />
                  </div>
                </div>
              );
            })}
          </section>
        ))}

        <div className="flex items-center py-2">
          <div className="shrink-0 px-4" style={{ width: LABEL_WIDTH }}>
            <span className=" text-meta tabular-nums text-muted">
              {tasks.length} task{tasks.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="h-1" style={{ width: trackWidth }} />
        </div>
      </div>
      {modals}
    </ScrollShadow>
  );
}
