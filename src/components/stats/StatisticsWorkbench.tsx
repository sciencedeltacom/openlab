/**
 * The statistics workbench.
 *
 * A catalogue of the procedures the workbench ships plus the ones a lab writes itself. Every
 * procedure — built-in or from `.openlab/statistics/` — is read the same way: pick the data,
 * map it to the columns the procedure needs, read the assumptions, then run.
 *
 * Data arrives as a table now (`lib/science/dataset.ts`), from a paste, a file or the
 * workspace, so a CSV of a clinical table is not retyped as two blank-line-separated columns.
 * A custom procedure declares its parameters and outputs in YAML (`lib/science/procedures.ts`)
 * and the form below is built from that declaration.
 *
 * The engine is still the single source of truth for the built-ins: a preview runs the same
 * function the Run button does, so the assumption marks cannot drift from the reported result.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ResponsiveBar, type BarCustomLayerProps, type BarDatum, type BarLayer } from '@nivo/bar';
import { ResponsiveLine, type LineCustomSvgLayerProps, type LineSeries, type LineSvgLayer } from '@nivo/line';

import { BarTooltip, LineTooltip } from '@/components/charts/tooltips';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CircleCheck,
  CircleSlash,
  CircleX,
  Copy,
  Gauge,
  Grid3x3,
  Pencil,
  Play,
  Plus,
  Share2,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import {
  Button,
  Chip,
  Collapsible,
  Dialog,
  IconButton,
  ScrollShadow,
  SectionLabel,
  Select,
} from '@/components/ui';
import { CHART_MARGIN, useChartPalette, useChartTheme } from '@/components/research/chartTheme';
import { cn } from '@/lib/cn';
import { useCopy } from '@/hooks/useCopy';
import { activeProject } from '@/store/types';
import { useApp, usePageTitle } from '@/store/app';
import { MOTION } from '@/theme/tokens';
import {
  adjustPValues,
  anovaOneWay,
  chiSquareTest,
  describe,
  formatP,
  linearRegression,
  oneSampleTTest,
  pairedTTest,
  pearsonCorrelation,
  round,
  tQuantile,
  welchTTest,
  type AssumptionCheck,
  type ReproducibleResult,
} from '@/lib/science/stats';
import {
  planReady,
  readDataset,
  resolveGroupMode,
  suggestPlan,
  toParsedData,
  type DataPlan,
  type DataShape,
  type Dataset,
  type ParsedData,
  type ReadOptions,
} from '@/lib/science/dataset';
import {
  defaultParams,
  readParam,
  type ChartKind,
  type ProcedureManifest,
  type StatisticOutput,
  type StatisticParameter,
} from '@/lib/science/procedures';
import {
  loadWorkspaceStatistics,
  removeCustomProcedure,
  runCustomProcedure,
  saveCustomProcedure,
  useCustomProcedures,
  type CustomProcedure,
  type CustomRun,
} from '@/components/stats/custom';
import { DataPanel } from '@/components/stats/DataPanel';
import { ParameterPanel } from '@/components/stats/Parameters';
import { ProcedurePage } from '@/components/stats/ProcedurePage';

/* ================================================================================================
 * Procedures
 * ============================================================================================== */

/** The five families the built-in catalogue is grouped by. */
type Family = 'Description' | 'Comparison' | 'Relationship' | 'Categorical' | 'Regression';

/** What a procedure needs, and whether the current data can check it. */
interface Preview {
  ready: boolean;
  checkable: boolean;
  checks: AssumptionCheck[];
}

/** One built-in procedure, bound to the engine function it exposes. */
interface Procedure {
  id: string;
  name: string;
  family: Family;
  /** One line: when a researcher reaches for this. */
  useWhen: string;
  /** The design and sampling this procedure assumes. */
  design: string;
  /** How the data area should be filled in, when the shape default is not enough. */
  dataHint?: string;
  /** What the procedure reads from the table. */
  shape: DataShape;
  /** A realistic dataset so the page is alive on arrival. */
  example: string;
  ready: (data: ParsedData) => boolean;
  run: (data: ParsedData) => ReproducibleResult<unknown>;
  chart: ChartKind;
  /** A reference line for the one-sample test. */
  reference?: number;
}

/** Join one value per line. */
function column(values: number[]): string {
  return values.join('\n');
}

/** Join groups with a blank line between them. */
function groupBlocks(...groups: number[][]): string {
  return groups.map(column).join('\n\n');
}

/** Join literal lines. */
function lineRows(...rows: string[]): string {
  return rows.join('\n');
}

