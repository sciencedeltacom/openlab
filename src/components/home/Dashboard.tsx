/**
 * The main menu and workspace dashboard.
 *
 * It opens on the workspace itself: a dark band with the greeting, where you are, and the four
 * numbers you would ask for first — today's spend, the month, the assistant's turns, the work
 * still open. The band carries the pixel arc, the one decorative surface in the app.
 *
 * Below it the same records answer the second question: usage over time, the days the lab
 * actually worked, and what those numbers mean. Charts are nivo through the token theme and
 * every figure comes from the state the list screens read, so the dashboard cannot disagree
 * with the work.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsiveLine } from '@nivo/line';
import { ResponsivePie } from '@nivo/pie';
import { Activity, CalendarDays, Cpu, FileDown, Flame, MoreHorizontal, Timer } from 'lucide-react';

import { IconButton, Menu, MenuItem, PhaseChip, SectionLabel } from '@/components/ui';
import { HexMark, LabLogo, PingDot } from '@/components/brand/Marks';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

import { useApp } from '@/store/app';
import { snapshotWorkspace } from '@/store/workspace';
import { allProviders, type Message, type WorkspaceData } from '@/store/types';
import {
  LABELLED_MARGIN,
  useChartPalette,
  useChartTheme,
  xAxis,
  yAxis,
} from '@/components/research/chartTheme';
import { BarTooltip, LineTooltip, PieTooltip } from '@/components/charts/tooltips';
import { MOTION } from '@/theme/tokens';
import { GrainRing } from './GrainRing';
import { PixelArc } from './PixelArc';

/** One recorded model call, with its token accounting. */
interface Run {
  at: number;
  modelRef: string;
  input: number;
  output: number;
  cached: number;
}

/** A row of chart data, the shape every export expects. */
type Row = Record<string, string | number>;

/** The time of day, so the greeting is a greeting and not a label. */
function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** CSV of a table of rows. */
function toCsv(rows: readonly Row[]): string {
  if (rows.length === 0) {
    return '';
  }
  const columns = Object.keys(rows[0]!);
  const field = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => field(row[column])).join(',')),
  ].join('\n');
}

