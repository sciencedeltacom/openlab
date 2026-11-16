/**
 * The chart shapes the overview screens use.
 *
 * nivo paints through SVG presentation attributes, so colours come from the token
 * bridge in `research/chartTheme` rather than from Tailwind classes. A caller names a
 * *tone* ("failed", "verified") and the component resolves it to the concrete palette
 * value, which keeps semantics in the spec and hex codes out of it.
 */

import { ResponsiveBar } from '@nivo/bar';
import { ResponsiveLine } from '@nivo/line';

import {
  CHART_MARGIN,
  useChartPalette,
  useChartTheme,
  xAxis,
  yAxis,
  type ChartPalette,
} from '@/components/research/chartTheme';
import { LineTooltip } from '@/components/charts/tooltips';
import { cn } from '@/lib/cn';

/** The meaning a bar, slice or series carries. */
export type ChartTone = 'accent' | 'success' | 'warning' | 'danger' | 'muted';

/** One horizontal bar: a label, its value and an optional tone. */
export interface BarItem {
  label: string;
  value: number;
  tone?: ChartTone;
}

/** Tone to palette key, so the caller never handles a colour literal. */
const TONE_KEY: Record<ChartTone, keyof ChartPalette> = {
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'muted',
};

/** Tone to text class, for the list beside a chart. */
const TONE_TEXT: Record<ChartTone | 'default', string> = {
  default: 'text-foreground',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted',
};

/**
 * A flat record nivo can index by.
 *
 * The index signature is nivo's requirement, not ours: its datum type is a record of
 * strings and numbers, so the colour travels on the row rather than in a parallel array.
 */
interface BarRow {
  label: string;
  value: number;
  color: string;
  [key: string]: string | number;
}

/**
 * A horizontal bar chart.
 *
 * Horizontal because the labels are domain names, not dates; the value prints at the
 * end of each bar, so a reader gets the number without a tooltip. The height follows
 * the row count — a fixed height leaves a gap under a short chart and clips a tall one.
 */
export function BarChart({ data, labelWidth = 96 }: { data: BarItem[]; labelWidth?: number }) {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const rows: BarRow[] = data.map((item) => ({
    label: item.label,
    value: item.value,
    color: palette[TONE_KEY[item.tone ?? 'accent']],
  }));
  const height = rows.length * 26 + 12;

  return (
    <div style={{ height }}>
      <ResponsiveBar
        data={rows}
        keys={['value']}
        indexBy="label"
        layout="horizontal"
        margin={{ top: 4, right: 34, bottom: 4, left: labelWidth }}
        padding={0.32}
        colors={({ data: datum }) => String(datum.color)}
        borderRadius={6}
        labelPosition="end"
        labelOffset={7}
        labelSkipWidth={0}
        label={(datum) => Number(datum.value).toLocaleString('en-US')}
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
            {datum.label}: <span className="tabular-nums">{Number(datum.value).toLocaleString('en-US')}</span>
          </div>
        )}
      />
    </div>
  );
}

/** One line: an id for the legend, a tone and the points. */
export interface LineSeries {
  id: string;
  tone?: ChartTone;
  data: { x: string; y: number }[];
}

/**
 * A small multi-series line chart.
 *
 * Labels every Nth point rather than every point, so a fortnight of dates stays
 * readable at card width; the last point keeps its label because it is the one a
 * reader looks for first.
 */
export function LineChart({
  series,
  height = 148,
  xLabel,
  yLabel,
}: {
  series: LineSeries[];
  height?: number;
  /** Axis titles, when the card has room for them. */
  xLabel?: string;
  yLabel?: string;
}) {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const colors = series.map((entry) => palette[TONE_KEY[entry.tone ?? 'accent']]);
  const points = series[0]?.data ?? [];
  const step = Math.max(1, Math.ceil(points.length / 7));
  const tickValues = points
    .filter((_, index) => index % step === 0 || index === points.length - 1)
    .map((point) => point.x);

  return (
    <div className="flex flex-col gap-2">
      {series.length > 1 && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map((entry, index) => (
            <li key={entry.id} className="flex items-center gap-1.5 text-meta text-muted">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index] }} />
              {entry.id}
            </li>
          ))}
        </ul>
      )}
      <div style={{ height }}>
        <ResponsiveLine
          data={series.map((entry) => ({ id: entry.id, data: entry.data }))}
          margin={{ ...CHART_MARGIN, bottom: xLabel ? 42 : 26, left: yLabel ? 52 : 32 }}
          xScale={{ type: 'point' }}
          yScale={{ type: 'linear', min: 0, max: 'auto' }}
          curve="monotoneX"
          colors={colors}
          lineWidth={2}
          pointSize={8}
          pointBorderWidth={2}
          pointBorderColor={{ from: 'serieColor' }}
          enableArea={false}
          enableGridX={false}
          axisBottom={xLabel ? xAxis(xLabel, tickValues) : { tickSize: 0, tickPadding: 8, tickValues }}
          axisLeft={yLabel ? yAxis(yLabel) : { tickSize: 0, tickPadding: 6, tickValues: 4 }}
          enableSlices="x"
          sliceTooltip={({ slice }) => <LineTooltip slice={slice as never} />}
          theme={theme}
          animate={false}
        />
      </div>
    </div>
  );
}

/** One row in a card's short list. */
export interface ListItem {
  label: string;
  detail?: string;
  value?: string;
  tone?: ChartTone | 'default';
}

/** A short list: what the entry is, what it did, and one number at the right. */
export function ItemList({ items }: { items: ListItem[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.label} className="flex items-baseline gap-3 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body">{item.label}</span>
            {item.detail && <span className="block truncate text-meta text-muted">{item.detail}</span>}
          </span>
          {item.value && (
            <span className={cn('shrink-0 text-meta tabular-nums', TONE_TEXT[item.tone ?? 'default'])}>
              {item.value}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
