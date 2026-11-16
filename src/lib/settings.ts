/**
 * The settings a reader actually edits.
 *
 * The settings screens are data, but data is not a form: a field only becomes editable when
 * it has a stable key, a persisted value and a consumer. This module gives every editable
 * field a key and the store a typed shape, so the screen and the runtime read the same value.
 *
 * Two kinds of customization live here:
 *
 *  - **Preferences** — every control on the settings pages, keyed by its section and label.
 *    They are appended to the system prompt as the reader's standing choices, which is what
 *    makes them more than a saved form.
 *  - **Prompt overrides** — the workspace's own words for the global, mode and worker
 *    instructions. An empty override keeps the built-in text.
 */

/** The value shapes a settings control can hold. */
export type PreferenceValue = string | number | boolean | string[];

/** One stored preference, with the words the prompt needs to describe it. */
export interface PreferenceEntry {
  value: PreferenceValue;
  /** The field's label, kept so the prompt can say what the value is. */
  label: string;
  /** The section it belongs to, kept for grouping. */
  section: string;
}

/** Every preference, by key. */
export type Preferences = Record<string, PreferenceEntry>;

/** The instructions a workspace can replace or extend. */
export interface PromptOverrides {
  /** Appended to every turn, lead or worker. */
  global: string;
  /** Replaces the built-in `agent` behaviour when set. */
  agent: string;
  /** Replaces the built-in `plan` behaviour when set. */
  plan: string;
  /** Replaces the built-in `ask` behaviour when set. */
  ask: string;
  /** Appended to a worker's brief. */
  worker: string;
}

export const DEFAULT_PROMPTS: PromptOverrides = {
  global: '',
  agent: '',
  plan: '',
  ask: '',
  worker: '',
};

/** A stable key for a control: its section and its label, slugged. */
export function preferenceKey(sectionId: string, label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${sectionId}:${slug}`;
}

/** The value a control shows: the stored one, or the spec's default. */
export function preferenceValue<T extends PreferenceValue>(
  preferences: Preferences,
  key: string,
  fallback: T,
): T {
  const stored = preferences[key]?.value;
  if (stored === undefined) return fallback;
  if (Array.isArray(fallback)) return (Array.isArray(stored) ? stored : fallback) as T;
  if (typeof fallback === 'number') return (typeof stored === 'number' ? stored : fallback) as T;
  if (typeof fallback === 'boolean') return (typeof stored === 'boolean' ? stored : fallback) as T;
  return (typeof stored === 'string' ? stored : fallback) as T;
}

/** Keep a stored blob to the current shape; an unknown entry is dropped, not guessed at. */
export function normalizePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Preferences = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Partial<PreferenceEntry>;
    if (entry.value === undefined) continue;
    const valid =
      typeof entry.value === 'string' ||
      typeof entry.value === 'number' ||
      typeof entry.value === 'boolean' ||
      (Array.isArray(entry.value) && entry.value.every((item) => typeof item === 'string'));
    if (!valid) continue;
    out[key] = {
      value: entry.value,
      label: typeof entry.label === 'string' ? entry.label : key,
      section: typeof entry.section === 'string' ? entry.section : 'Preferences',
    };
  }
  return out;
}

/** Same treatment for the prompt overrides. */
export function normalizePrompts(value: unknown): PromptOverrides {
  if (typeof value !== 'object' || value === null) return DEFAULT_PROMPTS;
  const stored = value as Partial<PromptOverrides>;
  const text = (item: unknown) => (typeof item === 'string' ? item : '');
  return {
    global: text(stored.global),
    agent: text(stored.agent),
    plan: text(stored.plan),
    ask: text(stored.ask),
    worker: text(stored.worker),
  };
}

/**
 * The crash-report switch.
 *
 * The label is the key: the settings page stores a control by the section it is in and the
 * words it shows, so the label lives here once and both the page and the reader of the value
 * use it. Off by default; the local log is written regardless, since it never leaves the
 * machine.
 */
export const CRASH_REPORT_SECTION = 'local';
export const CRASH_REPORT_LABEL = 'Save a local crash report when the app fails';
export const LOCAL_ONLY_LABEL = 'Local-only mode';

/** True when the reader opted into a crash report file. */
export function crashReportEnabled(preferences: Preferences): boolean {
  return preferenceValue(preferences, preferenceKey(CRASH_REPORT_SECTION, CRASH_REPORT_LABEL), false);
}

/**
 * True when every model call must stay on this machine.
 *
 * The Privacy page makes this promise, so the engine reads it rather than treating it as a
 * note to the model. A local provider, or a base URL on loopback, is allowed; everything else
 * is refused with the reason.
 */
export function localOnlyEnabled(preferences: Preferences): boolean {
  return preferenceValue(preferences, preferenceKey('local', LOCAL_ONLY_LABEL), false);
}

/** A base URL that never leaves the machine. */
export function isLoopbackUrl(url: string | undefined): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(url ?? '');
}

/** How a value reads in prose: booleans as words, lists comma-joined. */
export function preferenceText(value: PreferenceValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * The preference block for the system prompt, grouped by section.
 *
 * Empty strings and empty lists are left out: a preference a reader cleared is not a rule,
 * and saying "Instructions = " would only spend tokens. UI-only keys (`theme`, `navMode`) are
 * filtered by the caller, since they change what the reader sees, not what the agent does.
 */
export function preferenceLines(preferences: Preferences, skip: ReadonlySet<string> = new Set()): string[] {
  const groups = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(preferences)) {
    if (skip.has(key)) continue;
    if (entry.value === '' || (Array.isArray(entry.value) && entry.value.length === 0)) continue;
    const line = `- ${entry.label}: ${preferenceText(entry.value)}`;
    groups.set(entry.section, [...(groups.get(entry.section) ?? []), line]);
  }
  if (groups.size === 0) return [];
  const lines = ['The reader set these preferences; follow them unless a task says otherwise.'];
  for (const [section, entries] of groups) {
    lines.push(`${section}:`, ...entries);
  }
  return lines;
}