/** Every built-in procedure the workbench exposes, in family order. */
const PROCEDURES: Procedure[] = [
  {
    id: 'descriptives',
    name: 'Descriptives',
    family: 'Description',
    useWhen: 'Summarise one sample before any test, and see whether the mean is a fair summary.',
    design:
      'One sample of independent observations on a continuous scale. Nothing is compared to a reference; the output is the summary a paper prints in its first table.',
    dataHint: 'One numeric column; pick it under Values column if the table has several.',
    shape: 'values',
    example: column([12.4, 11.8, 13.1, 12.9, 12.2, 13.6, 11.9, 12.7, 13.3, 12.5, 12.1, 13.0]),
    ready: (data) => (data.blocks[0]?.length ?? 0) >= 2,
    run: (data) => describe(data.blocks[0] ?? []),
    chart: 'distribution',
  },
  {
    id: 'welch',
    name: "Welch's t-test",
    family: 'Comparison',
    useWhen: 'Compare two independent groups on a continuous outcome without assuming equal spread.',
    design:
      'Two independent groups, each a simple random sample of the same population. The unit is the observation; the same unit never appears in both groups.',
    dataHint: 'Two groups: a group column and a value column, blank-line blocks, or one column per group.',
    shape: 'groups',
    example: groupBlocks(
      [9.8, 10.4, 9.5, 10.1, 9.9, 10.6, 10.2, 9.7],
      [11.2, 10.8, 11.6, 11.0, 11.9, 11.4, 10.9, 11.7],
    ),
    ready: (data) => (data.blocks[0]?.length ?? 0) >= 2 && (data.blocks[1]?.length ?? 0) >= 2,
    run: (data) => welchTTest(data.blocks[0] ?? [], data.blocks[1] ?? []),
    chart: 'means',
  },
  {
    id: 'paired',
    name: 'Paired t-test',
    family: 'Comparison',
    useWhen: 'Compare two measurements taken on the same unit, or on matched pairs.',
    design:
      'One row per unit with two columns, before and after. Pairs are independent of each other; the two measurements within a pair are not.',
    dataHint: 'Two numeric columns, one pair per row: the first is before, the second is after.',
    shape: 'pairs',
    example: lineRows(
      '9.4 8.1',
      '9.8 8.4',
      '10.2 8.9',
      '9.1 7.9',
      '10.5 9.2',
      '9.7 8.6',
      '10.0 8.8',
      '9.5 8.3',
    ),
    ready: (data) => (data.blocks[0]?.length ?? 0) >= 2 && (data.pairs[0]?.length ?? 0) >= 2,
    run: (data) => pairedTTest(data.blocks[0] ?? [], data.pairs[0] ?? []),
    chart: 'means',
  },
  {
    id: 'one-sample',
    name: 'One-sample t-test',
    family: 'Comparison',
    useWhen: 'Test one sample against a known reference value, such as zero change.',
    design:
      'One sample of independent observations compared to a fixed reference. The reference is not estimated from the data; it comes from a specification or a null of no effect.',
    dataHint: 'One numeric column. The reference mean is 0, so log-ratios and changes centre on it.',
    shape: 'values',
    example: column([0.42, 0.31, 0.28, 0.55, 0.38, 0.47, 0.33, 0.29, 0.51, 0.36, 0.44, 0.27]),
    ready: (data) => (data.blocks[0]?.length ?? 0) >= 2,
    run: (data) => oneSampleTTest(data.blocks[0] ?? [], 0),
    chart: 'means',
    reference: 0,
  },
  {
    id: 'anova',
    name: 'One-way ANOVA',
    family: 'Comparison',
    useWhen: 'Compare three or more independent groups on one factor, then follow up pairwise.',
    design:
      'Three or more independent groups defined by one categorical factor. Each observation belongs to exactly one group; residuals are roughly normal and similarly spread.',
    dataHint: 'Three or more groups: one long table with a group column, or one column per group.',
    shape: 'groups',
    example: groupBlocks(
      [5.1, 5.6, 4.9, 5.3, 5.8, 5.2],
      [6.4, 6.9, 6.1, 6.6, 7.0, 6.3],
      [7.8, 8.2, 7.5, 8.0, 8.4, 7.7],
    ),
    ready: (data) => data.blocks.filter((group) => group.length >= 2).length >= 3,
    run: (data) => anovaOneWay(data.blocks),
    chart: 'means',
  },
  {
    id: 'multiple',
    name: 'Multiple-comparison correction',
    family: 'Comparison',
    useWhen: 'Adjust a family of p-values that answer one question on one dataset.',
    design:
      'A declared family of tests. The correction controls error rate across the family, so the family must be defined before the results are seen.',
    dataHint: 'A label column and a p-value column. Every row is one test in the family.',
    shape: 'pvalues',
    example: lineRows(
      'Calibration 0.012',
      'Per-guide AUROC 0.031',
      'Seed stability 0.084',
      'Tail recall 0.006',
      'Marker preservation 0.21',
      'Donor mixing 0.44',
    ),
    ready: (data) =>
      data.pEntries.length >= 1 && data.pEntries.every((entry) => entry.p >= 0 && entry.p <= 1),
    run: (data) => adjustPValues(data.pEntries, { method: 'bh', alpha: 0.05 }),
    chart: 'pvalues',
  },
  {
    id: 'pearson',
    name: 'Pearson correlation',
    family: 'Relationship',
    useWhen: 'Measure the strength of a straight-line association between two continuous variables.',
    design:
      'Paired continuous measurements, one pair per unit. The relationship is linear; neither variable is treated as causing the other.',
    dataHint: 'Two numeric columns, one pair per row. Three or more pairs are required.',
    shape: 'pairs',
    example: lineRows(
      '1.2 3.1',
      '1.8 4.0',
      '2.4 4.6',
      '3.1 5.9',
      '3.6 6.2',
      '4.4 7.5',
      '5.0 8.1',
      '5.7 9.4',
      '6.3 10.2',
      '7.1 11.0',
      '7.8 12.4',
      '8.6 13.1',
      '9.2 14.0',
      '10.1 15.2',
    ),
    ready: (data) => (data.blocks[0]?.length ?? 0) >= 3 && (data.pairs[0]?.length ?? 0) >= 3,
    run: (data) => pearsonCorrelation(data.blocks[0] ?? [], data.pairs[0] ?? []),
    chart: 'scatter',
  },
  {
    id: 'chi-square',
    name: 'Chi-square test',
    family: 'Categorical',
    useWhen: 'Test whether counts across categories are independent, or fit an expected split.',
    design:
      'A table of counts. Each observation contributes to exactly one cell, and the expected count in most cells is at least five. One row is a goodness-of-fit test; more rows are a test of independence.',
    dataHint: 'One row per table row, one numeric column per cell. One row tests goodness of fit.',
    shape: 'table',
    example: lineRows('42 18 8', '30 26 14', '12 24 36'),
    ready: (data) => {
      const table = data.matrix.filter((row) => row.length > 0);
      const width = table[0]?.length ?? 0;
      return (
        table.length >= 1 &&
        table.every((row) => row.length === width) &&
        table.flat().reduce((sum, value) => sum + value, 0) > 0
      );
    },
    run: (data) => chiSquareTest(data.matrix),
    chart: 'categories',
  },
  {
    id: 'regression',
    name: 'Simple linear regression',
    family: 'Regression',
    useWhen: 'Estimate how much a continuous outcome changes per unit of one predictor.',
    design:
      'One predictor and one outcome, each pair from the same unit. The relationship is linear, residuals are independent with constant variance, and no single point dominates the fit.',
    dataHint: 'Two numeric columns, one pair per row: predictor then response.',
    shape: 'pairs',
    example: lineRows(
      '1.2 3.1',
      '1.8 4.0',
      '2.4 4.6',
      '3.1 5.9',
      '3.6 6.2',
      '4.4 7.5',
      '5.0 8.1',
      '5.7 9.4',
      '6.3 10.2',
      '7.1 11.0',
      '7.8 12.4',
      '8.6 13.1',
      '9.2 14.0',
      '10.1 15.2',
    ),
    ready: (data) => (data.blocks[0]?.length ?? 0) >= 3 && (data.pairs[0]?.length ?? 0) >= 3,
    run: (data) => linearRegression(data.blocks[0] ?? [], data.pairs[0] ?? []),
    chart: 'scatter',
  },
];

/** The family a procedure belongs to, with the icon the rail and workbench share. */
const FAMILY_ICON: Record<Family, LucideIcon> = {
  Description: Gauge,
  Comparison: ArrowLeftRight,
  Relationship: Share2,
  Categorical: Grid3x3,
  Regression: TrendingUp,
};

/** Families in the order a reader moves through them. */
const FAMILIES: Family[] = ['Description', 'Comparison', 'Relationship', 'Categorical', 'Regression'];

/** The icon a custom procedure wears. */
const CUSTOM_ICON = Gauge;

/** Run a procedure far enough to know what its assumptions look like on this data. */
function previewOf(procedure: Procedure, data: ParsedData): Preview {
  if (!procedure.ready(data)) {
    return { ready: false, checkable: false, checks: [] };
  }
  const result = procedure.run(data);
  const checks = result.error ? [] : result.assumptions;
  return {
    ready: true,
    checkable: checks.some((check) => check.status !== 'skipped'),
    checks,
  };
}

/* ================================================================================================
 * Fact rows
 * ============================================================================================== */

/** Values read off a result without trusting a concrete payload type. */
type Values = Record<string, unknown>;

/** A finite number field, or `NaN`. */
function num(values: Values, key: string): number {
  const value = values[key];
  return typeof value === 'number' ? value : NaN;
}

/** A two-number tuple field, or `[NaN, NaN]`. */
function span(values: Values, key: string): [number, number] {
  const value = values[key];
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0], value[1]];
  }
  return [NaN, NaN];
}

/** A number at a paper's precision, or `n/a` when the test did not produce one. */
function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? String(round(value, digits)) : 'n/a';
}

/** A p-value the way a paper writes it. */
function pValue(p: number): string {
  return Number.isFinite(p) ? `p ${formatP(p)}` : 'p n/a';
}

