/**
 * A dataset, read from whatever the reader has.
 *
 * The workbench used to take one shape of input: numbers, one per line, groups separated by
 * blank lines. That is a fine paste target and a poor file format, so this module reads the
 * formats a dataset actually arrives in — CSV, TSV, semicolon tables, JSON, and the plain
 * paste above — into one table of typed columns.
 *
 * The engine is not touched by any of this: `toParsedData` turns the table back into the
 * groups, pairs, matrix and p-value rows the procedures already consume. A CSV and a paste
 * therefore reach `welchTTest` by the same path, and cannot disagree about what the data is.
 *
 * It is pure — no React, no IPC — so `scripts/verify-statistics.ts` can test it.
 */

/** One cell, as the reader gave it. */
export type Cell = string | number | null;

/** What one column holds. */
export type ColumnType = 'number' | 'text';

/** A column with the facts the picker needs. */
export interface DatasetColumn {
  /** Stable key: the header, or `V1` when there was none. */
  key: string;
  name: string;
  type: ColumnType;
  /** Cells that are neither empty nor a number. Zero for a text column. */
  missing: number;
}

/** A table read from text. */
export interface Dataset {
  columns: DatasetColumn[];
  rows: Cell[][];
  /**
   * The blank-line-separated block each row came from, starting at 1. A paste that separates
   * groups with a blank line keeps those groups; a CSV has one block.
   */
  blockOf: number[];
  format: DatasetFormat;
  delimiter?: string;
  problems: string[];
}

/** How the text was read. */
export type DatasetFormat = 'csv' | 'tsv' | 'json' | 'whitespace';

/** What a procedure needs from the table. */
export type DataShape = 'values' | 'groups' | 'pairs' | 'table' | 'pvalues';

/** How rows become groups. */
export type GroupMode = 'auto' | 'column' | 'blocks' | 'per-column';

/** Which column plays which part, by column key. */
export interface DataRoles {
  value?: string;
  group?: string;
  x?: string;
  y?: string;
  label?: string;
  p?: string;
}

/** How one dataset feeds one procedure. */
export interface DataPlan {
  shape: DataShape;
  groupMode: GroupMode;
  roles: DataRoles;
}

/** Reading options a reader can override when the guess is wrong. */
export interface ReadOptions {
  /** Force the first row to be a header (`true`) or data (`false`). */
  header?: boolean;
  /** Force a delimiter: `,` `;` `\t` or `'whitespace'`. */
  delimiter?: string;
}

/** A missing cell, as the reader writes it in a table. */
const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-', '—']);

/** True when a cell reads as a finite number. */
export function asNumber(cell: Cell): number | null {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? cell : null;
  }
  if (cell === null) {
    return null;
  }
  const text = cell.trim();
  if (MISSING.has(text.toLowerCase())) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** True when a cell is empty or a missing marker. */
function blank(cell: Cell): boolean {
  return cell === null || (typeof cell === 'string' && MISSING.has(cell.trim().toLowerCase()));
}

/* ================================================================================================
 * Grids
 * ============================================================================================== */

/** A grid of raw text cells plus the block each row came from. */
interface Grid {
  rows: Cell[][];
  blockOf: number[];
  /** Blank lines were met, so the reader separated groups on purpose. */
  blocked: boolean;
  /** The format already knows whether the first row is a header. */
  header?: boolean;
  delimiter?: string;
}

/** The delimiter that appears on the most lines, ignoring quoted runs well enough for a guess. */
export function sniffDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 40);
  if (lines.length === 0) {
    return 'whitespace';
  }
  const candidates = [',', '\t', ';', '|'];
  let best = 'whitespace';
  let bestScore = 0;
  for (const candidate of candidates) {
    const counts = lines.map((line) => line.split(candidate).length - 1);
    const withDelimiter = counts.filter((count) => count > 0).length;
    const consistent = counts[0] > 0 && counts.every((count) => count === counts[0] || count === 0);
    const score = withDelimiter * (consistent ? 2 : 1);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : 'whitespace';
}

