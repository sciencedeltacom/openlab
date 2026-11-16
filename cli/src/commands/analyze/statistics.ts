/**
 * The statistical engine, at the terminal.
 *
 * `lib/science/stats` is pure: it takes numbers and returns a result with its assumptions and
 * the R and Python that recompute it. That is the whole point of the workbench, and a CLI is
 * where it is easiest to check — pipe a CSV in, read the summary, and take the reproduction
 * with `--code`.
 *
 * Data arrives three ways: `--data <file.csv>` with `--value`/`--group` (or `--x`/`--y`), a
 * `--data -` on stdin, or the numbers inline with `--a`/`--b`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Args, Flags } from '@oclif/core';

import {
  adjustPValues,
  anovaOneWay,
  chiSquareTest,
  describe,
  linearRegression,
  normalityScreen,
  oneSampleTTest,
  pairedTTest,
  pearsonCorrelation,
  welchTTest,
  type Alternative,
  type ReproducibleResult,
} from '@/lib/science/stats';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** The tests this command runs. */
const TESTS = [
  'describe',
  'ttest',
  'paired',
  'onesample',
  'anova',
  'chi',
  'corr',
  'regress',
  'adjust',
] as const;
type TestName = (typeof TESTS)[number];

/** A table of columns, as a CSV or TSV file reads. */
type Table = { columns: string[]; rows: Record<string, string>[] };

/** Split one delimited line, honouring quotes. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/** Read a delimited table, taking the delimiter from the header. */
function parseTable(text: string): Table {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) {
    throw new Error('the data is empty');
  }
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const columns = splitLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, delimiter);
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? '']));
  });
  return { columns, rows };
}

/** Numbers from one column, dropping what is not a number. */
function column(table: Table, name: string): number[] {
  if (!table.columns.includes(name)) {
    throw new Error(`no column “${name}”; the file has ${table.columns.join(', ')}`);
  }
  return table.rows.map((row) => Number(row[name])).filter((value) => Number.isFinite(value));
}

/** Numbers from an inline list. */
function inline(raw: string | undefined, what: string): number[] {
  if (!raw) {
    throw new Error(`give ${what}`);
  }
  const values = raw
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    throw new Error(`${what} holds no numbers`);
  }
  return values;
}

export default class Statistics extends LabCommand {
  static description = 'Run a statistical test and get its assumptions and its reproduction';

  static args = {
    test: Args.string({
      description: 'Which test',
      required: true,
      options: [...TESTS],
    }),
  };

  static flags = {
    data: Flags.string({ description: 'A CSV/TSV file, or `-` for stdin' }),
    value: Flags.string({ description: 'The column holding the measurements' }),
    group: Flags.string({ description: 'The column that separates two groups (ttest)' }),
    x: Flags.string({ description: 'The predictor column (corr, regress)' }),
    y: Flags.string({ description: 'The response column (corr, regress)' }),
    groups: Flags.string({ description: 'Comma-separated group columns (anova)' }),
    table: Flags.string({ description: 'A contingency table: rows by `;`, cells by `,` (chi)' }),
    a: Flags.string({ description: 'Inline values for the first group (or the only one)' }),
    b: Flags.string({ description: 'Inline values for the second group' }),
    p: Flags.string({ description: 'Comma-separated p-values with labels, `label=p` (adjust)' }),
    labels: Flags.string({ description: 'Comma-separated group labels (anova)' }),
    confidence: Flags.string({ description: 'Confidence level', default: '0.95' }),
    alternative: Flags.string({
      description: 'One- or two-sided',
      options: ['two-sided', 'greater', 'less'],
      default: 'two-sided',
    }),
    method: Flags.string({
      description: 'Correction for adjust',
      options: ['bh', 'bonferroni'],
      default: 'bh',
    }),
    alpha: Flags.string({ description: 'Significance level for adjust', default: '0.05' }),
    code: Flags.boolean({ description: 'Print the R and Python that recompute this result' }),
    checks: Flags.boolean({ description: 'Print the assumption checks', default: true, allowNo: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Statistics);
    const test = args.test as TestName;
    const confidence = Number(flags.confidence);
    const table = flags.data
      ? parseTable(flags.data === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(flags.data), 'utf8'))
      : null;
    const alternative = flags.alternative as Alternative;

    const result = this.run_(test, table, flags, confidence, alternative);
    if (result.error) {
      this.fail(`${result.test}: ${result.error}`);
    }

    this.emit(result, (value) =>
      [
        `${out.c.bold(value.test)}  ${out.c.cyan(value.summary)}`,
        '',
        out.keyValues(
          Object.entries(value.values as Record<string, unknown>).map(([key, raw]) => [
            key,
            typeof raw === 'number'
              ? Number.isInteger(raw)
                ? String(raw)
                : raw.toPrecision(6)
              : JSON.stringify(raw),
          ]),
        ),
        ...(flags.checks && value.assumptions.length > 0
          ? [
              '',
              out.heading('Assumptions'),
              out.bullets(
                value.assumptions.map(
                  (check) =>
                    `${check.status === 'pass' ? out.mark.ok : check.status === 'fail' ? out.mark.bad : check.status === 'warn' ? out.mark.warn : out.mark.skip} ${check.name}: ${check.detail}${check.p !== undefined ? out.c.grey(` (p = ${check.p.toPrecision(3)})`) : ''}`,
                ),
              ),
            ]
          : []),
        ...(flags.code
          ? [
              '',
              out.heading('R'),
              '```r',
              value.code.r,
              '```',
              '',
              out.heading('Python'),
              '```python',
              value.code.python,
              '```',
            ]
          : ['', out.note('`--code` prints the R and Python that recompute this.')]),
      ].join('\n'),
    );
  }

