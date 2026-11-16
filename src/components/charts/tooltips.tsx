/**
 * The hover card every chart shares.
 *
 * nivo's default tooltip prints the datum's own field names — `x:`, `y:` — which is the shape
 * of the data, not the question the reader is asking. These renderers print the category and
 * the series with the words the page uses, and nothing else.
 */

/** One row of values inside the card. */
function TooltipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="flex items-baseline gap-2">
      {color && <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
      <span className="min-w-0 flex-1 truncate text-label text-muted">{label}</span>
      <span className="shrink-0 text-label font-medium tabular-nums text-foreground">{value}</span>
    </span>
  );
}

/** The card itself: a category on top, one row per series. */
export function ChartTooltip({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  return (
    <div className="flex min-w-[136px] flex-col gap-1 rounded-xl border border-separator bg-overlay px-3 py-2 shadow-lg">
      <span className="text-meta font-medium text-muted">{title}</span>
      {rows.map((row) => (
        <TooltipRow key={row.label} {...row} />
      ))}
    </div>
  );
}

/** A point on a line: the x value, then each series at that x. */
export function LineTooltip({
  slice,
  seriesNames,
}: {
  slice: {
    points: { data: { x?: unknown; y?: unknown; yFormatted?: string }; seriesId?: string; id?: string }[];
  };
  /** Names for the series ids, when the id is not the label. */
  seriesNames?: Record<string, string>;
}) {
  const first = slice.points[0];
  const title = String(first?.data.x ?? '');
  return (
    <ChartTooltip
      title={title}
      rows={slice.points.map((point) => {
        const id = String(point.seriesId ?? point.id ?? '');
        const value = point.data.yFormatted ?? String(point.data.y ?? '');
        return { label: seriesNames?.[id] ?? id, value };
      })}
    />
  );
}

/** A bar: the category, then the value. */
export function BarTooltip({
  indexValue,
  value,
  color,
  seriesNames,
  id,
}: {
  indexValue: string | number;
  value: number;
  color?: string;
  id?: string | number;
  seriesNames?: Record<string, string>;
}) {
  const name = id !== undefined ? (seriesNames?.[String(id)] ?? String(id)) : 'Value';
  return (
    <ChartTooltip
      title={String(indexValue)}
      rows={[
        {
          label: name,
          value: Number(value).toLocaleString('en-US'),
          color,
        },
      ]}
    />
  );
}

/** A slice: its label and its count. */
export function PieTooltip({
  datum,
}: {
  datum: { id: string | number; value: number; label?: string | number; color?: string };
}) {
  return (
    <ChartTooltip
      title={String(datum.label ?? datum.id)}
      rows={[
        {
          label: String(datum.id),
          value: Number(datum.value).toLocaleString('en-US'),
          color: datum.color,
        },
      ]}
    />
  );
}
