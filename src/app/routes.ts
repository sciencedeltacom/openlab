/**
 * The route tree.
 *
 * Three levels, and the middle one is what keeps the product readable:
 *
 *   **Sections** — the one entry per line in the sidebar. Nine of them.
 *   **Views** — a section's pages, shown as tabs inside it rather than as more sidebar rows.
 *   **Records** — everything you drill into from a view, at a path of its own.
 *
 * The sidebar used to list all fifty-five surfaces flat, which is the same as listing none:
 * nothing stands out, so you read the whole column every time you want to go somewhere. A
 * section is now one row and its pages are a tab strip inside it.
 */

import {
  Activity,
  Archive,
  BarChart3,
  Blocks,
  BookMarked,
  Boxes,
  Braces,
  CalendarRange,
  ClipboardCheck,
  Code2,
  Columns3,
  Compass,
  Database,
  FileText,
  FlaskConical,
  FolderTree,
  Gauge,
  Home,
  Inbox,
  LayoutList,
  Link2,
  ListChecks,
  Lock,
  Microscope,
  Network,
  Plug,
  Puzzle,
  Settings,
  Shield,
  Sparkles,
  Stethoscope,
  Target,
  Terminal,
  Timer,
  Wand2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import { Astroid } from '@/components/common/Astroid';

/** One page: a destination in the sidebar, in the tab strip, or in the picker behind `+`. */
export interface PageEntry {
  path: string;
  label: string;
  icon: LucideIcon;
  /** A short trailing note: the unread count on Inbox, the running turns on AI. */
  badge?: 'inbox' | 'runs';
  /**
   * A page that navigates in place rather than opening a tab.
   *
   * Settings is the case: it is one surface with its own navigation, so thirteen settings
   * pages must not become thirteen tabs. Only the tab strip reads it.
   */
  inPlace?: boolean;
}

/**
 * Every page, in one list.
 *
 * The tab system and the picker behind `+` both read this one list, so a page cannot be in
 * one of them and missing from another.
 */
export const PAGES: PageEntry[] = [
  { path: 'home', label: 'Home', icon: Home },
  { path: 'assistant', label: 'AI', icon: Astroid, badge: 'runs' },
  { path: 'inbox', label: 'Inbox', icon: Inbox, badge: 'inbox' },
  { path: 'my-work', label: 'My work', icon: Target },
  { path: 'research/tasks', label: 'Tasks', icon: ListChecks },
  { path: 'research/intake', label: 'Intake', icon: ClipboardCheck },
  { path: 'research/waves', label: 'Waves', icon: CalendarRange },
  { path: 'research/analytics', label: 'Analytics', icon: BarChart3 },
  { path: 'knowledge', label: 'Knowledge', icon: Network },
  { path: 'literature-reviews', label: 'Reviews', icon: ListChecks },
  { path: 'library/sources', label: 'Sources', icon: FolderTree },
  { path: 'library/databases', label: 'Databases', icon: Database },
  { path: 'library/files', label: 'Files', icon: Microscope },
  { path: 'analyze/statistics', label: 'Statistics', icon: Gauge },
  { path: 'analyze/experiments', label: 'Experiments', icon: ListChecks },
  { path: 'analyze/figures', label: 'Figures', icon: BarChart3 },
  { path: 'compute/jobs', label: 'Jobs', icon: Timer },
  { path: 'compute/targets', label: 'Targets', icon: Plug },
  { path: 'compute/autoresearch', label: 'Autoresearch', icon: Sparkles },
  { path: 'packs', label: 'Domain packs', icon: Puzzle },
  { path: 'tools/catalog', label: 'Tools', icon: Wrench },
  { path: 'tools/connectors', label: 'Connectors', icon: Blocks },
  { path: 'tools/credentials', label: 'Credentials', icon: Lock },
  { path: 'tools/custom', label: 'Custom tools', icon: Code2 },
  { path: 'skills', label: 'Skills', icon: BookMarked },
  { path: 'skills/recipes', label: 'Recipes', icon: Wand2 },
  { path: 'connections', label: 'Connections', icon: Link2 },
  { path: 'settings/providers', label: 'Settings', icon: Settings, inPlace: true },
];

/**
 * The settings pages.
 *
 * A dozen pages do not belong in the main column, and they are not a tab strip either —
 * they are the contents of one surface. The settings screen renders them as its own
 * navigation, the way every settings screen does.
 */
export const SETTINGS_PAGES: { path: string; label: string; icon: LucideIcon }[] = [
  { path: 'settings/providers', label: 'Providers', icon: Plug },
  { path: 'settings/controls', label: 'Research', icon: Target },
  { path: 'settings/instructions', label: 'Instructions', icon: FileText },
  { path: 'settings/slash-commands', label: 'Commands', icon: Terminal },
  { path: 'settings/permissions', label: 'Permissions', icon: Lock },
  { path: 'settings/sandbox', label: 'Sandbox', icon: Shield },
  { path: 'settings/container', label: 'Container', icon: Boxes },
  { path: 'settings/usage', label: 'Usage', icon: Activity },
  { path: 'settings/backups', label: 'Backups', icon: Archive },
  { path: 'settings/servers', label: 'MCP servers', icon: Plug },
  { path: 'settings/diagnostics', label: 'Diagnostics', icon: Stethoscope },
  { path: 'settings/scan', label: 'Scan engine', icon: Gauge },
  { path: 'settings/appearance', label: 'Appearance', icon: Wand2 },
  { path: 'settings/privacy', label: 'Privacy', icon: Shield },
  { path: 'settings/extensions', label: 'Extensions', icon: Blocks },
  { path: 'settings/help', label: 'Help', icon: Compass },
];

/**
 * A page that is routable but earns no tab of its own until it is opened.
 *
 * Two kinds: a surface reached from the page that owns it (the saved-views list, the packed
 * domain guides), and a creation page.
 */
export interface HiddenView extends PageEntry {}

export const HIDDEN_VIEWS: HiddenView[] = [
  { path: 'home/insights', label: 'Insights', icon: BarChart3 },
  { path: 'assistant/results', label: 'Saved results', icon: BookMarked },
  { path: 'research/views', label: 'Views', icon: Columns3 },
  { path: 'library/databases/new', label: 'New database', icon: Database },
  { path: 'analyze/experiments/new', label: 'New experiment', icon: FlaskConical },
  { path: 'agents/new', label: 'New agent', icon: Sparkles },
  { path: 'library/sources/new', label: 'New source', icon: FolderTree },
  { path: 'compute/targets/new', label: 'New target', icon: Plug },
  { path: 'literature-reviews/new', label: 'New review', icon: ListChecks },
  { path: 'research/waves/new', label: 'New wave', icon: CalendarRange },
  // The settings surface's own pages. They navigate inside the Settings tab rather than
  // opening one tab each.
  ...SETTINGS_PAGES.map((page) => ({
    path: page.path,
    label: page.label,
    icon: page.icon,
    inPlace: true,
  })),
];

/** A record page: a path with parameters, and the view it belongs to. */
export interface DetailRoute {
  /** e.g. `research/tasks/:taskId`. */
  pattern: string;
  /** The view this record is filed under, for the breadcrumb and its list. */
  parent: string;
  /** What the record is, in the singular. */
  noun: string;
}

/**
 * Everything you can drill into.
 *
 * A record gets a page rather than a panel when a reader would want to link to it, reload
 * onto it, or come back to it from somewhere else. That is most records.
 */
export const DETAILS: DetailRoute[] = [
  { pattern: 'assistant/:sessionId', parent: 'assistant', noun: 'Session' },
  { pattern: 'assistant/results/:resultId', parent: 'assistant/results', noun: 'Result' },
  { pattern: 'research/tasks/:taskId', parent: 'research/tasks', noun: 'Task' },
  { pattern: 'research/waves/:waveId', parent: 'research/waves', noun: 'Wave' },
  { pattern: 'research/views/:viewId', parent: 'research/views', noun: 'View' },
  { pattern: 'library/sources/:sourceId', parent: 'library/sources', noun: 'Source' },
  { pattern: 'library/sources/:sourceId/edit', parent: 'library/sources', noun: 'Source' },
  { pattern: 'literature-reviews/:reviewId', parent: 'literature-reviews', noun: 'Review' },
  { pattern: 'library/files/:fileId', parent: 'library/files', noun: 'File' },
  { pattern: 'packs/:packId', parent: 'packs', noun: 'Pack' },
  { pattern: 'library/databases/:databaseId', parent: 'library/databases', noun: 'Database' },
  { pattern: 'analyze/experiments/:experimentId', parent: 'analyze/experiments', noun: 'Experiment' },
  { pattern: 'analyze/figures/:figureId', parent: 'analyze/figures', noun: 'Figure' },
  { pattern: 'compute/jobs/:jobId', parent: 'compute/jobs', noun: 'Job' },
  { pattern: 'compute/jobs/:jobId/codebase', parent: 'compute/jobs/:jobId', noun: 'Codebase' },
  { pattern: 'compute/targets/:targetId', parent: 'compute/targets', noun: 'Target' },
  { pattern: 'tools/catalog/:toolId', parent: 'tools/catalog', noun: 'Tool' },
  { pattern: 'tools/connectors/:connectorId', parent: 'tools/connectors', noun: 'Connector' },
  { pattern: 'skills/:skillId', parent: 'skills', noun: 'Skill' },
  { pattern: 'skills/recipes/:recipeId', parent: 'skills/recipes', noun: 'Recipe' },
];

/**
 * The record page for a view.
 *
 * The first entry wins: a view can have a sub-page under the same parent
 * (`sources/:id/edit`), and taking the last would send a click on a source to its edit form.
 * The routes are ordered with the record before its sub-pages.
 */
export function recordPatternFor(parent: string): string | undefined {
  return DETAILS.find((detail) => detail.parent === parent)?.pattern;
}

/**
 * A section path.
 *
 * Named rather than inlined because the screen specs are keyed by it, and a map keyed by a
 * bare `string` reads as if anything were allowed.
 */
export type RouteId = string;

/** Every path pattern in the tree, pages first. */
export const PATTERNS: string[] = [
  ...new Set([
    ...PAGES.map((page) => page.path),
    ...HIDDEN_VIEWS.map((view) => view.path),
    ...DETAILS.map((detail) => detail.pattern),
  ]),
];

/** What a matched path resolves to. */
export interface Match {
  /** The pattern that matched. */
  pattern: string;
  /** Filled parameters, e.g. `{ taskId: 'crs-142' }`. */
  params: Record<string, string>;
  /** Page label, or the record noun for a record page. */
  label: string;
  icon: LucideIcon;
  /** The page this record is listed on, or the pattern itself for a page. */
  parent: string;
  /** True when this is a record page rather than a page. */
  isDetail: boolean;
  /** False when nothing in the tree matched; the caller shows the gap rather than Home. */
  found: boolean;
}

/** Index the tree once. */
const PAGE_INDEX = new Map<string, PageEntry>();
for (const page of PAGES) {
  PAGE_INDEX.set(page.path, page);
}
for (const view of HIDDEN_VIEWS) {
  PAGE_INDEX.set(view.path, view);
}

const RECORDS = new Map<string, DetailRoute>();
for (const detail of DETAILS) {
  RECORDS.set(detail.pattern, detail);
}

/** The root a path falls back to when nothing matches. */
export const HOME = 'home';

/** Resolve a concrete path. */
export function matchRoute(path: string): Match {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const segments = clean.split('/').filter(Boolean);

  for (const pattern of PATTERNS) {
    const parts = pattern.split('/');
    if (parts.length !== segments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[index]);
      } else if (part !== segments[index]) {
        matched = false;
        break;
      }
    }
    if (!matched) {
      continue;
    }

    const page = PAGE_INDEX.get(pattern);
    if (page) {
      return {
        pattern,
        params,
        label: page.label,
        icon: page.icon,
        parent: pattern,
        isDetail: false,
        found: true,
      };
    }

    const record = RECORDS.get(pattern);
    if (record) {
      const host = PAGE_INDEX.get(record.parent);
      return {
        pattern,
        params,
        label: record.noun,
        icon: host?.icon ?? FlaskConical,
        parent: record.parent,
        isDetail: true,
        found: true,
      };
    }
  }

  // Nothing matched. Say so instead of quietly showing Home: a broken link that lands on the
  // dashboard is indistinguishable from a feature that works.
  return {
    pattern: '',
    params: {},
    label: 'Not found',
    icon: FlaskConical,
    parent: '',
    isDetail: false,
    found: false,
  };
}