/** Split one delimited line, honouring doubled quotes inside a quoted field. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"' && value.trim() === '') {
      quoted = true;
      value = '';
      continue;
    }
    if (char === delimiter) {
      cells.push(value.trim());
      value = '';
      continue;
    }
    value += char;
  }
  cells.push(value.trim());
  return cells;
}

/** Read text into a ragged grid, keeping blank-line blocks. */
function gridFrom(text: string, delimiter: string): Grid {
  const rows: Cell[][] = [];
  const blockOf: number[] = [];
  let block = 1;
  let blocked = false;
  let quoted = false;

  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    // A newline inside quotes continues the previous record; keep it as one cell.
    if (quoted) {
      const last = rows[rows.length - 1];
      if (last) {
        last[last.length - 1] = `${last[last.length - 1] ?? ''}\n${line}`;
      }
      quoted = (line.match(/"/g)?.length ?? 0) % 2 === 1;
      continue;
    }
    if (line.trim() === '') {
      if (rows.length > 0) {
        block += 1;
        blocked = true;
      }
      continue;
    }
    const cells = delimiter === 'whitespace' ? line.trim().split(/\s+/) : splitDelimited(line, delimiter);
    if (delimiter !== 'whitespace') {
      quoted = (line.match(/"/g)?.length ?? 0) % 2 === 1;
    }
    rows.push(cells.map((cell) => cell.trim()));
    blockOf.push(block);
  }
  return { rows, blockOf, blocked, delimiter };
}

/** The width every row is padded to. */
function widthOf(rows: Cell[][]): number {
  return rows.reduce((wide, row) => Math.max(wide, row.length), 0);
}

/** Give every row the same width, filling with an empty cell. */
function rectangular(rows: Cell[][]): Cell[][] {
  const width = widthOf(rows);
  return rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push('');
    return next.slice(0, width);
  });
}

/** A column key unique in the table. */
function uniqueKey(name: string, taken: Set<string>): string {
  const base = name.trim() || 'column';
  let key = base;
  let index = 2;
  while (taken.has(key)) {
    key = `${base} (${index})`;
    index += 1;
  }
  taken.add(key);
  return key;
}

/** True when a whole row reads as text — the shape of a header. */
function looksLikeHeader(row: Cell[]): boolean {
  const filled = row.filter((cell) => !blank(cell));
  return filled.length > 0 && filled.every((cell) => asNumber(cell) === null && typeof cell === 'string');
}

/** Read a grid into typed columns. */
function datasetFrom(grid: Grid, format: DatasetFormat, options: ReadOptions): Dataset {
  const rows = rectangular(grid.rows);
  if (rows.length === 0) {
    return { columns: [], rows: [], blockOf: [], format, problems: ['The input holds no rows.'] };
  }
  const wide = rows[0].length;
  const header = options.header ?? grid.header ?? looksLikeHeader(rows[0]);
  const head = header ? rows[0].map((cell) => String(cell ?? '')) : [];
  const body = header ? rows.slice(1) : rows;
  const blockOf = (header ? grid.blockOf.slice(1) : grid.blockOf).map((value) => value);

  if (body.length === 0) {
    return {
      columns: [],
      rows: [],
      blockOf: [],
      format,
      problems: ['Only a header was read; add at least one row of data.'],
    };
  }

  const taken = new Set<string>();
  const columns: DatasetColumn[] = [];
  for (let index = 0; index < wide; index += 1) {
    const key = uniqueKey(head[index] ?? `V${index + 1}`, taken);
    const values = body.map((row) => row[index] ?? '');
    const missing = values.filter(
      (cell) => !blank(cell) && asNumber(cell) === null && typeof cell === 'string',
    ).length;
    const numeric = values.every((cell) => blank(cell) || asNumber(cell) !== null);
    columns.push({ key, name: key, type: numeric ? 'number' : 'text', missing: numeric ? missing : 0 });
  }

  const problems: string[] = [];
  const ragged = grid.rows.filter((row) => row.length !== wide).length;
  if (ragged > 0) {
    problems.push(`${ragged} row(s) had a different number of fields and were padded.`);
  }

  return {
    columns,
    rows: body.map((row) => row.map((cell) => cell ?? '')),
    blockOf,
    format,
    delimiter: grid.delimiter,
    problems,
  };
}

/* ================================================================================================
 * JSON
 * ============================================================================================== */

/** True when the text is a JSON document rather than a table. */
function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('[') || trimmed.startsWith('{');
}