/** One labelled result row. */
function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-40 shrink-0 text-meta text-muted">{label}</span>
      <span className="min-w-0 flex-1 text-body tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** The statistic, df, p, effect size and interval rows for a built-in procedure's payload. */
function resultFacts(
  id: string,
  values: Values,
): { rows: { label: string; value: string }[]; note?: string } {
  switch (id) {
    case 'descriptives':
      return {
        rows: [
          { label: 'Statistic', value: `mean = ${fmt(num(values, 'mean'))}` },
          { label: 'Sample size', value: String(num(values, 'n')) },
          { label: 'Degrees of freedom', value: `${num(values, 'n') - 1} (of the mean)` },
          {
            label: '95% CI of mean',
            value: `[${fmt(span(values, 'ci')[0])}, ${fmt(span(values, 'ci')[1])}]`,
          },
          { label: 'Standard deviation', value: fmt(num(values, 'sd')) },
          { label: 'Standard error', value: fmt(num(values, 'se')) },
          { label: 'Median', value: fmt(num(values, 'median')) },
          { label: 'Interquartile range', value: fmt(num(values, 'iqr')) },
          { label: 'Skewness', value: fmt(num(values, 'skewness')) },
          { label: 'Excess kurtosis', value: fmt(num(values, 'kurtosis')) },
        ],
        note: 'A description does not test a hypothesis, so there is no p-value or effect size to report.',
      };
    case 'welch':
      return {
        rows: [
          { label: 'Statistic', value: `t = ${fmt(num(values, 't'))}` },
          { label: 'Degrees of freedom', value: fmt(num(values, 'df'), 1) },
          { label: 'p-value', value: pValue(num(values, 'p')) },
          { label: 'Effect size', value: `Cohen's d = ${fmt(num(values, 'cohenD'))}` },
          {
            label: '95% CI of difference',
            value: `[${fmt(span(values, 'ci')[0])}, ${fmt(span(values, 'ci')[1])}]`,
          },
          { label: 'Group means', value: `${fmt(num(values, 'meanA'))} vs ${fmt(num(values, 'meanB'))}` },
        ],
      };
    case 'paired':
      return {
        rows: [
          { label: 'Statistic', value: `paired t = ${fmt(num(values, 't'))}` },
          { label: 'Degrees of freedom', value: String(num(values, 'df')) },
          { label: 'p-value', value: pValue(num(values, 'p')) },
          { label: 'Effect size', value: `Cohen's dz = ${fmt(num(values, 'cohenD'))}` },
          {
            label: '95% CI of mean change',
            value: `[${fmt(span(values, 'ci')[0])}, ${fmt(span(values, 'ci')[1])}]`,
          },
          { label: 'Mean change', value: fmt(num(values, 'meanDifference')) },
        ],
      };
    case 'one-sample':
      return {
        rows: [
          { label: 'Statistic', value: `t = ${fmt(num(values, 't'))}` },
          { label: 'Degrees of freedom', value: String(num(values, 'df')) },
          { label: 'p-value', value: pValue(num(values, 'p')) },
          { label: 'Effect size', value: `Cohen's d = ${fmt(num(values, 'cohenD'))}` },
          {
            label: '95% CI of difference',
            value: `[${fmt(span(values, 'ci')[0])}, ${fmt(span(values, 'ci')[1])}]`,
          },
          {
            label: 'Mean vs reference',
            value: `${fmt(num(values, 'meanA'))} vs ${fmt(num(values, 'meanB'))}`,
          },
        ],
      };
    case 'anova':
      return {
        rows: [
          { label: 'Statistic', value: `F = ${fmt(num(values, 'f'))}` },
          {
            label: 'Degrees of freedom',
            value: `${num(values, 'dfBetween')} between, ${num(values, 'dfWithin')} within`,
          },
          { label: 'p-value', value: pValue(num(values, 'p')) },
          {
            label: 'Effect size',
            value: `η² = ${fmt(num(values, 'etaSquared'))}, ω² = ${fmt(num(values, 'omegaSquared'))}`,
          },
          { label: 'Confidence interval', value: 'Not applicable to an omnibus F test' },
          { label: 'Groups', value: String((values.groupSizes as unknown[] | undefined)?.length ?? 0) },
        ],
      };
    case 'chi-square':
      return {
        rows: [
          { label: 'Statistic', value: `χ² = ${fmt(num(values, 'chiSquare'))}` },
          { label: 'Degrees of freedom', value: String(num(values, 'df')) },
          { label: 'p-value', value: pValue(num(values, 'p')) },
          {
            label: 'Effect size',
            value: Number.isFinite(num(values, 'cramersV'))
              ? `Cramér's V = ${fmt(num(values, 'cramersV'))}`
              : 'Not applicable to goodness of fit',
          },
          { label: 'Confidence interval', value: 'Not applicable to a chi-square test' },
          { label: 'Smallest expected count', value: fmt(num(values, 'minExpected'), 2) },
        ],
      };
    case 'pearson':
      return {
        rows: [
          { label: 'Statistic', value: `r = ${fmt(num(values, 'r'))}` },
          { label: 'Degrees of freedom', value: String(num(values, 'df')) },
          { label: 'p-value', value: pValue(num(values, 'p')) },
          { label: 'Effect size', value: `r² = ${fmt(num(values, 'rSquared'))}` },
          { label: '95% CI of r', value: `[${fmt(span(values, 'ci')[0])}, ${fmt(span(values, 'ci')[1])}]` },
          { label: 'Pairs', value: String(num(values, 'n')) },
        ],
      };
    case 'regression':
      return {
        rows: [
          { label: 'Slope', value: fmt(num(values, 'slope')) },
          { label: 'Intercept', value: fmt(num(values, 'intercept')) },
          { label: 'Degrees of freedom', value: String(num(values, 'df')) },
          { label: 'p-value (slope)', value: pValue(num(values, 'slopeP')) },
          { label: 'Effect size', value: `R² = ${fmt(num(values, 'rSquared'))}` },
          {
            label: '95% CI of slope',
            value: `[${fmt(span(values, 'slopeCi')[0])}, ${fmt(span(values, 'slopeCi')[1])}]`,
          },
          { label: 'Residual standard error', value: fmt(num(values, 'residualSe')) },
        ],
      };
    case 'multiple':
      return {
        rows: [
          { label: 'Statistic', value: `${((values.results as unknown[] | undefined) ?? []).length} tests` },
          { label: 'Degrees of freedom', value: 'Not applicable' },
          { label: 'p-value', value: 'Adjusted per test, listed below' },
          { label: 'Effect size', value: 'Not applicable to a correction' },
          { label: 'Confidence interval', value: 'Not applicable to a correction' },
        ],
      };
    default:
      return { rows: [] };
  }
}

/** One value a custom procedure declared, written the way it asked for. */
function outputValue(output: StatisticOutput, values: Values): string {
  const value = values[output.key];
  switch (output.type) {
    case 'number':
      return fmt(Number(value), output.digits ?? 3);
    case 'integer':
      return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : 'n/a';
    case 'percent':
      return Number.isFinite(Number(value)) ? `${fmt(Number(value) * 100, output.digits ?? 1)}%` : 'n/a';
    case 'p':
      return Number.isFinite(Number(value)) ? pValue(Number(value)) : 'p n/a';
    case 'interval':
      if (Array.isArray(value) && value.length >= 2) {
        return `[${fmt(Number(value[0]), output.digits ?? 3)}, ${fmt(Number(value[1]), output.digits ?? 3)}]`;
      }
      return 'n/a';
    default:
      return value === undefined || value === null ? '—' : String(value);
  }
}

