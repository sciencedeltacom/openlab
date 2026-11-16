/**
 * Open a wave.
 *
 * A page, not an instant record: a wave is a name, a goal and a window, and opening one with
 * placeholder values only means renaming it two minutes later. The number is assigned from the
 * plan, so the page shows it rather than asking for it.
 */

import { useState } from 'react';
import { ArrowLeft, CalendarRange } from 'lucide-react';

import { Button, DateInput, Input, ScrollShadow, SectionLabel, TextArea } from '@/components/ui';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import { newWave } from '@/store/research';

const DAY_MS = 86_400_000;

/** Whole days in a window, counting both ends. */
function daysBetween(start: string, end: string): number | null {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / DAY_MS) + 1;
}

export function WaveCreate() {
  const { state, dispatch } = useApp();
  // The draft is built once: the number and the default window are the plan's answer, not
  // something to re-derive while the reader types.
  const [draft] = useState(() => newWave(state.waves));
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState(draft.startDate);
  const [endDate, setEndDate] = useState(draft.endDate);

  const days = daysBetween(startDate, endDate);
  const badWindow = days === null || days < 1;
  const canCreate = name.trim().length > 0 && !badWindow;

  const leave = () => dispatch({ type: 'route/go', route: 'research/waves' });
  const create = () => {
    if (!canCreate) return;
    const wave = {
      ...draft,
      name: name.trim(),
      goal: goal.trim(),
      startDate,
      endDate,
    };
    dispatch({ type: 'wave/create', wave });
    dispatch({ type: 'route/go', route: paths.wave(wave.id) });
  };

  return (
    <ScrollShadow className="h-full">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-7 py-7">
        <header className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="w-fit gap-1.5" onPress={leave}>
            <ArrowLeft className="size-3.5" />
            Waves
          </Button>
          <div className="flex items-baseline gap-2">
            <h1 className="text-[1.5rem] font-semibold text-foreground">New wave</h1>
            <span className="text-meta tabular-nums text-muted">W{draft.number}</span>
          </div>
          <p className="max-w-[70ch] text-body text-muted">
            A bounded stretch of work: what it is for, and the days it covers.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>The window</SectionLabel>
          <div className="grid grid-cols-2 gap-4">
            <DateInput
              label="Start date"
              value={startDate}
              clearable={false}
              onChange={(value) => value && setStartDate(value)}
            />
            <DateInput
              label="End date"
              value={endDate}
              clearable={false}
              onChange={(value) => value && setEndDate(value)}
            />
          </div>
          <p className={badWindow ? 'text-meta text-danger' : 'text-meta text-muted'}>
            {badWindow
              ? 'The end date must be on or after the start date.'
              : `${days} day${days === 1 ? '' : 's'}, counting both ends.`}
          </p>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>What it is for</SectionLabel>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Dose response, first pass"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Goal</span>
            <TextArea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="What should be true when this wave closes?"
              rows={4}
            />
          </label>
        </section>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onPress={leave}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!canCreate} onPress={create}>
            <CalendarRange className="size-4" aria-hidden />
            Create wave
          </Button>
        </div>
      </div>
    </ScrollShadow>
  );
}