/** Download a table as CSV, the same gesture the markdown tables offer. */
function exportCsv(name: string, rows: readonly Row[]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * A chart card.
 *
 * The header band carries the title and, on the right, the headline figure and — when the
 * chart has numbers worth keeping — a three-dot that exports them.
 */
function Panel({
  title,
  value,
  hint,
  rows,
  name,
  className,
  children,
}: {
  title: string;
  value: ReactNode;
  hint?: string;
  /** The chart's numbers, exported by the corner menu. */
  rows?: readonly Row[];
  name?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-3 rounded-3xl bg-overlay p-4', className)}>
      <div className="flex items-center gap-2">
        <SectionLabel>{title}</SectionLabel>
        <span className="ml-auto text-title tabular-nums text-foreground">{value}</span>
        {rows && rows.length > 0 && name && (
          <Menu
            label="Chart actions"
            trigger={
              <IconButton aria-label="Chart actions">
                <MoreHorizontal className="size-4" />
              </IconButton>
            }
            onAction={(key) => {
              if (key === 'csv') {
                exportCsv(name, rows);
              }
            }}
          >
            <MenuItem id="csv" icon={<FileDown className="size-4 shrink-0 text-muted" />}>
              Export CSV
            </MenuItem>
          </Menu>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {hint && <p className="text-meta text-muted">{hint}</p>}
    </section>
  );
}

/** One headline number on the dark band. */
function HeroFigure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-meta text-white/45">{label}</span>
      <span className="text-[1.6rem] leading-none font-semibold tracking-tight tabular-nums text-white">
        {value}
      </span>
      {hint && <span className="truncate text-meta text-white/40">{hint}</span>}
    </div>
  );
}

/** A thin share bar. */
function Bar({ share }: { share: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary">
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.min(100, Math.round(share * 100))}%` }}
      />
    </div>
  );
}

const sum = (rows: readonly Run[], key: 'input' | 'output' | 'cached') =>
  rows.reduce((total, row) => total + row[key], 0);

const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);

/** One cell's tint, from how much of the busiest day it carried. */
function heatLevel(tokens: number, peak: number): string {
  if (tokens <= 0) return 'bg-surface-secondary';
  const share = tokens / Math.max(1, peak);
  if (share > 0.7) return 'bg-accent';
  if (share > 0.4) return 'bg-accent/70';
  if (share > 0.15) return 'bg-accent/45';
  return 'bg-accent/25';
}

/**
 * The days the lab actually worked, as squares.
 *
 * Columns are weeks and cells are days; a month is named where it begins and the week is
 * marked on the left, and nothing else is said. The cells grow with the card, so the tile is
 * the activity rather than a small chart sitting in a large tile.
 */
function ActivityHeatmap({ weeks }: { weeks: { date: Date; tokens: number }[][] }) {
  const peak = Math.max(1, ...weeks.flat().map((day) => day.tokens));
  const months: string[] = [];
  let lastMonth = -1;
  for (const week of weeks) {
    const first = week.find((day) => day.date.getDate() === 1);
    const month = first?.date.getMonth() ?? -1;
    if (first && month !== lastMonth) {
      months.push(first.date.toLocaleString('en-US', { month: 'short' }));
      lastMonth = month;
    } else {
      months.push('');
    }
  }

  return (
    <div
      className="flex w-full flex-col gap-1.5"
      role="img"
      aria-label="Daily model usage over the last two quarters"
    >
      <div className="flex h-3 gap-[3px] pl-[24px]">
        {weeks.map((week, index) => (
          <div key={week[0]?.date.toISOString() ?? index} className="relative min-w-0 flex-1">
            {months[index] && (
              <span className="absolute top-0 left-0 text-[9px] whitespace-nowrap text-muted">
                {months[index]}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <div className="flex w-[18px] shrink-0 flex-col justify-between text-[9px] leading-none text-muted">
          <span>Mon</span>
          <span>Wed</span>
          <span>Fri</span>
        </div>
        <div className="flex min-w-0 flex-1 gap-[3px]">
          {weeks.map((week, index) => (
            <div
              key={week[0]?.date.toISOString() ?? index}
              className="flex min-w-0 flex-1 flex-col gap-[3px]"
            >
              {week.map((day) => (
                <span
                  key={day.date.toISOString()}
                  title={`${day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${day.tokens.toLocaleString('en-US')} tokens`}
                  className={cn('aspect-square w-full rounded-[3px]', heatLevel(day.tokens, peak))}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The main menu / dashboard. */
export function Dashboard() {
  const { state, dispatch } = useApp();
  const palette = useChartPalette();
  const theme = useChartTheme();

  const project = state.projects.find((candidate) => candidate.id === state.activeProjectId);

  // Every workspace on the machine, with the active one's live data folded in.
  const sources: WorkspaceData[] = project
    ? state.projects.map((candidate) =>
        candidate.id === project.id ? snapshotWorkspace(state) : candidate.workspace,
      )
    : state.projects.map((candidate) => candidate.workspace);

  const messageMap = new Map<string, Message[]>();
  for (const source of sources) {
    for (const [id, messages] of Object.entries(source.transcripts)) {
      messageMap.set(id, messages);
    }
  }

  const sessions = sources.flatMap((source) => source.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
  const tasks = sources.flatMap((source) => source.tasks);

  const turnsOf = (sessionId: string) =>
    (messageMap.get(sessionId) ?? []).filter((message) => message.role === 'assistant').length;
  const totalTurns = sessions.reduce((count, session) => count + turnsOf(session.id), 0);

  /** Every recorded run, oldest first. */
  const runs = useMemo(() => {
    const records: Run[] = [];
    for (const session of sessions) {
      for (const message of messageMap.get(session.id) ?? []) {
        for (const block of message.blocks) {
          if (block.kind === 'run' && (block.tokensIn || block.tokensOut)) {
            records.push({
              at: message.createdAt,
              modelRef: block.modelRef,
              input: block.tokensIn ?? 0,
              output: block.tokensOut ?? 0,
              cached: block.cachedTokens ?? 0,
            });
          }
        }
      }
    }
    return records.sort((a, b) => a.at - b.at);
  }, [sources, messageMap, sessions]);

  const now = new Date();
  const todayRuns = runs.filter((run) => dayKey(run.at) === dayKey(now.getTime()));
  const monthRuns = runs.filter((run) => {
    const at = new Date(run.at);
    return at.getMonth() === now.getMonth() && at.getFullYear() === now.getFullYear();
  });

  const todayTokens = sum(todayRuns, 'input') + sum(todayRuns, 'output');
  const monthTokens = sum(monthRuns, 'input') + sum(monthRuns, 'output');
  const cachedTokens = sum(runs, 'cached');
  const openTasks = tasks.filter((task) => task.status !== 'done').length;

  /** Zero-filled days, so the axes are drawn even before anything has run. */
  const daysBack = (count: number) => {
    const days: { key: string; label: string; value: number; date: Date }[] = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      days.push({ key: dayKey(date.getTime()), label: date.toISOString().slice(5, 10), value: 0, date });
    }
    return days;
  };

  const usageByDay = daysBack(30);
  const usageIndex = new Map(usageByDay.map((day, index) => [day.key, index]));
  const callsByDay = daysBack(14);
  const callsIndex = new Map(callsByDay.map((day, index) => [day.key, index]));
  for (const run of runs) {
    const at = usageIndex.get(dayKey(run.at));
    if (at !== undefined) usageByDay[at]!.value += run.input + run.output;
    const call = callsIndex.get(dayKey(run.at));
    if (call !== undefined) callsByDay[call]!.value += 1;
  }

  const usageSeries = usageByDay.map((day) => ({ x: day.label, y: day.value }));
  const usageTicks = usageByDay
    .filter((_, index) => index % 5 === 0 || index === usageByDay.length - 1)
    .map((day) => day.label);

  /** Assistant turns per day, the shape of the work rather than of the billing. */
  const turnsByDay = daysBack(14);
  const turnsIndex = new Map(turnsByDay.map((day, index) => [day.key, index]));
  for (const session of sessions) {
    for (const message of messageMap.get(session.id) ?? []) {
      if (message.role !== 'assistant') continue;
      const at = turnsIndex.get(dayKey(message.createdAt));
      if (at !== undefined) turnsByDay[at]!.value += 1;
    }
  }
  const turnsData = turnsByDay.map((day) => ({ day: day.label, turns: day.value }));
  const turnsTicks = turnsByDay.filter((_, index) => index % 2 === 0).map((day) => day.label);

  /** The heatmap: twenty-six weeks, Monday first, ending on the current week. */
  const heatWeeks = useMemo(() => {
    const totals = new Map<string, number>();
    for (const run of runs) {
      const key = dayKey(run.at);
      totals.set(key, (totals.get(key) ?? 0) + run.input + run.output);
    }
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    const start = new Date(end);
    start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 25 * 7);
    const weeks: { date: Date; tokens: number }[][] = [];
    for (let week = 0; week < 26; week += 1) {
      const column: { date: Date; tokens: number }[] = [];
      for (let day = 0; day < 7; day += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + week * 7 + day);
        column.push({ date, tokens: totals.get(dayKey(date.getTime())) ?? 0 });
      }
      weeks.push(column);
    }
    return weeks;
  }, [runs]);

  /** What the ledger means, in four sentences. */
  const insights = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const run of runs) {
      const key = dayKey(run.at);
      perDay.set(key, (perDay.get(key) ?? 0) + run.input + run.output);
    }
    let streak = 0;
    for (let offset = 0; offset < 400; offset += 1) {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      if ((perDay.get(dayKey(date.getTime())) ?? 0) > 0) {
        streak += 1;
      } else if (offset > 0) {
        break;
      }
    }
    let peak = { key: '', tokens: 0 };
    for (const [key, tokens] of perDay) {
      if (tokens > peak.tokens) peak = { key, tokens };
    }
    const perCall =
      runs.length > 0 ? Math.round((sum(runs, 'input') + sum(runs, 'output')) / runs.length) : 0;
    return { streak, peak, perCall };
  }, [runs]);

  const byModel = useMemo(() => {
    const totals = new Map<string, number>();
    for (const run of runs) {
      totals.set(run.modelRef, (totals.get(run.modelRef) ?? 0) + run.input + run.output);
    }
    const all = [...totals.entries()]
      .map(([modelRef, tokens]) => ({ modelRef, tokens }))
      .sort((a, b) => b.tokens - a.tokens);
    const grand = all.reduce((total, entry) => total + entry.tokens, 0) || 1;
    return all.map((entry) => ({ ...entry, share: entry.tokens / grand }));
  }, [runs]);

  const topModel = byModel[0];
  const peakDate = insights.peak.key
    ? new Date(`${insights.peak.key}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : '—';

  const doneTasks = tasks.filter((task) => task.status === 'done').length;
  const openTaskCount = tasks.length - doneTasks;
  const taskSlices = [
    { id: 'Done', value: doneTasks, color: palette.success },
    { id: 'Open', value: openTaskCount, color: palette.surfaceTertiary },
  ];

  /** The right-hand tile: one figure at a time, coming and going. */
  const nowSlides = [
    {
      icon: Flame,
      label: 'Streak',
      value: `${insights.streak} day${insights.streak === 1 ? '' : 's'}`,
      hint: insights.streak > 0 ? 'in a row with calls' : 'no calls yet today',
    },
    {
      icon: CalendarDays,
      label: 'Peak day',
      value: insights.peak.tokens.toLocaleString('en-US'),
      hint: insights.peak.tokens > 0 ? `${peakDate} · tokens in one day` : 'nothing recorded yet',
    },
    {
      icon: Timer,
      label: 'Per call',
      value: insights.perCall.toLocaleString('en-US'),
      hint: 'tokens, on average',
    },
    {
      icon: Cpu,
      label: 'Busiest',
      value: topModel ? `${Math.round(topModel.share * 100)}%` : '—',
      hint: topModel ? topModel.modelRef.split('/').pop()! : 'no model has run yet',
    },
  ];

  /**
   * What the hero says, one line at a time.
   *
   * The greeting comes first — the hour is the first thing a reader can be told — then the
   * numbers, each with the words that make it mean something. The loop is the point: a hero
   * that only ever shows the greeting is a header.
   */
  const slides = [
    {
      kind: 'greeting' as const,
      value: `${greeting()}.`,
      label: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    },
    {
      kind: 'stat' as const,
      value: todayTokens.toLocaleString('en-US'),
      label: `tokens today · ${todayRuns.length} model call${todayRuns.length === 1 ? '' : 's'}`,
    },
    {
      kind: 'stat' as const,
      value: monthTokens.toLocaleString('en-US'),
      label: `tokens this month · ${monthRuns.length} call${monthRuns.length === 1 ? '' : 's'}`,
    },
    {
      kind: 'stat' as const,
      value: totalTurns.toLocaleString('en-US'),
      label: `assistant turns · ${sessions.length} session${sessions.length === 1 ? '' : 's'}`,
    },
    {
      kind: 'stat' as const,
      value: openTasks.toLocaleString('en-US'),
      label: `open tasks · ${tasks.length} tracked`,
    },
  ];
  const [slide, setSlide] = useState(0);
  const still = useMemo(
    () =>
      typeof window === 'undefined'
        ? false
        : (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false),
    [],
  );
  useEffect(() => {
    if (still) {
      return;
    }
    const timer = window.setInterval(() => setSlide((index) => (index + 1) % slides.length), 4200);
    return () => window.clearInterval(timer);
  }, [still, slides.length]);

  const [nowSlide, setNowSlide] = useState(0);
  useEffect(() => {
    if (still) {
      return;
    }
    const timer = window.setInterval(() => setNowSlide((index) => (index + 1) % 4), 3400);
    return () => window.clearInterval(timer);
  }, [still]);

  const recentSessions = sessions.slice(0, 5);
  const projectNames = new Map(state.projects.map((candidate) => [candidate.id, candidate.name]));

  return (
    <div className="h-full overflow-y-auto px-6 pb-8">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
        className="mx-auto grid w-full max-w-[1240px] grid-cols-1 gap-3 pt-5 lg:grid-cols-12"
      >
        {/* The workspace, on its own dark tile. The pixel arc is the only decoration on the page. */}
        <section className="relative overflow-hidden rounded-[28px] bg-[#080b12] lg:col-span-8">
          <div className="absolute inset-0">
            <PixelArc
              baseColor="#123a6b"
              accentColor="#2f7dff"
              highlight="#cfe2ff"
              density={112}
              dotSize={66}
              speed={32}
              arc={{ center: 0.58, thickness: 0.5, drop: 0, falloff: 4 }}
            />
          </div>
          <div className="relative flex h-full min-h-[300px] flex-col px-7 py-7">
            {/* One thing at a time, centred: the greeting first, then what the numbers say. */}
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={slide}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.3, ease: MOTION.signature }}
                  className="flex flex-col items-center gap-2"
                >
                  {slides[slide]!.kind === 'greeting' ? (
                    <span className="font-baskerville text-[3rem] leading-tight text-white [text-shadow:0_2px_28px_rgba(3,6,14,0.75)]">
                      {slides[slide]!.value}
                    </span>
                  ) : (
                    <span className="text-[4rem] leading-none font-semibold tracking-tight tabular-nums text-white [text-shadow:0_2px_32px_rgba(3,6,14,0.8)]">
                      {slides[slide]!.value}
                    </span>
                  )}
                  <span className="text-title text-white/85 [text-shadow:0_1px_16px_rgba(3,6,14,0.9)]">
                    {slides[slide]!.label}
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-center gap-1.5">
              {slides.map((entry, index) => (
                <button
                  key={entry.label}
                  type="button"
                  aria-label={entry.label}
                  aria-current={index === slide}
                  onClick={() => setSlide(index)}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    index === slide ? 'w-5 bg-white/80' : 'w-1.5 bg-white/25 hover:bg-white/40',
                  )}
                />
              ))}
            </div>
          </div>
        </section>

        {/* The figures keep coming, centred, over a ring that runs off the bottom. */}
        <section className="relative flex flex-col overflow-hidden rounded-3xl bg-overlay p-5 lg:col-span-4">
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center pb-[40%] text-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={nowSlide}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28, ease: MOTION.signature }}
                className="flex flex-col items-center"
              >
                <span className="flex items-center gap-1.5 text-meta text-muted">
                  {(() => {
                    const Icon = nowSlides[nowSlide]!.icon;
                    return <Icon className="size-3 shrink-0" aria-hidden />;
                  })()}
                  {nowSlides[nowSlide]!.label}
                </span>
                <span className="mt-2 text-[2.4rem] leading-none font-semibold tracking-tight tabular-nums text-foreground">
                  {nowSlides[nowSlide]!.value}
                </span>
                <span className="mt-2 max-w-[220px] truncate text-meta text-muted">
                  {nowSlides[nowSlide]!.hint}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* A dark window at the foot of the card: its centre sits below the tile, so only
              the top of the ring shows and the rest runs off the bottom. */}
          <div className="pointer-events-none absolute inset-x-3 top-[56%] -bottom-[40%] overflow-hidden rounded-t-[26px]">
            <GrainRing
              background="#080b12"
              baseColor="#1d4c8a"
              accentColor="#5aa2ff"
              highlight="#eaf3ff"
              speed={90}
            />
          </div>
        </section>

        <Panel
          title="Tokens · 30 days"
          value={`${usageByDay.reduce((total, day) => total + day.value, 0).toLocaleString('en-US')} tok`}
          rows={usageByDay.map((day) => ({ day: day.label, tokens: day.value }))}
          name="usage-30-days"
          className="lg:col-span-8"
        >
          <div className="h-[216px]">
            <ResponsiveLine
              data={[{ id: 'tokens', data: usageSeries }]}
              theme={theme}
              margin={LABELLED_MARGIN}
              xScale={{ type: 'point' }}
              yScale={{ type: 'linear', min: 0, max: 'auto' }}
              curve="monotoneX"
              colors={[palette.accent]}
              lineWidth={2}
              enablePoints={false}
              enableArea
              areaOpacity={1}
              defs={[
                {
                  id: 'tokens-fill',
                  type: 'linearGradient',
                  colors: [
                    { offset: 0, color: palette.accent, opacity: 0.34 },
                    { offset: 100, color: palette.accent, opacity: 0 },
                  ],
                  gradientTransform: 'rotate(90)',
                },
              ]}
              fill={[{ match: { id: 'tokens' }, id: 'tokens-fill' }]}
              enableGridX={false}
              axisBottom={xAxis('Day', usageTicks)}
              axisLeft={yAxis('Tokens', (value) => `${Math.round(value / 1000)}k`)}
              enableSlices="x"
              sliceTooltip={({ slice }) => (
                <LineTooltip slice={slice as never} seriesNames={{ tokens: 'Tokens' }} />
              )}
              animate={false}
            />
          </div>
        </Panel>

        <Panel
          title="Assistant turns · 14 days"
          value={`${turnsByDay.reduce((total, day) => total + day.value, 0).toLocaleString('en-US')}`}
          rows={turnsByDay.map((day) => ({ day: day.label, turns: day.value }))}
          name="turns-14-days"
          className="lg:col-span-4"
        >
          <div className="h-[216px]">
            <ResponsiveBar
              data={turnsData}
              theme={theme}
              keys={['turns']}
              indexBy="day"
              margin={LABELLED_MARGIN}
              padding={0.4}
              colors={[palette.accentSecondary]}
              borderRadius={5}
              enableLabel={false}
              enableGridX={false}
              axisBottom={xAxis('Day', turnsTicks)}
              axisLeft={yAxis('Turns')}
              tooltip={(props) => <BarTooltip {...props} seriesNames={{ turns: 'Turns' }} />}
              animate={false}
            />
          </div>
        </Panel>

        <Panel
          title="Activity"
          value={`${insights.streak} day${insights.streak === 1 ? '' : 's'} streak`}
          className="lg:col-span-7"
        >
          <ActivityHeatmap weeks={heatWeeks} />
        </Panel>

        <Panel title="Tasks" value={tasks.length} className="lg:col-span-5">
          {tasks.length === 0 ? (
            <p className="grid h-[150px] place-items-center text-body text-muted">No tasks planned yet.</p>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1">
              {/* A half ring: the whole is the plan, the filled half is what is finished. */}
              <div className="relative h-[112px] w-[224px] overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-[224px]">
                  <ResponsivePie
                    data={taskSlices}
                    theme={theme}
                    margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                    startAngle={-90}
                    endAngle={90}
                    innerRadius={0.76}
                    padAngle={1}
                    cornerRadius={6}
                    colors={({ data }) => String(data.color)}
                    enableArcLinkLabels={false}
                    enableArcLabels={false}
                    tooltip={(props) => <PieTooltip datum={props.datum as never} />}
                    animate={false}
                  />
                </div>
                <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
                  <span className="text-[1.5rem] leading-none font-semibold tracking-tight tabular-nums text-foreground">
                    {doneTasks}
                  </span>
                  <span className="mt-1 text-meta text-muted">of {tasks.length} done</span>
                </div>
              </div>
              <ul className="flex items-center gap-4 pt-1">
                <li className="flex items-center gap-1.5 text-meta text-muted">
                  <span className="size-1.5 rounded-full" style={{ background: palette.success }} />
                  Done
                  <span className="tabular-nums text-foreground">{doneTasks}</span>
                </li>
                <li className="flex items-center gap-1.5 text-meta text-muted">
                  <span className="size-1.5 rounded-full" style={{ background: palette.surfaceTertiary }} />
                  Open
                  <span className="tabular-nums text-foreground">{openTaskCount}</span>
                </li>
              </ul>
            </div>
          )}
        </Panel>

        <Panel
          title="By model"
          value={`${byModel.length} model${byModel.length === 1 ? '' : 's'}`}
          rows={byModel.map((model) => ({
            model: model.modelRef,
            tokens: model.tokens,
            share: Math.round(model.share * 100),
          }))}
          name="usage-by-model"
          className="lg:col-span-5"
        >
          {byModel.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {byModel.map((model) => (
                <div key={model.modelRef} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2 text-meta">
                    <span className="min-w-0 truncate font-mono text-foreground">{model.modelRef}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted">
                      {model.tokens.toLocaleString()} · {Math.round(model.share * 100)}%
                    </span>
                  </div>
                  <Bar share={model.share} />
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-body text-muted">No model calls recorded yet.</p>
          )}
        </Panel>

        <Panel title="Recent sessions" value={`${sessions.length} total`} className="lg:col-span-7">
          {recentSessions.length === 0 ? (
            <p className="grid h-full place-items-center text-body text-muted">No sessions yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {recentSessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'route/go', route: `assistant/${session.id}` })}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start transition-colors hover:bg-surface-secondary"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-foreground">{session.title}</span>
                      <span className="block truncate text-meta text-muted">
                        {projectNames.get(session.projectId) ?? 'Scratch'} · {relativeTime(session.updatedAt)}{' '}
                        · {turnsOf(session.id)} turn
                        {turnsOf(session.id) === 1 ? '' : 's'}
                      </span>
                    </span>
                    <PhaseChip phase={session.phase} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </motion.div>
    </div>
  );
}