/** Tone and glyph for one assumption verdict. */
const CHECK_MARK: Record<AssumptionCheck['status'], { icon: LucideIcon; tone: string }> = {
  pass: { icon: CircleCheck, tone: 'text-success' },
  warn: { icon: AlertTriangle, tone: 'text-warning' },
  fail: { icon: CircleX, tone: 'text-danger' },
  skipped: { icon: CircleSlash, tone: 'text-muted' },
};

/* ================================================================================================
 * Charts
 * ============================================================================================== */

/** One bar in a comparison chart, carrying its own interval for the error-bar layer. */
interface MeanRow {
  label: string;
  mean: number;
  lo: number;
  hi: number;
  [key: string]: string | number;
}

/** Mean, spread and 95% CI for one group, read from the data. */
function groupStats(values: number[]): {
  n: number;
  mean: number;
  sd: number;
  se: number;
  lo: number;
  hi: number;
} {
  const n = values.length;
  const mean = n > 0 ? values.reduce((sum, value) => sum + value, 0) / n : NaN;
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : NaN;
  const sd = Math.sqrt(variance);
  const se = Number.isFinite(sd) ? sd / Math.sqrt(n) : NaN;
  const critical = n > 1 ? tQuantile(0.95, n - 1) : NaN;
  return { n, mean, sd, se, lo: mean - critical * se, hi: mean + critical * se };
}

/** The groups a comparison chart draws. */
function meansGroups(data: ParsedData): { label: string; values: number[] }[] {
  return data.blocks
    .filter((group) => group.length > 0)
    .map((group, index) => ({ label: data.labels[index] ?? `Group ${index + 1}`, values: group }));
}

/** A horizontal cap line the error-bar layer draws over each bar. */
function useErrorBars(color: string): BarLayer<BarDatum> {
  return useMemo(() => {
    function ErrorBars({ bars, yScale }: BarCustomLayerProps<BarDatum>) {
      const scale = yScale as unknown as (value: number) => number;
      return (
        <g stroke={color} strokeWidth={1.5} strokeLinecap="round">
          {bars.map((bar, index) => {
            const row = bar.data.data as MeanRow;
            if (typeof row.lo !== 'number' || typeof row.hi !== 'number') {
              return null;
            }
            const center = bar.x + bar.width / 2;
            const top = scale(row.hi);
            const bottom = scale(row.lo);
            const cap = Math.min(bar.width * 0.4, 12);
            return (
              <g key={`error-${index}`}>
                <line x1={center} x2={center} y1={top} y2={bottom} />
                <line x1={center - cap} x2={center + cap} y1={top} y2={top} />
                <line x1={center - cap} x2={center + cap} y1={bottom} y2={bottom} />
              </g>
            );
          })}
        </g>
      );
    }
    return ErrorBars;
  }, [color]);
}

/** A bar of group means with 95% confidence intervals. */
function MeansChart({ data, reference }: { data: ParsedData; reference?: number }) {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const errorLayer = useErrorBars(palette.foreground);
  const rows: MeanRow[] = meansGroups(data).map((group) => {
    const stats = groupStats(group.values);
    return { label: group.label, mean: stats.mean, lo: stats.lo, hi: stats.hi };
  });
  const defined = rows.filter((row) => Number.isFinite(row.mean));
  const min = defined.reduce((low, row) => Math.min(low, row.lo), 0);
  const max = defined.reduce((high, row) => Math.max(high, row.hi), 1);
  const layers: BarLayer<BarDatum>[] = ['grid', 'axes', 'bars', errorLayer, 'markers'];

  if (defined.length === 0) {
    return <p className="text-body text-muted">Not enough data to draw group means.</p>;
  }

  return (
    <div style={{ height: 236 }}>
      <ResponsiveBar<BarDatum>
        data={rows}
        keys={['mean']}
        indexBy="label"
        margin={{ ...CHART_MARGIN, bottom: 34, left: 40 }}
        padding={0.42}
        colors={[palette.accent]}
        borderRadius={6}
        enableGridX={false}
        axisTop={null}
        axisRight={null}
        axisBottom={{ tickSize: 0, tickPadding: 8 }}
        axisLeft={{ tickSize: 0, tickPadding: 6, tickValues: 5 }}
        valueScale={{ type: 'linear', min: Math.min(0, min), max: max * 1.08 }}
        layers={layers}
        markers={
          reference === undefined
            ? []
            : [
                {
                  axis: 'y',
                  value: reference,
                  lineStyle: { stroke: palette.warning, strokeWidth: 1.5, strokeDasharray: '4 3' },
                },
              ]
        }
        label={(datum) => fmt(Number(datum.value), 2)}
        labelSkipHeight={16}
        enableLabel
        animate={false}
        theme={theme}
        tooltip={({ id, value, indexValue }) => (
          <div className="rounded-xl bg-overlay px-2.5 py-1.5 text-body shadow-lg">
            {indexValue}: <span className="tabular-nums">{fmt(Number(value), 3)}</span>
            <span className="text-meta text-muted"> ({id})</span>
          </div>
        )}
      />
    </div>
  );
}

/** A scatter of ordered values: the shape of one sample. */
function DistributionChart({ data }: { data: ParsedData }) {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const values = data.blocks[0] ?? [];
  const points = [...values].sort((a, b) => a - b).map((value, index) => ({ x: index + 1, y: value }));

  if (points.length < 2) {
    return <p className="text-body text-muted">At least two values are needed to show a distribution.</p>;
  }

  return (
    <div style={{ height: 236 }}>
      <ResponsiveLine
        data={[{ id: 'values', data: points }]}
        margin={{ ...CHART_MARGIN, bottom: 34, left: 44 }}
        xScale={{ type: 'linear' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
        colors={[palette.accent]}
        lineWidth={0}
        enablePoints
        pointSize={7}
        pointBorderWidth={1}
        pointBorderColor={{ from: 'serieColor' }}
        enableGridX={false}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          legend: 'Rank',
          legendOffset: 26,
          legendPosition: 'middle',
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 6,
          tickValues: 5,
          legend: 'Value',
          legendOffset: -34,
          legendPosition: 'middle',
        }}
        enableArea={false}
        useMesh
        animate={false}
        theme={theme}
      />
    </div>
  );
}

