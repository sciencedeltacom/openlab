/**
 * Waves: the bounded stretches of experiment time.
 *
 * The page is a timeline, not a pile of cards. Each wave is one entry on a single rail, so the
 * cycles read as a rhythm — what is behind, what today sits in, what is still planned — and the
 * one wave that covers today is the only entry given a surface of its own. A wave's days are
 * drawn as cells, because counting them is how a reader answers "how much time is left".
 */

import { useState } from 'react';
import { ArrowUpRight, CalendarClock, Pencil, Plus, Trash2, Waves } from 'lucide-react';

import { DateModal, RenameModal, RowMenu, type RowAction } from '@/components/common/RowMenu';
import { Button, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { pathFor, paths } from '@/app/routes';
import { useApp } from '@/store/app';
import { currentWave, STATUS_META, type Task, type Wave } from '@/store/research';
import { RemoveWaveDialog } from './RemoveWaveDialog';
import { StatusDot, TaskKey, rangeLabel } from './shared';
import { DayStrip, daysLeftLabel, waveSchedule } from './waves';

/** The tasks a wave carries, in the order the tracker keeps them. */
function tasksOf(tasks: readonly Task[], waveId: string): Task[] {
  return tasks.filter((task) => task.waveId === waveId);
}

/** A compact task row: status, key, title. The wave's own page has the full one. */
function TaskPreview({ task }: { task: Task }) {
  const { dispatch } = useApp();
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'route/go', route: paths.task(task.id) })}
      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-secondary"
    >
      <StatusDot status={task.status} />
      <TaskKey task={task} className="w-[58px] shrink-0" />
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{task.title}</span>
    </button>
  );
}

/** One wave on the rail. The wave covering today is the only one that carries a surface. */
function WaveEntry({ wave, isCurrent, actions }: { wave: Wave; isCurrent: boolean; actions: RowAction[] }) {
  const { state, dispatch } = useApp();
  const { left } = waveSchedule(wave);
  const tasks = tasksOf(state.tasks, wave.id);
  const done = tasks.filter((task) => task.status === 'done').length;
  const over = left < 0;
  const open = paths.wave(wave.id);

  return (
    <li className="relative ps-10">
      {/* The rail: one line down the list, one mark per cycle. */}
      <span className="absolute inset-y-0 start-[11px] w-px bg-separator" aria-hidden />
      <span
        className={cn(
          'absolute start-0 top-4 z-10 grid size-6 place-items-center rounded-full border text-[10px] font-medium tabular-nums',
          isCurrent
            ? 'border-accent bg-accent text-accent-foreground'
            : 'border-separator bg-surface text-muted',
        )}
        aria-hidden
      >
        {wave.number}
      </span>

      <div className={cn('flex flex-col gap-3', isCurrent ? 'mb-3 rounded-3xl bg-surface p-4' : 'py-4')}>
        <header className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: 'route/go', route: open })}
            className="min-w-0 flex-1 text-start"
          >
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-meta tabular-nums text-muted">W{wave.number}</span>
              <span
                className={cn('min-w-0 truncate text-foreground', isCurrent ? 'text-title' : 'text-body')}
              >
                {wave.name}
              </span>
              {isCurrent && (
                <span className="flex items-center gap-1 text-meta text-accent">
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                  current
                </span>
              )}
            </span>
            <span className="mt-1 block truncate text-meta text-muted">
              {rangeLabel(wave.startDate, wave.endDate)}
              {' · '}
              <span className={cn(over && 'text-danger')}>{daysLeftLabel(left)}</span>
            </span>
          </button>
          <RowMenu label={`Actions for wave ${wave.number}`} actions={actions} className="shrink-0" />
        </header>

        {isCurrent && wave.goal && (
          <p className="max-w-[64ch] text-body leading-relaxed text-muted">{wave.goal}</p>
        )}

        <div className="flex items-center gap-3">
          <DayStrip wave={wave} className={cn('min-w-0 flex-1', isCurrent && 'h-4')} />
          <span className="shrink-0 text-meta tabular-nums text-muted">
            {done}/{tasks.length} done
          </span>
        </div>

        {isCurrent && tasks.length > 0 && (
          <div className="flex flex-col gap-0.5 pt-0.5">
            {tasks.slice(0, 4).map((task) => (
              <TaskPreview key={task.id} task={task} />
            ))}
            {tasks.length > 4 && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'route/go', route: open })}
                className="flex items-center gap-1 px-1.5 pt-1 text-meta text-muted transition-colors hover:text-foreground"
              >
                {tasks.length - 4} more
                <ArrowUpRight className="size-3" aria-hidden />
              </button>
            )}
          </div>
        )}

        {!isCurrent && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'route/go', route: open })}
            className="flex w-fit items-center gap-1 text-meta text-muted transition-colors hover:text-foreground"
          >
            {tasks.length === 0 ? 'Nothing planned yet' : `${tasks.length} tasks · open`}
            <ArrowUpRight className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

