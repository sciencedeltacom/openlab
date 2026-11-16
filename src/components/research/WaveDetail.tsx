/**
 * A wave's page.
 *
 * A wave is a bounded stretch of time, so the page answers "how much of it is left" before
 * "what is in it": the days are drawn as cells, the one figure that matters is the time left,
 * and the work it carries comes after. The status line is one bar of its own, so the shape of
 * the pipeline is read without a second chart.
 */

import { useState } from 'react';
import { CalendarClock, FileText, Pencil, Trash2 } from 'lucide-react';

import { DateModal, RenameModal, RowMenu, type RowAction } from '@/components/common/RowMenu';
import { Chip, SectionLabel } from '@/components/ui';
import { pathFor } from '@/app/routes';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useApp, usePageTitle } from '@/store/app';
import {
  currentWave,
  STATUS_META,
  WORK_STATUSES,
  type Task,
  type Wave,
  type WorkStatus,
} from '@/store/research';
import { wavePath } from '@/lib/plan/format';
import { rangeLabel, TaskRow } from './shared';
import { Fact, FactGroup, RecordMissing, RecordPage } from './PageShell';
import { RemoveWaveDialog } from './RemoveWaveDialog';
import { DayStrip, daysLeftLabel, waveSchedule } from './waves';

/** A headline number: the figure leads, the words sit under it. */
function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-meta text-muted">{label}</span>
      <span className="mt-1 text-[1.6rem] leading-none font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </span>
      {hint && <span className="mt-1.5 truncate text-meta text-muted">{hint}</span>}
    </div>
  );
}

/** The tasks in one status, as a segment and a legend entry. */
function statusGroups(tasks: readonly Task[]): { status: WorkStatus; tasks: Task[] }[] {
  return WORK_STATUSES.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status),
  })).filter((group) => group.tasks.length > 0);
}