/** A points-only scatter, with an optional ordinary-least-squares fit line. */
function ScatterChart({ data, fit }: { data: ParsedData; fit: boolean }) {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const fitLayer = useMemo(() => {
    function FitLine({ series, xScale, yScale }: LineCustomSvgLayerProps<LineSeries>) {
      const observations = series.find((entry) => entry.id === 'observations');
      if (!observations || observations.data.length < 2) {
        return null;
      }
      const xs = observations.data.map((point) => Number(point.data.x));
      const ys = observations.data.map((point) => Number(point.data.y));
      const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
      const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
      let sxy = 0;
      let sxx = 0;
      for (let index = 0; index < xs.length; index += 1) {
        sxy += (xs[index] - meanX) * (ys[index] - meanY);
        sxx += (xs[index] - meanX) ** 2;
      }
      if (sxx === 0) {
        return null;
      }
      const slope = sxy / sxx;
      const intercept = meanY - slope * meanX;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      return (
        <line
          x1={xScale(minX)}
          y1={yScale(intercept + slope * minX)}
          x2={xScale(maxX)}
          y2={yScale(intercept + slope * maxX)}
          stroke={palette.warning}
          strokeWidth={2}
          strokeDasharray="5 3"
        />
      );
    }
    return FitLine;
  }, [palette.warning]);

  const xs = data.blocks[0] ?? [];
  const ys = data.pairs[0] ?? [];
  const count = Math.min(xs.length, ys.length);
  const points = Array.from({ length: count }, (_, index) => ({ x: xs[index], y: ys[index] }));

  if (points.length < 3) {
    return <p className="text-body text-muted">At least three pairs are needed to draw a relationship.</p>;
  }

  const layers: LineSvgLayer<LineSeries>[] | undefined = fit
    ? ['grid', 'axes', 'lines', 'points', fitLayer]
    : undefined;

  return (
    <div style={{ height: 244 }}>
      <ResponsiveLine<LineSeries>
        data={[{ id: 'observations', data: points }]}
        margin={{ ...CHART_MARGIN, bottom: 34, left: 44 }}
        xScale={{ type: 'linear' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
        colors={[palette.accent]}
        lineWidth={0}
        enablePoints
        pointSize={7}
        pointBorderWidth={1}
        pointBorderColor={{ from: 'serieColor' }}
        enableGridX={false}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          legend: 'Predictor',
          legendOffset: 30,
          legendPosition: 'middle',
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 6,
          tickValues: 5,
          legend: 'Response',
          legendOffset: -38,
          legendPosition: 'middle',
        }}
        enableArea={false}
        enableSlices="x"
        sliceTooltip={({ slice }) => (
          <LineTooltip slice={slice as never} seriesNames={{ observations: 'Observation' }} />
        )}
        animate={false}
        theme={theme}
        layers={layers}
      />
    </div>
  );
}

/** Observed counts against the counts expected under independence. */
function CategoriesChart({ data }: { data: ParsedData }) {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const table = data.matrix.filter((row) => row.length > 0);
  const width = table[0]?.length ?? 0;
  const columns = Array.from({ length: width }, (_, index) =>
    table.reduce((total, row) => total + (row[index] ?? 0), 0),
  );
  const grand = columns.reduce((total, value) => total + value, 0);
  const uniform = grand / (width || 1);
  const rows = columns.map((observed, index) => ({
    label: `Category ${index + 1}`,
    observed,
    expected: uniform,
  }));

  if (rows.length < 2) {
    return (
      <p className="text-body text-muted">A table with at least two categories is needed to draw counts.</p>
    );
  }

  return (
    <div style={{ height: 236 }}>
      <ResponsiveBar
        data={rows}
        keys={['observed', 'expected']}
        indexBy="label"
        groupMode="grouped"
        margin={{ ...CHART_MARGIN, bottom: 34, left: 40 }}
        padding={0.32}
        colors={[palette.accent, palette.muted]}
        borderRadius={4}
        enableGridX={false}
        axisTop={null}
        axisRight={null}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          legend: 'Category',
          legendOffset: 30,
          legendPosition: 'middle',
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 6,
          tickValues: 5,
          legend: 'Count',
          legendOffset: -38,
          legendPosition: 'middle',
        }}
        label={(datum) => Number(datum.value).toLocaleString('en-US')}
        labelSkipHeight={16}
        enableLabel
        tooltip={(props) => (
          <BarTooltip {...props} seriesNames={{ observed: 'Observed', expected: 'Expected' }} />
        )}
        animate={false}
        theme={theme}
      />
    </div>
  );
}

/** One adjusted p-value per test, with the significance threshold marked. */
function PValuesChart({ data }: { data: ParsedData }) {
  const theme = useChartTheme();
  const palette = useChartPalette();
  const alpha = 0.05;
  const rows = data.pEntries.map((entry) => ({
    label: entry.label,
    adjusted: entry.p,
    color: entry.p < alpha ? palette.accent : palette.muted,
  }));

  if (rows.length === 0) {
    return <p className="text-body text-muted">No p-values to adjust yet.</p>;
  }

  return (
    <div style={{ height: Math.max(160, rows.length * 28 + 24) }}>
      <ResponsiveBar<BarDatum>
        data={rows}
        keys={['adjusted']}
        indexBy="label"
        layout="horizontal"
        margin={{ top: 8, right: 40, bottom: 24, left: 130 }}
        padding={0.32}
        colors={({ data: datum }) => String(datum.color)}
        borderRadius={4}
        labelPosition="end"
        labelOffset={7}
        labelSkipWidth={0}
        label={(datum) => fmt(Number(datum.value), 3)}
        enableGridX
        enableGridY={false}
        axisTop={null}
        axisRight={null}
        axisBottom={{
          tickSize: 0,
          tickPadding: 6,
          tickValues: 4,
          legend: 'Adjusted p',
          legendOffset: 28,
          legendPosition: 'middle',
        }}
        axisLeft={{ tickSize: 0, tickPadding: 8 }}
        tooltip={(props) => <BarTooltip {...props} seriesNames={{ adjusted: 'Adjusted p' }} />}
        markers={[
          {
            axis: 'x',
            value: alpha,
            lineStyle: { stroke: palette.warning, strokeWidth: 1, strokeDasharray: '4 3' },
          },
        ]}
        animate={false}
        theme={theme}
      />
    </div>
  );
}

/** The one chart that fits the selected procedure. */
function ProcedureChart({ chart, data, fit }: { chart: ChartKind; data: ParsedData; fit?: boolean }) {
  if (chart === 'none') {
    return null;
  }
  const caption =
    chart === 'means'
      ? 'Mean with 95% CI'
      : chart === 'scatter'
        ? fit
          ? 'Observed pairs with the fitted line'
          : 'Observed pairs'
        : chart === 'categories'
          ? 'Observed vs uniform expectation'
          : chart === 'pvalues'
            ? 'Adjusted p-values at α 0.05'
            : 'Ordered values';

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
      <div className="flex items-baseline gap-2">
        <SectionLabel>Chart</SectionLabel>
        <span className="ml-auto text-meta text-muted">{caption}</span>
      </div>
      {chart === 'means' && <MeansChart data={data} />}
      {chart === 'distribution' && <DistributionChart data={data} />}
      {chart === 'scatter' && <ScatterChart data={data} fit={fit ?? false} />}
      {chart === 'categories' && <CategoriesChart data={data} />}
      {chart === 'pvalues' && <PValuesChart data={data} />}
    </section>
  );
}

/* ================================================================================================
 * Reproduce
 * ============================================================================================== */