/** The waves list. */
export function WaveList() {
  const { state, dispatch } = useApp();
  const waves = [...state.waves].sort((a, b) => b.number - a.number);
  const current = currentWave(state.waves);
  const [renameTarget, setRenameTarget] = useState<Wave | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Wave | null>(null);
  const [dateEdit, setDateEdit] = useState<{ id: string; field: 'startDate' | 'endDate' } | null>(null);

  const dateWave = dateEdit ? waves.find((wave) => wave.id === dateEdit.id) : undefined;

  // Opening a wave is a page, not an instant record: the name, the goal and the window are
  // decided before anything is written.
  const create = () => dispatch({ type: 'route/go', route: 'research/waves/new' });

  const actionsFor = (wave: Wave): RowAction[] => [
    {
      id: 'open',
      label: 'View details',
      icon: ArrowUpRight,
      onSelect: () => dispatch({ type: 'route/go', route: paths.wave(wave.id) }),
    },
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setRenameTarget(wave) },
    {
      id: 'start',
      label: 'Set start date…',
      icon: CalendarClock,
      onSelect: () => setDateEdit({ id: wave.id, field: 'startDate' }),
    },
    {
      id: 'end',
      label: 'Set end date…',
      icon: CalendarClock,
      onSelect: () => setDateEdit({ id: wave.id, field: 'endDate' }),
    },
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => setRemoveTarget(wave),
    },
  ];

  const currentTasks = current ? tasksOf(state.tasks, current.id) : [];
  const summary = current
    ? `${daysLeftLabel(waveSchedule(current).left)} in W${current.number} · ${currentTasks.filter((task) => task.status === 'done').length}/${currentTasks.length} tasks done`
    : waves.length > 0
      ? 'No wave covers today.'
      : 'A wave is a bounded stretch of the plan.';

  return (
    <div className="h-full min-h-0 overflow-y-auto px-7 pb-10">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-1 pt-5">
        <header className="flex items-center gap-2">
          <SectionLabel>Waves</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{waves.length}</span>
          <Button size="sm" variant="primary" className="ml-auto gap-1.5" onPress={create}>
            <Plus className="size-3.5" />
            New wave
          </Button>
        </header>
        <p className="pb-3 text-meta text-muted">{summary}</p>

        {waves.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface p-10 text-center">
            <Waves className="size-5 text-muted" aria-hidden />
            <div>
              <p className="text-body text-foreground">No wave yet.</p>
              <p className="text-meta text-muted">
                Open one to give the next stretch of work a window and a goal.
              </p>
            </div>
            <Button size="sm" variant="secondary" onPress={create}>
              Open a wave
            </Button>
          </div>
        ) : (
          <ol className="flex flex-col">
            {waves.map((wave) => (
              <WaveEntry
                key={wave.id}
                wave={wave}
                isCurrent={current?.id === wave.id}
                actions={actionsFor(wave)}
              />
            ))}
          </ol>
        )}
      </div>

      <RemoveWaveDialog wave={removeTarget} onClose={() => setRemoveTarget(null)} />

      <RenameModal
        open={renameTarget !== null}
        title={`Rename wave W${renameTarget?.number ?? ''}`}
        value={renameTarget?.name ?? ''}
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => {
          if (renameTarget) dispatch({ type: 'wave/patch', id: renameTarget.id, patch: { name } });
        }}
      />

      {dateWave && dateEdit && (
        <DateModal
          open
          title={dateEdit.field === 'startDate' ? 'Set start date' : 'Set end date'}
          label={dateEdit.field === 'startDate' ? 'Start date' : 'End date'}
          value={dateWave[dateEdit.field]}
          clearable={false}
          onClose={() => setDateEdit(null)}
          onSubmit={(value) => {
            // A wave always has both dates, so an empty result is ignored.
            if (value) {
              dispatch({
                type: 'wave/patch',
                id: dateWave.id,
                patch: { [dateEdit.field]: value },
              });
            }
          }}
        />
      )}
    </div>
  );
}