/** Read the three JSON shapes a table arrives in. */
function gridFromJson(text: string): Grid {
  const parsed: unknown = JSON.parse(text);
  const rows: Cell[][] = [];
  let gridHeader = false;

  const fromMatrix = (value: unknown): void => {
    if (!Array.isArray(value)) {
      throw new Error('a JSON document must be an array of rows');
    }
    for (const entry of value) {
      if (Array.isArray(entry)) {
        rows.push(entry.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
      } else if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const keys = Object.keys(record);
        // A record is read against the first record's keys, so column order is stable.
        if (rows.length === 0) {
          gridHeader = true;
          rows.push(keys);
        }
        rows.push(
          keys.map((key) => (record[key] === null || record[key] === undefined ? '' : String(record[key]))),
        );
      } else {
        rows.push([entry === null || entry === undefined ? '' : String(entry)]);
      }
    }
  };

  if (Array.isArray(parsed)) {
    fromMatrix(parsed);
  } else if (parsed && typeof parsed === 'object') {
    const document = parsed as Record<string, unknown>;
    if (Array.isArray(document.columns) && Array.isArray(document.rows)) {
      rows.push(document.columns.map((cell) => String(cell)));
      fromMatrix(document.rows);
    } else if (Array.isArray(document.data)) {
      fromMatrix(document.data);
    } else {
      throw new Error('a JSON object must hold `columns` and `rows`, or `data`');
    }
  } else {
    throw new Error('JSON must be an array of rows or objects');
  }

  return { rows, blockOf: rows.map(() => 1), blocked: false, header: gridHeader || undefined };
}

/* ================================================================================================
 * Reading
 * ============================================================================================== */

