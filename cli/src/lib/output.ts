/**
 * Rendering for a terminal.
 *
 * Three shapes cover every command: a table for a list, a key/value block for one record, and
 * JSON for anything that will be piped. Colour is applied only when a terminal is attached and
 * `NO_COLOR` is unset, so `openlab ... | jq` gets clean text without being told twice.
 */

import { createColors } from 'picocolors';

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

/** picocolors, with the same on/off decision the rest of the output makes. */
const pc = createColors(COLOR);

/** The palette every command draws from. */
export const c = {
  bold: pc.bold,
  dim: pc.dim,
  italic: pc.italic,
  red: pc.red,
  green: pc.green,
  yellow: pc.yellow,
  blue: pc.blue,
  magenta: pc.magenta,
  cyan: pc.cyan,
  grey: pc.gray,
  inverse: pc.inverse,
};

/** One column of a table. */
export interface Column<T> {
  /** Field to read, or a computed value. */
  key: string;
  label: string;
  /** Fixed width; otherwise the widest cell wins. */
  width?: number;
  /** Truncate to the width (with an ellipsis) instead of overflowing. */
  truncate?: boolean;
  /** Right-align; the default for numbers. */
  align?: 'left' | 'right';
  /** How a cell reads. Defaults to the value itself. */
  format?: (row: T) => string;
}

/** The visible length of a string, ignoring ANSI sequences. */
function width(text: string): number {
  return text.replace(/\u001B\[[0-9;]*m/g, '').length;
}

/** Pad to `size` visible characters. */
function pad(text: string, size: number, align: 'left' | 'right'): string {
  const gap = ' '.repeat(Math.max(0, size - width(text)));
  return align === 'right' ? `${gap}${text}` : `${text}${gap}`;
}

/** Cut a cell to `size`, marking that it was cut. */
function cut(text: string, size: number): string {
  if (width(text) <= size) {
    return text;
  }
  const plain = text.replace(/\u001B\[[0-9;]*m/g, '');
  return `${plain.slice(0, Math.max(1, size - 1))}…`;
}

/**
 * A table.
 *
 * Columns are measured from the data, so a long id widens its column and nothing is silently
 * clipped unless the column asked for it.
 */
export function table<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  if (rows.length === 0) {
    return '';
  }
  const cell = (row: T, column: Column<T>): string => {
    const raw = column.format
      ? column.format(row)
      : String((row as Record<string, unknown>)[column.key] ?? '');
    return raw;
  };
  const sizes = columns.map((column) => {
    const longest = rows.reduce((widest, row) => Math.max(widest, width(cell(row, column))), 0);
    return Math.max(column.width ?? 0, Math.min(longest, column.truncate ? (column.width ?? 48) : longest));
  });
  const line = (values: string[], header = false): string =>
    values
      .map((value, index) => {
        const column = columns[index];
        const size = sizes[index];
        const text = header ? c.bold(value) : value;
        return pad(column.truncate ? cut(text, size) : text, size, column.align ?? 'left');
      })
      .join('  ')
      .trimEnd();

  const head = line(
    columns.map((column) => column.label),
    true,
  );
  const rule = c.grey(sizes.map((size) => '─'.repeat(size)).join('──'));
  return [head, rule, ...rows.map((row) => line(columns.map((column) => cell(row, column))))].join('\n');
}

/** A key/value block, for one record. */
export function keyValues(pairs: readonly (readonly [string, string | undefined | null])[]): string {
  const shown = pairs.filter(([, value]) => value !== undefined && value !== null && value !== '');
  const width = shown.reduce((widest, [key]) => Math.max(widest, key.length), 0);
  return shown.map(([key, value]) => `${c.grey(pad(key, width, 'left'))}  ${value}`).join('\n');
}

/** A section heading. */
export function heading(text: string): string {
  return c.bold(text);
}

/** A dimmed note under a heading. */
export function note(text: string): string {
  return c.grey(text);
}

/** Bullet lines, indented under whatever they belong to. */
export function bullets(lines: readonly string[]): string {
  return lines.map((line) => `  ${c.grey('•')} ${line}`).join('\n');
}

/** The wordmark, for a command that has nothing better to show. */
export function brand(): string {
  return `${c.cyan('Δ')} ${c.bold('openlab')} ${c.grey('· the research workbench')}`;
}

/** A tick, a cross and a dash, for check lists. */
export const mark = {
  ok: c.green('✓'),
  bad: c.red('✗'),
  warn: c.yellow('!'),
  skip: c.grey('·'),
};

/** Percent-ish progress bar, e.g. `████░░░░ 50%`. */
export function bar(ratio: number, size = 16): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * size);
  return `${c.green('█'.repeat(filled))}${c.grey('░'.repeat(size - filled))}`;
}

/** Pretty JSON, with the trailing newline a shell wants. */
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
