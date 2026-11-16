/**
 * Records as a table the model can read.
 *
 * A list of uniform objects is the most common shape a database or an archive returns, and
 * pretty-printed JSON pays for every key on every row. Delimited rows state the header once,
 * and TOON is the same idea with the field list in the header line. Both are lossless for flat
 * values; anything nested stays JSON inside its cell rather than being flattened silently.
 */

export type TabularFormat = 'json' | 'csv' | 'tsv' | 'toon';

/** One row, as the tools already produce them. */
export type Row = Record<string, unknown>;

/** Every key, in first-seen order, so a column never appears twice. */
function columnsOf(rows: readonly Row[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

/** A cell as text: primitives as they read, everything else as compact JSON. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Quote one cell when the delimiter or a line break would break the row. */
function quote(value: string, delimiter: string): string {
  if (!value.includes(delimiter) && !value.includes('"') && !value.includes('\n') && !value.includes('\r')) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/** Rows as CSV or TSV, header first. */
export function toDelimited(rows: readonly Row[], delimiter = ','): string {
  const columns = columnsOf(rows);
  if (columns.length === 0) return '';
  const lines = [columns.map((column) => quote(column, delimiter)).join(delimiter)];
  for (const row of rows) {
    lines.push(columns.map((column) => quote(cell(row[column]), delimiter)).join(delimiter));
  }
  return lines.join('\n');
}

/** Rows in TOON's uniform-table form: `name[count]{a,b}:` then indented rows. */
export function toToon(rows: readonly Row[], name = 'records'): string {
  const columns = columnsOf(rows);
  if (columns.length === 0) return '';
  const header = `${name}[${rows.length}]{${columns.join(',')}}:`;
  const body = rows.map((row) => `  ${columns.map((column) => quote(cell(row[column]), ',')).join(',')}`);
  return [header, ...body].join('\n');
}

/** The records in the requested shape. */
export function formatRecords(rows: readonly Row[], format: TabularFormat): string {
  if (format === 'csv') return toDelimited(rows, ',');
  if (format === 'tsv') return toDelimited(rows, '\t');
  if (format === 'toon') return toToon(rows);
  return JSON.stringify(rows);
}