/** Read text into a dataset, choosing the format when the caller did not. */
export function readDataset(text: string, options: ReadOptions = {}): Dataset {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { columns: [], rows: [], blockOf: [], format: 'whitespace', problems: [] };
  }

  if (looksLikeJson(trimmed)) {
    try {
      const grid = gridFromJson(trimmed);
      // A JSON document is data that happens to be JSON; its own shape says where the names
      // came from, so no header guess is applied over it.
      const data = datasetFrom(grid, 'json', options);
      return data;
    } catch (error) {
      return {
        columns: [],
        rows: [],
        blockOf: [],
        format: 'json',
        problems: [`Could not read this JSON: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  const delimiter =
    options.delimiter && options.delimiter !== '' ? options.delimiter : sniffDelimiter(trimmed);
  const grid = gridFrom(trimmed, delimiter);
  const format: DatasetFormat = delimiter === ',' ? 'csv' : delimiter === '\t' ? 'tsv' : 'whitespace';
  return datasetFrom(grid, format, options);
}

/* ================================================================================================
 * Plans
 * ============================================================================================== */

/** The numeric columns. */
export function numericColumns(dataset: Dataset): DatasetColumn[] {
  return dataset.columns.filter((column) => column.type === 'number');
}

/** The text columns. */
export function textColumns(dataset: Dataset): DatasetColumn[] {
  return dataset.columns.filter((column) => column.type === 'text');
}

/** The cells of one column. */
export function columnCells(dataset: Dataset, key: string | undefined): Cell[] {
  if (!key) return [];
  const index = dataset.columns.findIndex((column) => column.key === key);
  if (index === -1) return [];
  return dataset.rows.map((row) => row[index] ?? '');
}

/** A column as numbers, empty when the column is not numeric. */
export function columnNumbers(dataset: Dataset, key: string | undefined): number[] {
  if (!key) return [];
  return columnCells(dataset, key).flatMap((cell) => {
    const value = asNumber(cell);
    return value === null ? [] : [value];
  });
}

/** The block a row belongs to. */
export function blocksOf(dataset: Dataset): number[] {
  return [...new Set(dataset.blockOf)].sort((a, b) => a - b);
}

/** True when the paste kept more than one blank-line group. */
export function hasBlocks(dataset: Dataset): boolean {
  return blocksOf(dataset).length > 1;
}

/**
 * The plan a fresh dataset suggests for a shape.
 *
 * The rules are the ones a reader would apply: a group column when there is one, the paste's
 * own blank lines when there are not, and one column per group when the dataset is a table
 * whose columns are the conditions.
 */
export function suggestPlan(dataset: Dataset, shape: DataShape): DataPlan {
  const numbers = numericColumns(dataset);
  const texts = textColumns(dataset);
  const roles: DataRoles = {};

  if (shape === 'values') {
    roles.value = numbers[0]?.key;
    return { shape, groupMode: 'auto', roles };
  }

  if (shape === 'pairs') {
    roles.x = numbers[0]?.key;
    roles.y = numbers[1]?.key;
    return { shape, groupMode: 'auto', roles };
  }

  if (shape === 'pvalues') {
    roles.label = texts[0]?.key;
    roles.p = numbers[numbers.length - 1]?.key ?? numbers[0]?.key;
    return { shape, groupMode: 'auto', roles };
  }

  if (shape === 'table') {
    return { shape, groupMode: 'auto', roles };
  }

  roles.value = numbers[0]?.key;
  roles.group = texts[0]?.key;
  const mode: GroupMode = roles.group ? 'column' : hasBlocks(dataset) ? 'blocks' : 'per-column';
  return { shape, groupMode: mode, roles };
}

/** The grouping a plan actually uses, with `auto` resolved against the dataset. */
export function resolveGroupMode(dataset: Dataset, plan: DataPlan): Exclude<GroupMode, 'auto'> {
  if (plan.groupMode !== 'auto') return plan.groupMode;
  if (plan.roles.group && textColumns(dataset).some((column) => column.key === plan.roles.group)) {
    return 'column';
  }
  if (hasBlocks(dataset)) return 'blocks';
  if (numericColumns(dataset).length > 1) return 'per-column';
  return 'blocks';
}

/** True when the plan can read real values from the dataset. */
export function planReady(dataset: Dataset, plan: DataPlan): boolean {
  if (dataset.columns.length === 0 || dataset.rows.length === 0) return false;
  const numbers = numericColumns(dataset);
  switch (plan.shape) {
    case 'values':
      return numbers.length > 0 && numbers.some((column) => column.key === plan.roles.value);
    case 'pairs':
      return Boolean(
        plan.roles.x &&
        plan.roles.y &&
        numbers.some((column) => column.key === plan.roles.x) &&
        numbers.some((column) => column.key === plan.roles.y),
      );
    case 'pvalues':
      return Boolean(plan.roles.p && numbers.some((column) => column.key === plan.roles.p));
    case 'table':
      return numbers.length > 0;
    case 'groups': {
      const mode = resolveGroupMode(dataset, plan);
      if (mode === 'per-column') return numbers.length >= 2;
      if (mode === 'column') {
        return Boolean(
          plan.roles.value &&
          plan.roles.group &&
          textColumns(dataset).some((column) => column.key === plan.roles.group),
        );
      }
      return hasBlocks(dataset);
    }
    default:
      return false;
  }
}

/** Rows grouped by the value of a text column, in the order the values first appear. */
function groupsByColumn(dataset: Dataset, groupKey: string, valueKey: string): number[][] {
  const groupIndex = dataset.columns.findIndex((column) => column.key === groupKey);
  const valueIndex = dataset.columns.findIndex((column) => column.key === valueKey);
  if (groupIndex === -1 || valueIndex === -1) return [];
  const groups = new Map<string, number[]>();
  for (const row of dataset.rows) {
    const label = String(row[groupIndex] ?? '').trim();
    const value = asNumber(row[valueIndex] ?? '');
    if (!label || value === null) continue;
    const bucket = groups.get(label) ?? [];
    bucket.push(value);
    groups.set(label, bucket);
  }
  return [...groups.values()];
}

/** Rows grouped by the blank line they came from. */
function groupsByBlocks(dataset: Dataset, valueKey: string): number[][] {
  const valueIndex = dataset.columns.findIndex((column) => column.key === valueKey);
  if (valueIndex === -1) return [];
  const groups = new Map<number, number[]>();
  dataset.rows.forEach((row, index) => {
    const value = asNumber(row[valueIndex] ?? '');
    if (value === null) return;
    const block = dataset.blockOf[index] ?? 1;
    const bucket = groups.get(block) ?? [];
    bucket.push(value);
    groups.set(block, bucket);
  });
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, values]) => values);
}

/** What the procedures consume, read from a dataset. */
export interface ParsedData {
  /** One numeric series per group. */
  blocks: number[][];
  /** The second column, used by paired tests and scatter plots. One series. */
  pairs: number[][];
  /** Every numeric column of every row, used by a contingency table. */
  matrix: number[][];
  /** One `label p` per row, for the multiple-comparison procedure. */
  pEntries: { label: string; p: number }[];
  /** Group labels, when the grouping came from a column. */
  labels: string[];
  /** The raw table, which a custom procedure receives whole. */
  dataset: Dataset;
}

/** Read a dataset through a plan into the engine's shapes. */
export function toParsedData(dataset: Dataset, plan: DataPlan): ParsedData {
  const numbers = numericColumns(dataset);
  let blocks: number[][] = [];
  let labels: string[] = [];

  if (plan.shape === 'groups') {
    const mode = resolveGroupMode(dataset, plan);
    if (mode === 'per-column') {
      blocks = numbers.map((column) => columnNumbers(dataset, column.key));
      labels = numbers.map((column) => column.name);
    } else if (mode === 'column' && plan.roles.group && plan.roles.value) {
      blocks = groupsByColumn(dataset, plan.roles.group, plan.roles.value);
      const groupIndex = dataset.columns.findIndex((column) => column.key === plan.roles.group);
      labels = [...new Set(dataset.rows.map((row) => String(row[groupIndex] ?? '').trim()).filter(Boolean))];
    } else if (plan.roles.value) {
      blocks = groupsByBlocks(dataset, plan.roles.value);
      labels = blocks.map((_, index) => `Group ${index + 1}`);
    }
  }

  const primary =
    plan.shape === 'values' && plan.roles.value
      ? columnNumbers(dataset, plan.roles.value)
      : plan.shape === 'pairs' && plan.roles.x
        ? columnNumbers(dataset, plan.roles.x)
        : numbers[0]
          ? columnNumbers(dataset, numbers[0].key)
          : [];

  const secondary =
    plan.shape === 'pairs' && plan.roles.y
      ? columnNumbers(dataset, plan.roles.y)
      : numbers[1]
        ? columnNumbers(dataset, numbers[1].key)
        : [];

  const matrix = dataset.rows
    .map((row) =>
      numbers.map((column) => {
        const index = dataset.columns.findIndex((entry) => entry.key === column.key);
        return asNumber(row[index] ?? '');
      }),
    )
    .map((row) => row.filter((value): value is number => value !== null))
    .filter((row) => row.length > 0);

  // A p-value table is read the way a paste always read it: the last number on the line is
  // the p-value and everything before it is the test's name. A mapped column narrows which
  // numbers count, but a label with spaces stays one label.
  const pEntries =
    plan.shape === 'pvalues'
      ? dataset.rows.flatMap((row, index) => {
          const mapped = plan.roles.p
            ? dataset.columns.findIndex((column) => column.key === plan.roles.p)
            : -1;
          let at = mapped >= 0 && asNumber(row[mapped] ?? '') !== null ? mapped : -1;
          if (at === -1) {
            for (let cell = row.length - 1; cell >= 0; cell -= 1) {
              if (asNumber(row[cell] ?? '') !== null) {
                at = cell;
                break;
              }
            }
          }
          const p = at >= 0 ? asNumber(row[at] ?? '') : null;
          if (p === null) return [];
          const label = row
            .slice(0, at)
            .map((cell) => String(cell ?? '').trim())
            .filter(Boolean)
            .join(' ');
          return [{ label: label || `Test ${index + 1}`, p }];
        })
      : [];

  return {
    blocks: blocks.some((group) => group.length > 0) ? blocks : primary.length > 0 ? [primary] : [],
    pairs: secondary.length > 0 ? [secondary] : [],
    matrix,
    pEntries,
    labels,
    dataset,
  };
}

/** The data hint for a shape, so every procedure does not write its own. */
export function shapeHint(shape: DataShape): string {
  switch (shape) {
    case 'values':
      return 'One numeric column. Every other column is ignored.';
    case 'groups':
      return 'A value column plus either a group column, blank-line blocks, or one column per group.';
    case 'pairs':
      return 'Two numeric columns, one pair per row (x then y).';
    case 'table':
      return 'One row per table row, one numeric column per cell. Categorical labels are ignored.';
    case 'pvalues':
      return 'A label column and a p-value column between 0 and 1.';
    default:
      return '';
  }
}

/** A one-line readout of what the plan sees, for the data header. */
export function planSummary(dataset: Dataset, plan: DataPlan): string {
  if (dataset.rows.length === 0) return 'No data read yet';
  const rows = `${dataset.rows.length} row(s)`;
  if (plan.shape === 'table') {
    const numbers = numericColumns(dataset).length;
    return `${rows} × ${numbers} numeric column(s)`;
  }
  if (plan.shape === 'pairs') return `${rows}, two columns`;
  if (plan.shape === 'values') return `${columnNumbers(dataset, plan.roles.value).length} value(s)`;
  if (plan.shape === 'pvalues') return `${toParsedData(dataset, plan).pEntries.length} p-value(s)`;
  const data = toParsedData(dataset, plan);
  return `${data.blocks.length} group(s) · ${data.blocks.map((group) => group.length).join(' / ')} values`;
}