/** The page body, keyed by id so it re-reads cleanly when another wave is opened. */
function WaveDetailBody({ wave }: { wave: Wave }) {
  const [name, setName] = useState(wave.name);
  const [startDate, setStartDate] = useState(wave.startDate);
  const [endDate, setEndDate] = useState(wave.endDate);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [dateField, setDateField] = useState<'startDate' | 'endDate' | null>(null);
  usePageTitle(`W${wave.number} · ${name}`);
  const { state, dispatch } = useApp();
  const tasks = state.tasks.filter((task) => task.waveId === wave.id);
  const done = tasks.filter((task) => task.status === 'done').length;
  const current = { ...wave, name, startDate, endDate };
  const { left, ratio } = waveSchedule(current);
  const isCurrent = currentWave(state.waves)?.id === wave.id;
  const groups = statusGroups(tasks);

  const pageActions: RowAction[] = [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setRenameOpen(true) },
    { id: 'start', label: 'Set start date…', icon: CalendarClock, onSelect: () => setDateField('startDate') },
    { id: 'end', label: 'Set end date…', icon: CalendarClock, onSelect: () => setDateField('endDate') },
    { id: 'remove', label: 'Remove wave', icon: Trash2, danger: true, onSelect: () => setRemoveOpen(true) },
  ];

  return (
    <>
      <RecordPage
        eyebrow={
          <div className="flex w-full items-center gap-2">
            <SectionLabel>Wave</SectionLabel>
            <span className="text-meta tabular-nums text-muted">W{wave.number}</span>
            <RowMenu
              label={`Actions for wave ${wave.number}`}
              actions={pageActions}
              always
              className="ml-auto"
            />
          </div>
        }
        title={name}
        status={
          isCurrent && (
            <Chip size="sm" variant="soft" color="accent">
              Current
            </Chip>
          )
        }
        lede={<p className="max-w-[68ch] text-body leading-relaxed text-foreground/85">{wave.goal}</p>}
        aside={
          <FactGroup>
            <Fact icon={CalendarClock} label="Window">
              {rangeLabel(startDate, endDate)}
            </Fact>
            <Fact icon={FileText} label="File">
              <span className="block truncate font-mono text-meta">{wavePath(current)}</span>
            </Fact>
          </FactGroup>
        }
      >
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <Figure
              label="Days left"
              value={left < 0 ? `${-left}` : String(left)}
              hint={`${Math.round(ratio * 100)}% elapsed`}
            />
            <Figure label="Done" value={`${done}/${tasks.length}`} hint="tasks in this wave" />
            <Figure
              label="Open"
              value={String(tasks.length - done)}
              hint={tasks.length === 0 ? 'nothing planned' : 'still to finish'}
            />
          </div>
          <DayStrip wave={current} className="w-full" />
          <span className="text-meta tabular-nums text-muted">
            {rangeLabel(startDate, endDate)} · {daysLeftLabel(left)}
          </span>
        </section>

        {tasks.length > 0 && (
          <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
            <div className="flex items-baseline gap-2">
              <SectionLabel>Status</SectionLabel>
              <span className="ml-auto text-meta tabular-nums text-muted">{tasks.length} tasks</span>
            </div>
            {/* One bar, one segment per status: the pipeline's shape at a glance. */}
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-secondary">
              {groups.map((group) => (
                <span
                  key={group.status}
                  className={cn('h-full', STATUS_META[group.status].tone)}
                  style={{ width: `${(group.tasks.length / tasks.length) * 100}%` }}
                  aria-hidden
                />
              ))}
            </div>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {groups.map((group) => (
                <li key={group.status} className="flex items-center gap-1.5 text-meta text-muted">
                  <span className={cn('size-1.5 rounded-full', STATUS_META[group.status].tone)} aria-hidden />
                  {STATUS_META[group.status].label}
                  <span className="tabular-nums text-foreground">{group.tasks.length}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <SectionLabel>Tasks</SectionLabel>
            <span className="text-meta tabular-nums text-muted">{tasks.length}</span>
          </div>
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpen={() =>
                  dispatch({
                    type: 'route/go',
                    route: pathFor('research/tasks/:taskId', { taskId: task.id }),
                  })
                }
              />
            ))
          ) : (
            <p className="px-2 text-body text-muted">No task planned into this wave.</p>
          )}
        </section>

        <RenameModal
          open={renameOpen}
          title={`Rename wave W${wave.number}`}
          value={name}
          onClose={() => setRenameOpen(false)}
          onSubmit={(value) => {
            setName(value);
            notify(`Renamed to “${value}”`);
          }}
        />
        {dateField === 'startDate' && (
          <DateModal
            open
            title="Set start date"
            label="Start date"
            value={startDate}
            clearable={false}
            onClose={() => setDateField(null)}
            onSubmit={(value) => {
              // A wave always has a start date, so an empty result is ignored.
              if (value) {
                setStartDate(value);
                notify(`Start date set to ${value}`);
              }
            }}
          />
        )}
        {dateField === 'endDate' && (
          <DateModal
            open
            title="Set end date"
            label="End date"
            value={endDate}
            clearable={false}
            onClose={() => setDateField(null)}
            onSubmit={(value) => {
              // A wave always has an end date, so an empty result is ignored.
              if (value) {
                setEndDate(value);
                notify(`End date set to ${value}`);
              }
            }}
          />
        )}
      </RecordPage>
      <RemoveWaveDialog
        wave={removeOpen ? wave : null}
        onClose={() => setRemoveOpen(false)}
        onRemoved={() => dispatch({ type: 'route/go', route: 'research/waves' })}
      />
    </>
  );
}

/** A wave's page; an unknown id gets the shared not-found state. */
export function WaveDetail({ waveId }: { waveId: string }) {
  const { state } = useApp();
  const wave = state.waves.find((candidate) => candidate.id === waveId);
  if (!wave) {
    return <RecordMissing what="wave" back="research/waves" backLabel="Waves" />;
  }
  return <WaveDetailBody key={wave.id} wave={wave} />;
}
