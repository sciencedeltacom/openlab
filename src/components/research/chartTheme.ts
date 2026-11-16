/**
 * The bridge between the design tokens and nivo.
 *
 * nivo hands its colours to SVG presentation attributes, and a presentation attribute
 * cannot resolve `var(--accent)` — variables only work as CSS property values. So the
 * palette is read from the computed root styles once per theme change and passed down as
 * concrete colours.
 *
 * The theme object is the same idea for nivo's own chrome: text, grid lines, tooltips and
 * crosshairs all come from the tokens rather than from nivo's defaults, which is what keeps
 * a chart from looking like a different product.
 */

import { useMemo, type ComponentProps } from 'react';
import { ResponsiveBar } from '@nivo/bar';

import { useApp } from '@/store/app';

/**
 * nivo's theme shape.
 *
 * Derived from a component rather than imported: the type lives in `@nivo/theming`, which is
 * a transitive dependency, and taking a direct one for a single type import is a poor trade.
 */
type ChartTheme = NonNullable<ComponentProps<typeof ResponsiveBar>['theme']>;

/** The concrete colours a chart paints with. */
export interface ChartPalette {
  accent: string;
  accentSecondary: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
  foreground: string;
  surface: string;
  surfaceTertiary: string;
  separator: string;
  overlay: string;
  background: string;
}

/** Read a token off the document root, with a fallback for the first paint. */
function read(name: string, fallback: string): string {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The current palette.
 *
 * Recomputed when the theme changes, because the tokens do — a chart drawn for the light
 * canvas has the wrong greys on the dark one.
 */
export function useChartPalette(): ChartPalette {
  const { state } = useApp();
  return useMemo(
    () => ({
      accent: read('--accent', '#1e5db3'),
      accentSecondary: read('--accent-secondary', '#0b3c78'),
      success: read('--success', '#2fbf8f'),
      warning: read('--warning', '#f2a93b'),
      danger: read('--danger', '#e5534b'),
      muted: read('--muted', '#96958f'),
      foreground: read('--foreground', '#3f3f3e'),
      surface: read('--surface', '#faf9f6'),
      surfaceTertiary: read('--surface-tertiary', '#e6e5e0'),
      separator: read('--separator', 'rgba(63,63,62,0.07)'),
      overlay: read('--overlay', '#ffffff'),
      background: read('--background', '#f4f3f0'),
    }),
    // The theme is what changes the tokens; reading it here is what makes this recompute.
    [state.theme],
  );
}

/** nivo's chrome, expressed in tokens. */
export function useChartTheme(): ChartTheme {
  const palette = useChartPalette();
  return useMemo(
    () => ({
      background: 'transparent',
      text: { fontSize: 11, fill: palette.muted, fontFamily: 'inherit' },
      axis: {
        domain: { line: { stroke: palette.separator, strokeWidth: 1 } },
        ticks: { line: { stroke: 'transparent' }, text: { fill: palette.muted, fontSize: 10 } },
        legend: { text: { fill: palette.muted, fontSize: 11 } },
      },
      grid: { line: { stroke: palette.separator, strokeWidth: 1 } },
      legends: { text: { fill: palette.muted, fontSize: 11 } },
      labels: { text: { fill: palette.foreground, fontSize: 11, fontWeight: 500 } },
      tooltip: {
        container: {
          background: palette.overlay,
          color: palette.foreground,
          fontSize: 12,
          borderRadius: 12,
          padding: '9px 11px',
          border: `1px solid ${palette.separator}`,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.12)',
        },
      },
      crosshair: { line: { stroke: palette.accent, strokeWidth: 1, strokeOpacity: 0.45 } },
    }),
    [palette],
  );
}

/** Shared margins, so every chart in a row starts its plot at the same place. */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 28, left: 12 };

/** A margin with room for axis titles, for a chart that names its axes. */
export const LABELLED_MARGIN = { top: 10, right: 18, bottom: 46, left: 58 };

/**
 * An x axis that says what it is.
 *
 * A chart's axes are part of its sentence: a row of dates and a column of numbers with no
 * names ask the reader to infer the two quantities from the title.
 */
export function xAxis(legend: string, ticks?: readonly (string | number)[]) {
  return {
    tickSize: 0,
    tickPadding: 8,
    legend,
    legendPosition: 'middle' as const,
    legendOffset: 34,
    ...(ticks && ticks.length > 0 ? { tickValues: ticks as (string | number)[] } : {}),
  };
}

/** A y axis that says what it is, with a compact number format when one is given. */
export function yAxis(legend: string, format?: (value: number) => string) {
  return {
    tickSize: 0,
    tickPadding: 6,
    tickValues: 4,
    legend,
    legendPosition: 'middle' as const,
    legendOffset: -44,
    ...(format ? { format: (value: number | string) => format(Number(value)) } : {}),
  };
}
