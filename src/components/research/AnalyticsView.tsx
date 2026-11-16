/**
 * Analytics over the tracker.
 *
 * The charts are nivo. A dashboard is the one surface where hand-drawn SVG stops paying for
 * itself: axes, scales, tooltips, legends and hover crosshairs are the parts a reader
 * expects to behave, and they are exactly the parts that are tedious to get right.
 *
 * The numbers come from the same helpers the list screens use, so the dashboard cannot
 * drift from the tracker it describes.
 */

import { useMemo } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsiveLine } from '@nivo/line';

import { LineTooltip } from '@/components/charts/tooltips';
import { ResponsivePie } from '@nivo/pie';

import { SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import { KIND_META, STATUS_META, TASK_KINDS, WORK_STATUSES, isOverdue } from '@/store/research';
import { useChartPalette, useChartTheme, xAxis, yAxis } from './chartTheme';

/**
 * One horizontal bar datum.
 *
 * nivo wants a flat record with an index and one value key, and its generic requires an
 * index signature — hence the explicit one rather than a narrower interface.
 */
interface BarDatum {
  label: string;
  value: number;
  color: string;
  [key: string]: string | number;
}

/** A titled card. Every chart on the surface is one of these. */
function ChartCard({
  title,
  value,
  hint,
  children,
  className,
}: {
  title: string;
  value: string | number;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3 rounded-3xl bg-surface p-4', className)}>
      <div className="flex items-baseline gap-2">
        <SectionLabel>{title}</SectionLabel>
        <span className="ml-auto text-title tabular-nums text-foreground">{value}</span>
      </div>
      {children}
      {hint && <p className="text-meta text-muted">{hint}</p>}
    </section>
  );
}

/** A horizontal bar chart. Labels read left to right, so long status names fit. */
function BarChart({ data }: { data: BarDatum[] }) {
  const theme = useChartTheme();
  // One row is about 26px; a fixed height leaves a gap in a short chart and clips a tall one.
  const height = data.length * 26 + 12;
  return (
    <div style={{ height }}>
      <ResponsiveBar
        data={data}
        keys={['value']}
        indexBy="label"
        layout="horizontal"
        margin={{ top: 4, right: 30, bottom: 4, left: 96 }}
        padding={0.32}
        colors={({ data: datum }) => String(datum.color)}
        borderRadius={6}
        labelPosition="end"
        labelOffset={7}
        labelSkipWidth={0}
        enableGridX
        enableGridY={false}
        axisTop={null}
        axisRight={null}
        axisBottom={null}
        axisLeft={{ tickSize: 0, tickPadding: 8 }}
        theme={theme}
        animate={false}
        tooltip={({ data: datum }) => (
          <div className="rounded-xl bg-overlay px-2.5 py-1.5 text-body shadow-lg">
            {datum.label}: <span className=" tabular-nums">{datum.value}</span>
          </div>
        )}
      />
    </div>
  );
}

/** Tasks carried and finished per wave, as two lines. */
function ThroughputChart({ points }: { points: { label: string; total: number; done: number }[] }) {
  const theme = useChartTheme();
  const palette = useChartPalette();

  const series = useMemo(
    () => [
      { id: 'Carried', data: points.map((point) => ({ x: point.label, y: point.total })) },
      { id: 'Done', data: points.map((point) => ({ x: point.label, y: point.done })) },
    ],
    [points],
  );

  return (
    <div className="flex flex-col gap-2">
      <Legend
        items={[
          { label: 'Carried', color: palette.accent },
          { label: 'Done', color: palette.success },
        ]}
      />
      <div className="h-[132px]">
        <ResponsiveLine
          data={series}
          margin={{ top: 8, right: 14, bottom: 42, left: 46 }}
          xScale={{ type: 'point' }}
          yScale={{ type: 'linear', min: 0, max: 'auto' }}
          curve="monotoneX"
          colors={[palette.accent, palette.success]}
          lineWidth={2}
          pointSize={8}
          pointBorderWidth={2}
          pointBorderColor={{ from: 'serieColor' }}
          enableArea={false}
          enableGridX={false}
          axisBottom={xAxis('Wave')}
          axisLeft={yAxis('Tasks')}
          enableSlices="x"
          sliceTooltip={({ slice }) => <LineTooltip slice={slice as never} />}
          theme={theme}
          animate={false}
        />
      </div>
    </div>
  );
}

/** A small legend rendered by us, so it sits where the card needs it rather than where nivo puts it. */
function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-meta text-muted">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A single proportion as a ring.
 *
 * Two segments of a donut, with the number in the hole. nivo's RadialBar is the wrong tool:
 * it is a bar chart in polar coordinates, complete with its own angular axis, which is not
 * what a share of a whole is.
 */
function Gauge({ percent, color, caption }: { percent: number; color: string; caption?: string }) {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const value = Math.max(0, Math.min(100, percent));
  // A zero segment would render as a hairline arc, which reads as "a little" rather than
  // "none". At zero the ring is simply the track.
  const segments =
    value === 0
      ? [{ id: 'rest', label: 'rest', value: 100, color: palette.surfaceTertiary }]
      : [
          { id: 'value', label: 'value', value, color },
          { id: 'rest', label: 'rest', value: 100 - value, color: palette.surfaceTertiary },
        ];

  return (
    <div className="relative grid h-[148px] place-items-center">
      <div className="size-[132px]">
        <ResponsivePie
          data={segments}
          margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
          innerRadius={0.72}
          padAngle={0}
          cornerRadius={0}
          startAngle={-90}
          endAngle={270}
          sortByValue={false}
          colors={({ data: datum }) => String(datum.color)}
          enableArcLinkLabels={false}
          enableArcLabels={false}
          theme={theme}
          animate={false}
        />
      </div>
      <div className="pointer-events-none absolute grid place-items-center text-center">
        <span className=" text-title tabular-nums text-foreground">{Math.round(value)}%</span>
        {caption && <span className="text-meta text-muted">{caption}</span>}
      </div>
    </div>
  );
}

/** The analytics surface. */
export function AnalyticsView() {
  const palette = useChartPalette();
  const { state } = useApp();
  const tasks = state.tasks;
  const waves = state.waves;
  const members = state.members;

  const statusBars: BarDatum[] = WORK_STATUSES.map((status) => ({
    label: STATUS_META[status].label,
    value: tasks.filter((task) => task.status === status).length,
    color:
      status === 'done'
        ? palette.success
        : status === 'blocked'
          ? palette.danger
          : status === 'active'
            ? palette.accent
            : status === 'planned'
              ? palette.warning
              : palette.muted,
  }));

  const kindBars: BarDatum[] = TASK_KINDS.map((kind) => ({
    label: KIND_META[kind].label,
    value: tasks.filter((task) => task.kind === kind).length,
    color: palette.accent,
  }));

  const assigneeBars: BarDatum[] = [
    ...members.map((member) => ({
      label: member.name.split(' ')[0],
      value: tasks.filter((task) => task.assigneeId === member.id).length,
      color: member.color,
    })),
    {
      label: 'Unassigned',
      value: tasks.filter((task) => task.assigneeId === null).length,
      color: palette.muted,
    },
  ];

  const wavePoints = waves.map((wave) => {
    const waveTasks = tasks.filter((task) => task.waveId === wave.id);
    return {
      label: `W${wave.number}`,
      total: waveTasks.length,
      done: waveTasks.filter((task) => task.status === 'done').length,
    };
  });

  const overdue = tasks.filter((task) => isOverdue(task)).length;
  const covered = tasks.filter((task) => task.evidence.some((item) => item.verified)).length;
  const coverage = tasks.length > 0 ? (covered / tasks.length) * 100 : 0;
  const overdueShare = tasks.length > 0 ? (overdue / tasks.length) * 100 : 0;

  return (
    <div className="h-full min-h-0 overflow-y-auto px-7 pb-9">
      <div className="mx-auto grid w-full grid-cols-1 gap-3 pt-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Tasks by status" value={tasks.length}>
          <BarChart data={statusBars} />
        </ChartCard>

        <ChartCard
          title="Tasks by kind"
          value={kindBars.filter((bar) => bar.value > 0).length}
          hint="Distinct kinds in use across the tracker."
        >
          <BarChart data={kindBars} />
        </ChartCard>

        <ChartCard
          title="Tasks by assignee"
          value={assigneeBars.filter((bar) => bar.value > 0).length}
          hint="People carrying at least one task."
        >
          <BarChart data={assigneeBars} />
        </ChartCard>

        <ChartCard
          title="Throughput per wave"
          value={`${wavePoints.reduce((sum, point) => sum + point.total, 0)} carried`}
          hint="Carried is every task filed against the wave; done is how much of it closed."
        >
          <ThroughputChart points={wavePoints} />
        </ChartCard>

        <ChartCard
          title="Evidence coverage"
          value={`${Math.round(coverage)}%`}
          hint={`${covered} of ${tasks.length} tasks cite a verified artefact.`}
        >
          <Gauge percent={coverage} color={palette.accent} caption={`${covered}/${tasks.length}`} />
        </ChartCard>

        <ChartCard title="Overdue" value={overdue} hint="Past due and still open.">
          <Gauge percent={overdueShare} color={palette.danger} caption={`${overdue} open`} />
        </ChartCard>
      </div>
    </div>
  );
}