/** The page entry behind a pattern or a concrete path, when there is one. */
export function pageFor(path: string): PageEntry | undefined {
  return PAGE_INDEX.get(matchRoute(path).pattern);
}

/** Build a concrete path from a pattern and its parameters. */
export function pathFor(pattern: string, params: Record<string, string> = {}): string {
  return pattern
    .split('/')
    .map((part) => (part.startsWith(':') ? encodeURIComponent(params[part.slice(1)] ?? '') : part))
    .join('/');
}

/**
 * Path builders.
 *
 * `pathFor` takes a pattern, which is right when the pattern is dynamic. These are for the
 * places that know exactly which record they mean — which is most places, and a call site
 * reading `paths.task(id)` says what it links to without spelling out a pattern.
 */
export const paths = {
  task: (id: string) => `research/tasks/${encodeURIComponent(id)}`,
  wave: (id: string) => `research/waves/${encodeURIComponent(id)}`,
  view: (id: string) => `research/views/${encodeURIComponent(id)}`,
  session: (id: string) => `assistant/${encodeURIComponent(id)}`,
  result: (id: string) => `assistant/results/${encodeURIComponent(id)}`,
  source: (id: string) => `library/sources/${encodeURIComponent(id)}`,
  sourceEdit: (id: string) => `library/sources/${encodeURIComponent(id)}/edit`,
  database: (id: string) => `library/databases/${encodeURIComponent(id)}`,
  figure: (id: string) => `analyze/figures/${encodeURIComponent(id)}`,
  /** A file's page, from the path the workspace knows it by. */
  file: (path: string) => pathFor('library/files/:fileId', { fileId: path }),
  job: (id: string) => `compute/jobs/${encodeURIComponent(id)}`,
  jobCodebase: (id: string) => `compute/jobs/${encodeURIComponent(id)}/codebase`,
  target: (id: string) => `compute/targets/${encodeURIComponent(id)}`,
  tool: (id: string) => `tools/catalog/${encodeURIComponent(id)}`,
  connector: (id: string) => `tools/connectors/${encodeURIComponent(id)}`,
  skill: (id: string) => `skills/${encodeURIComponent(id)}`,
  recipe: (id: string) => `skills/recipes/${encodeURIComponent(id)}`,
} as const;