  /** Dispatch to the engine, so the switch reads as the list of tests. */
  private run_(
    test: TestName,
    table: Table | null,
    flags: Record<string, string | boolean | undefined>,
    confidence: number,
    alternative: Alternative,
  ): ReproducibleResult<Record<string, unknown>> {
    const values = () => {
      if (table && typeof flags.value === 'string') return column(table, flags.value);
      return inline(typeof flags.a === 'string' ? flags.a : undefined, '--a');
    };
    const second = () => {
      if (table && typeof flags.group === 'string' && typeof flags.value === 'string') {
        const split = new Map<string, number[]>();
        for (const row of table.rows) {
          const key = row[flags.group];
          const value = Number(row[flags.value]);
          if (!Number.isFinite(value)) continue;
          split.set(key, [...(split.get(key) ?? []), value]);
        }
        const groups = [...split.values()];
        if (groups.length < 2) throw new Error(`“${flags.group}” has fewer than two groups`);
        return groups;
      }
      return [inline(typeof flags.b === 'string' ? flags.b : undefined, '--b')];
    };
    const cast = (result: ReproducibleResult<unknown>) =>
      result as ReproducibleResult<Record<string, unknown>>;

    switch (test) {
      case 'describe': {
        const one = values();
        return cast(describe(one, confidence));
      }
      case 'ttest': {
        const groups = second();
        return cast(welchTTest(values(), groups[0]!, { confidence, alternative }));
      }
      case 'paired': {
        const groups = second();
        return cast(pairedTTest(values(), groups[0]!, { confidence, alternative }));
      }
      case 'onesample': {
        const one = values();
        const screen = normalityScreen(one);
        return cast({ ...oneSampleTTest(one, 0, { confidence, alternative }), assumptions: [screen] });
      }
      case 'anova': {
        if (!table) throw new Error('anova needs --data with --groups');
        const names = (typeof flags.groups === 'string' ? flags.groups : '')
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean);
        if (names.length < 2) throw new Error('give two or more columns with --groups');
        return cast(
          anovaOneWay(
            names.map((name) => column(table, name)),
            { labels: names },
          ),
        );
      }
      case 'chi': {
        if (typeof flags.table !== 'string') throw new Error('give the table with --table "1,2;3,4"');
        const rows = flags.table.split(';').map((row) => row.split(',').map((cell) => Number(cell.trim())));
        return cast(chiSquareTest(rows));
      }
      case 'corr': {
        if (table && typeof flags.x === 'string' && typeof flags.y === 'string') {
          return cast(pearsonCorrelation(column(table, flags.x), column(table, flags.y), { confidence }));
        }
        return cast(pearsonCorrelation(values(), second()[0]!, { confidence }));
      }
      case 'regress': {
        if (table && typeof flags.x === 'string' && typeof flags.y === 'string') {
          return cast(linearRegression(column(table, flags.x), column(table, flags.y), { confidence }));
        }
        return cast(linearRegression(values(), second()[0]!, { confidence }));
      }
      case 'adjust': {
        const entries = (typeof flags.p === 'string' ? flags.p : '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part, index) => {
            const [label, value] = part.includes('=') ? part.split('=') : [`p${index + 1}`, part];
            return { label: label!.trim(), p: Number(value) };
          });
        return cast(
          adjustPValues(entries, {
            method: flags.method as 'bh' | 'bonferroni',
            alpha: Number(flags.alpha),
          }),
        );
      }
      default:
        throw new Error(`unknown test ${test}`);
    }
  }
}
