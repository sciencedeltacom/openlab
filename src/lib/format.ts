/** Presentation helpers. Pure functions, no DOM, no dependencies. */

/** Shortest unambiguous path for a file row: `packages/ui/src/lib/contextUsage.ts` → `…/lib/contextUsage.ts`. */
export function shortPath(path: string, maxSegments = 3): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= maxSegments) {
    return path;
  }
  return `…/${parts.slice(-maxSegments).join('/')}`;
}

/** `4.5s`, `2m 21s`, `1h 04m` — durations the way a person reads them. */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** `02:21` — a clock reading, for elapsed time shown next to a message. */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** `just now`, `12m`, `3h`, `5d`, then a date. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) {
    return 'just now';
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}h`;
  }
  if (seconds < 604800) {
    return `${Math.round(seconds / 86400)}d`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** `840 B`, `12.4 KB`, `1.2 MB`. Binary units, because that is what file sizes are. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Percentage with one decimal, clamped to a sensible display range. */
export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(digits)}%`;
}

/** First line of a string, trimmed — used for commit subjects and titles. */
export function firstLine(text: string, max = 80): string {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