/** Copy a code block; the icon flips to a check for a moment. */
function CopyCode({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCopy();

  const onCopy = () => {
    copy(source, 'code');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <IconButton aria-label="Copy code" onPress={onCopy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

/** The code that recomputes the selected result. */
function Reproduce({ code }: { code: { r?: string; python: string } }) {
  return (
    <Collapsible title="Reproduce" defaultExpanded={false}>
      <div className="flex flex-col gap-3">
        {(['python', 'r'] as const).map((language) => {
          const source = code[language];
          if (!source) return null;
          return (
            <div key={language} className="rounded-2xl bg-surface p-3">
              <div className="flex items-center gap-2">
                <SectionLabel>{language === 'r' ? 'R' : 'Python'}</SectionLabel>
                <div className="ml-auto">
                  <CopyCode source={source} />
                </div>
              </div>
              <pre className="mt-2 overflow-x-auto text-meta whitespace-pre-wrap text-muted">{source}</pre>
            </div>
          );
        })}
      </div>
    </Collapsible>
  );
}

/* ================================================================================================
 * Shared sections
 * ============================================================================================== */

/** The assumption marks for a procedure. */
function AssumptionList({ checks }: { checks: AssumptionCheck[] }) {
  if (checks.length === 0) {
    return (
      <p className="text-body text-muted">
        The current data does not meet this procedure&rsquo;s shape, so nothing can be checked yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((check) => {
        const mark = CHECK_MARK[check.status];
        const Icon = mark.icon;
        return (
          <li key={check.name} className="flex items-start gap-2.5">
            <Icon className={cn('mt-0.5 size-4 shrink-0', mark.tone)} aria-hidden />
            <span className="min-w-0">
              <span className="block text-label text-foreground">{check.name}</span>
              <span className="block text-meta text-muted">{check.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** What a custom procedure declares about itself, before there is a result. */
function DeclaredAssumptions({ procedure }: { procedure: ProcedureManifest }) {
  if (procedure.assumptions.length === 0) {
    return <p className="text-body text-muted">This procedure declares no assumptions.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {procedure.assumptions.map((assumption) => (
        <li key={assumption.name} className="flex items-start gap-2.5">
          <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0">
            <span className="block text-label text-foreground">{assumption.name}</span>
            <span className="block text-meta text-muted">{assumption.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A result row list with a title and a note. */
function ResultBlock({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
      className="flex flex-col gap-3 rounded-3xl bg-surface p-4"
    >
      <div className="flex items-baseline gap-2">
        <SectionLabel>{title}</SectionLabel>
        {meta && <span className="ml-auto text-meta text-muted">{meta}</span>}
      </div>
      {children}
    </motion.section>
  );
}

/* ================================================================================================
 * Drafts
 * ============================================================================================== */

/** Everything the page remembers about one procedure's input. */
interface Draft {
  text: string;
  options: ReadOptions;
  plan: DataPlan;
  params: Record<string, string | number | boolean>;
}

/** A draft for a built-in procedure, starting at its example. */
function draftFor(procedure: Procedure): Draft {
  const dataset = readDataset(procedure.example);
  return {
    text: procedure.example,
    options: {},
    plan: suggestPlan(dataset, procedure.shape),
    params: {},
  };
}

/**
 * A draft for a custom procedure, starting from a small sample of its shape.
 *
 * The manifest's declared column roles are applied when the sample's names match them; a
 * procedure written for a `group`/`value` table then opens with those columns already chosen.
 */
function draftForCustom(manifest: ProcedureManifest): Draft {
  const text = sampleForShape(manifest.data.shape);
  const dataset = readDataset(text);
  const plan = suggestPlan(dataset, manifest.data.shape);
  for (const declared of manifest.data.columns ?? []) {
    const found = dataset.columns.find((column) => column.name.toLowerCase() === declared.name.toLowerCase());
    if (found) {
      plan.roles[declared.role] = found.key;
    }
  }
  return { text, options: {}, plan, params: defaultParams(manifest) };
}

/** A paste a reader can replace, per shape. */
function sampleForShape(shape: DataShape): string {
  switch (shape) {
    case 'values':
      return column([12.4, 11.8, 13.1, 12.9, 12.2, 13.6, 11.9, 12.7, 13.3, 12.5, 12.1, 13.0]);
    case 'groups':
      return lineRows(
        'control 9.8',
        'control 10.4',
        'control 9.5',
        'treated 11.2',
        'treated 10.8',
        'treated 11.6',
      );
    case 'pairs':
      return lineRows('1.2 3.1', '1.8 4.0', '2.4 4.6', '3.1 5.9', '3.6 6.2', '4.4 7.5');
    case 'table':
      return lineRows('42 18 8', '30 26 14', '12 24 36');
    case 'pvalues':
      return lineRows('Calibration 0.012', 'Per-guide AUROC 0.031', 'Seed stability 0.084');
    default:
      return '';
  }
}

/** Re-read the text, keeping the plan when its columns still exist. */
function withText(draft: Draft, text: string, options: ReadOptions, shape: DataShape): Draft {
  const dataset = readDataset(text, options);
  const keys = new Set(dataset.columns.map((column) => column.key));
  const roles = Object.fromEntries(
    Object.entries(draft.plan.roles).filter(([, key]) => key !== undefined && keys.has(key)),
  ) as Draft['plan']['roles'];
  const plan = { ...draft.plan, roles };
  const complete = planReady(dataset, plan);
  return { ...draft, text, options, plan: complete ? plan : suggestPlan(dataset, shape) };
}

/* ================================================================================================
 * Rail
 * ============================================================================================== */

/** One row in the procedure rail. */
function ProcedureRow({
  name,
  hint,
  icon: Icon,
  selected,
  badge,
  onSelect,
  actions,
}: {
  name: string;
  hint: string;
  icon: LucideIcon;
  selected: boolean;
  badge?: ReactNode;
  onSelect: () => void;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'group flex w-full items-start gap-1 rounded-xl pr-1 transition-colors',
        selected ? 'bg-surface' : 'hover:bg-surface',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left"
      >
        <span className="flex items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-body text-foreground">{name}</span>
          {badge}
        </span>
        <span className="line-clamp-2 text-meta text-muted">{hint}</span>
      </button>
      {actions && (
        <span className="flex shrink-0 items-center pt-1.5 opacity-0 group-hover:opacity-100">{actions}</span>
      )}
    </div>
  );
}

/* ================================================================================================
 * Built-in workbench
 * ============================================================================================== */

function BuiltinWorkbench({
  procedure,
  draft,
  result,
  workspace,
  onChange,
  onRun,
}: {
  procedure: Procedure;
  draft: Draft;
  result?: ReproducibleResult<unknown>;
  workspace: string | null;
  onChange: (draft: Draft) => void;
  onRun: (result: ReproducibleResult<unknown>) => void;
}) {
  const dataset = useMemo(() => readDataset(draft.text, draft.options), [draft.text, draft.options]);
  const data = useMemo(() => toParsedData(dataset, draft.plan), [dataset, draft.plan]);
  const preview = useMemo(() => previewOf(procedure, data), [procedure, data]);
  const values = result && !result.error ? (result.values as Values) : {};
  const facts = result && !result.error ? resultFacts(procedure.id, values) : { rows: [], note: undefined };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SectionLabel>{procedure.family}</SectionLabel>
          {!preview.checkable && (
            <Chip size="sm" variant="soft" color="warning">
              <AlertTriangle className="size-3" aria-hidden />
              Assumptions unchecked
            </Chip>
          )}
        </div>
        <h1 className="text-[1.45rem] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {procedure.name}
        </h1>
      </header>

      <DataPanel
        shape={procedure.shape}
        dataset={dataset}
        plan={draft.plan}
        text={draft.text}
        options={draft.options}
        sample={procedure.example}
        hint={procedure.dataHint}
        workspace={workspace}
        onText={(text) => onChange(withText(draft, text, draft.options, procedure.shape))}
        onOptions={(options) => onChange(withText(draft, draft.text, options, procedure.shape))}
        onPlan={(plan) => onChange({ ...draft, plan })}
      />

      <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Assumptions</SectionLabel>
          <span className="ml-auto text-meta text-muted">Checked before you run</span>
        </div>
        <AssumptionList checks={preview.checks} />
      </section>

      <div>
        <Button
          variant="primary"
          className="gap-2"
          isDisabled={!preview.ready}
          onPress={() => onRun(procedure.run(data))}
        >
          <Play className="size-3.5" />
          Run
        </Button>
      </div>

      {result?.error && (
        <p className="flex items-center gap-2 text-body text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {result.error}
        </p>
      )}

      {result && !result.error && (
        <ResultBlock title="Result" meta={result.test.replace(/-/g, ' ')}>
          <p className="text-body text-foreground">{result.summary}</p>
          <div className="flex flex-col gap-2">
            {facts.rows.map((row) => (
              <FactRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
          {procedure.id === 'multiple' && (
            <ul className="mt-1 flex flex-col gap-1.5">
              {(
                (values.results as
                  { label: string; p: number; adjusted: number; rejected: boolean }[] | undefined) ?? []
              ).map((entry) => (
                <li key={entry.label} className="flex items-baseline gap-3 text-body">
                  <span className="min-w-0 flex-1 truncate text-muted">{entry.label}</span>
                  <span className="shrink-0 text-meta tabular-nums text-muted">p = {fmt(entry.p, 3)}</span>
                  <span
                    className={cn(
                      'w-20 shrink-0 text-right tabular-nums',
                      entry.rejected ? 'text-success' : 'text-muted',
                    )}
                  >
                    {fmt(entry.adjusted, 3)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {facts.note && <p className="text-meta text-muted">{facts.note}</p>}
          <Reproduce code={result.code} />
        </ResultBlock>
      )}

      <ProcedureChart chart={procedure.chart} data={data} fit={procedure.id === 'regression'} />
    </div>
  );
}

/* ================================================================================================
 * Custom workbench
 * ============================================================================================== */

function CustomWorkbench({
  procedure,
  draft,
  run,
  busy,
  workspace,
  onChange,
  onRun,
  onEdit,
}: {
  procedure: CustomProcedure;
  draft: Draft;
  run?: CustomRun;
  busy: boolean;
  workspace: string | null;
  onChange: (draft: Draft) => void;
  onRun: () => void;
  onEdit: () => void;
}) {
  const manifest = procedure.manifest!;
  const dataset = useMemo(() => readDataset(draft.text, draft.options), [draft.text, draft.options]);
  const data = useMemo(() => toParsedData(dataset, draft.plan), [dataset, draft.plan]);
  const ready = planReady(dataset, draft.plan);
  const values = run?.values ?? {};

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SectionLabel>{manifest.family}</SectionLabel>
          <Chip size="sm" variant="soft" color="accent">
            workspace
          </Chip>
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" className="gap-1.5" onPress={onEdit}>
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Button>
          </span>
        </div>
        <h1 className="text-[1.45rem] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {manifest.name}
        </h1>
      </header>

      <DataPanel
        shape={manifest.data.shape}
        dataset={dataset}
        plan={draft.plan}
        text={draft.text}
        options={draft.options}
        sample={sampleForShape(manifest.data.shape)}
        hint={manifest.data.shape === 'groups' ? 'The first two groups are used, in order.' : undefined}
        workspace={workspace}
        onText={(text) => onChange(withText(draft, text, draft.options, manifest.data.shape))}
        onOptions={(options) => onChange(withText(draft, draft.text, options, manifest.data.shape))}
        onPlan={(plan) => onChange({ ...draft, plan })}
      />

      {manifest.params.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Parameters</SectionLabel>
          <ParameterPanel
            params={manifest.params}
            values={draft.params}
            onChange={(name, value) => onChange({ ...draft, params: { ...draft.params, [name]: value } })}
          />
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Assumptions</SectionLabel>
          <span className="ml-auto text-meta text-muted">
            {run && run.assumptions.length > 0 ? 'Reported by the procedure' : 'Declared by the manifest'}
          </span>
        </div>
        {run && run.assumptions.length > 0 ? (
          <AssumptionList checks={run.assumptions} />
        ) : (
          <DeclaredAssumptions procedure={manifest} />
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" className="gap-2" isDisabled={!ready || busy} onPress={onRun}>
          <Play className="size-3.5" />
          {busy ? 'Running…' : 'Run'}
        </Button>
        <span className="text-meta text-muted">
          Runs <code>{`${procedure.dir}/procedure.py`}</code> with python3, through the Execution setting.
        </span>
      </div>

      {run && !run.ok && (
        <section className="flex flex-col gap-2 rounded-3xl bg-surface p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
            <SectionLabel>Run failed</SectionLabel>
          </div>
          <pre className="max-h-64 overflow-auto text-meta whitespace-pre-wrap text-muted">{run.output}</pre>
        </section>
      )}

      {run && run.ok && (
        <ResultBlock title="Result" meta={manifest.id}>
          {run.summary && <p className="text-body text-foreground">{run.summary}</p>}
          <div className="flex flex-col gap-2">
            {manifest.outputs.map((output) => (
              <FactRow key={output.key} label={output.label} value={outputValue(output, values)} />
            ))}
          </div>
          <Reproduce code={run.code} />
        </ResultBlock>
      )}

      <ProcedureChart
        chart={manifest.chart}
        data={data}
        fit={manifest.chart === 'scatter' && manifest.id.includes('regress')}
      />
    </div>
  );
}

/* ================================================================================================
 * Page
 * ============================================================================================== */

/**
 * The statistics page.
 *
 * Left: the procedures, grouped by family, then the workspace's own. Right: the selected one,
 * with its data mapped, its assumptions read, and the result it produced.
 */
export function StatisticsWorkbench() {
  usePageTitle('Statistics');
  const { state } = useApp();
  const workspace = activeProject(state)?.path ?? null;
  const execution = state.execution;
  const custom = useCustomProcedures();

  const [selectedId, setSelectedId] = useState('welch');
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(PROCEDURES.map((procedure) => [procedure.id, draftFor(procedure)])),
  );
  const [results, setResults] = useState<Record<string, ReproducibleResult<unknown>>>({});
  const [runs, setRuns] = useState<Record<string, CustomRun>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<{ open: boolean; editing?: CustomProcedure }>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<CustomProcedure | null>(null);

  // The workspace's procedures are read when the folder changes, the way its figures are.
  useEffect(() => {
    if (workspace) void loadWorkspaceStatistics(workspace);
  }, [workspace]);

  const builtin = PROCEDURES.find((procedure) => procedure.id === selectedId);
  const selectedCustom = custom.find((procedure) => procedure.id === selectedId && procedure.manifest);

  // A custom procedure's draft is created the first time it is selected, from its shape.
  const customDraft = selectedCustom?.manifest ? drafts[selectedCustom.id] : undefined;
  const draft =
    builtin !== undefined
      ? (drafts[builtin.id] ?? draftFor(builtin))
      : (customDraft ?? (selectedCustom?.manifest ? draftForCustom(selectedCustom.manifest) : undefined));

  useEffect(() => {
    if (!selectedCustom?.manifest) return;
    if (drafts[selectedCustom.id]) return;
    setDrafts((current) => ({ ...current, [selectedCustom.id]: draftForCustom(selectedCustom.manifest!) }));
  }, [selectedCustom, drafts]);

  const setDraft = (id: string, next: Draft) => setDrafts((current) => ({ ...current, [id]: next }));

  const runCustom = async (procedure: CustomProcedure) => {
    if (!procedure.manifest || !draft || !workspace) return;
    setBusy((current) => ({ ...current, [procedure.id]: true }));
    const params = Object.fromEntries(
      procedure.manifest.params.map((parameter) => [
        parameter.name,
        readParam(parameter, draft.params[parameter.name]),
      ]),
    );
    const dataset = readDataset(draft.text, draft.options);
    const run = await runCustomProcedure({
      procedure: procedure.manifest,
      dataset,
      plan: draft.plan,
      params,
      root: workspace,
      execution,
    });
    setRuns((current) => ({ ...current, [procedure.id]: run }));
    setBusy((current) => ({ ...current, [procedure.id]: false }));
  };

  const saveProcedure = async (input: { yaml: string; python: string }): Promise<string[]> => {
    if (!workspace) {
      return ['Open a workspace folder first: a procedure is a file in it.'];
    }
    const saved = await saveCustomProcedure({
      root: workspace,
      yaml: input.yaml,
      python: input.python,
      previous: editor.editing,
    });
    if (!saved.ok) return saved.errors;
    setSelectedId(saved.procedure.id);
    return [];
  };

  const remove = async (procedure: CustomProcedure) => {
    setPendingDelete(null);
    if (!workspace) return;
    await removeCustomProcedure(workspace, procedure.id);
    if (selectedId === procedure.id) setSelectedId('welch');
  };

  const broken = custom.filter((procedure) => !procedure.manifest);

  // Writing a procedure is its own page: the rail and the result view belong to running one.
  if (editor.open) {
    return (
      <ProcedurePage
        initial={
          editor.editing
            ? {
                manifest: editor.editing.manifest,
                python: editor.editing.python,
                id: editor.editing.id,
              }
            : undefined
        }
        onBack={() => setEditor({ open: false })}
        onSave={saveProcedure}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[264px] shrink-0 md:block">
        <ScrollShadow className="flex h-full flex-col gap-4 px-3 py-6">
          <header className="flex flex-col gap-1 px-1">
            <h1 className="text-title text-foreground">Statistics</h1>
          </header>

          <nav aria-label="Procedures" className="flex flex-col gap-4">
            {FAMILIES.map((family) => {
              const members = PROCEDURES.filter((procedure) => procedure.family === family);
              if (members.length === 0) return null;
              const Icon = FAMILY_ICON[family];
              return (
                <section key={family} className="flex flex-col gap-1">
                  <header className="flex items-center gap-1.5 px-1">
                    <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
                    <SectionLabel>{family}</SectionLabel>
                    <span className="ml-auto text-meta tabular-nums text-muted">{members.length}</span>
                  </header>
                  {members.map((procedure) => (
                    <ProcedureRow
                      key={procedure.id}
                      name={procedure.name}
                      hint={procedure.useWhen}
                      icon={Icon}
                      selected={procedure.id === selectedId}
                      onSelect={() => setSelectedId(procedure.id)}
                    />
                  ))}
                </section>
              );
            })}

            <section className="flex flex-col gap-1">
              <header className="flex items-center gap-1.5 px-1">
                <CUSTOM_ICON className="size-3.5 shrink-0 text-muted" aria-hidden />
                <SectionLabel>Workspace</SectionLabel>
                <span className="ml-auto text-meta tabular-nums text-muted">{custom.length}</span>
                <IconButton aria-label="New procedure" onPress={() => setEditor({ open: true })}>
                  <Plus className="size-3.5" />
                </IconButton>
              </header>
              {custom.length === 0 && (
                <p className="px-2.5 text-meta text-muted">
                  No procedures yet. A folder under <code>.openlab/statistics/</code> adds one.
                </p>
              )}
              {custom.map((procedure) => (
                <ProcedureRow
                  key={procedure.id}
                  name={procedure.manifest?.name ?? procedure.id}
                  hint={procedure.manifest?.summary ?? procedure.errors[0] ?? 'Not readable'}
                  icon={CUSTOM_ICON}
                  selected={procedure.id === selectedId}
                  badge={
                    procedure.manifest ? undefined : (
                      <Chip size="sm" variant="soft" color="warning">
                        <AlertTriangle className="size-3" aria-hidden />
                        Fix
                      </Chip>
                    )
                  }
                  onSelect={() => setSelectedId(procedure.id)}
                  actions={
                    <IconButton
                      aria-label={`Remove ${procedure.id}`}
                      onPress={() => setPendingDelete(procedure)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  }
                />
              ))}
            </section>
          </nav>
        </ScrollShadow>
      </aside>

      <ScrollShadow className="min-w-0 flex-1 px-6 py-6">
        <div className="flex w-full flex-col gap-6">
          <div className="md:hidden">
            <Select
              label="Procedure"
              value={selectedId}
              options={[
                ...PROCEDURES.map((procedure) => ({ value: procedure.id, label: procedure.name })),
                ...custom.map((procedure) => ({
                  value: procedure.id,
                  label: procedure.manifest?.name ?? procedure.id,
                })),
              ]}
              onChange={setSelectedId}
              className="w-full"
            />
          </div>

          {builtin && draft && (
            <BuiltinWorkbench
              key={builtin.id}
              procedure={builtin}
              draft={draft}
              result={results[builtin.id]}
              workspace={workspace}
              onChange={(next) => setDraft(builtin.id, next)}
              onRun={(result) => setResults((current) => ({ ...current, [builtin.id]: result }))}
            />
          )}

          {!builtin && selectedCustom?.manifest && draft && (
            <CustomWorkbench
              key={selectedCustom.id}
              procedure={selectedCustom}
              draft={draft}
              run={runs[selectedCustom.id]}
              busy={busy[selectedCustom.id] ?? false}
              workspace={workspace}
              onChange={(next) => setDraft(selectedCustom.id, next)}
              onRun={() => void runCustom(selectedCustom)}
              onEdit={() => setEditor({ open: true, editing: selectedCustom })}
            />
          )}

          {!builtin && !selectedCustom && (
            <section className="flex flex-col gap-3">
              <h1 className="text-title text-foreground">
                {broken.find((procedure) => procedure.id === selectedId)?.id ?? 'Procedure'}
              </h1>
              <p className="text-body text-warning">This procedure could not be read.</p>
              <ul className="flex flex-col gap-1">
                {(broken.find((procedure) => procedure.id === selectedId)?.errors ?? []).map((error) => (
                  <li key={error} className="text-meta text-muted">
                    {error}
                  </li>
                ))}
              </ul>
              {broken.find((procedure) => procedure.id === selectedId) && (
                <div>
                  <Button
                    variant="primary"
                    onPress={() =>
                      setEditor({
                        open: true,
                        editing: broken.find((procedure) => procedure.id === selectedId),
                      })
                    }
                  >
                    Fix procedure
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      </ScrollShadow>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Remove this procedure?"
        description="Its two files are deleted from .openlab/statistics/. A committed copy stays in git."
        width={480}
        footer={
          <>
            <Button variant="ghost" onPress={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                if (pendingDelete) void remove(pendingDelete);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-body text-muted">{pendingDelete?.dir}</p>
      </Dialog>
    </div>
  );
}
