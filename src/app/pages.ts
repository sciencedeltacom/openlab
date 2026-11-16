/**
 * Tabs.
 *
 * The window is a strip of tabs rather than a sidebar: six pages are pinned — the ones a
 * researcher is always in and out of — and everything else opens a tab of its own. A record
 * opens a tab too, which is what makes the strip useful: three tasks and a review sit side by
 * side instead of replacing one another.
 *
 * Two things live here. Which pages are pinned, and what a tab is called. The second is not
 * a label on the route: a record's tab has to read “Screen the cohorts”, not “Task”, or three
 * task tabs are three identical words. `titleOf` takes the names the caller can resolve, and
 * falls back to the route's own noun when the record is gone.
 */

import { HOME, HIDDEN_VIEWS, PAGES, matchRoute, type PageEntry } from './routes';

/**
 * The pinned pages, left to right.
 *
 * These are the surfaces with a permanent claim on attention: where you are (Home), the
 * agent, the feed, the plan, your own slice of it, and the workspace's files. They are
 * always in the strip and cannot be closed, so the answer to “how do I get back” never
 * depends on which tabs happen to be open.
 */
export const FIXED_TABS: readonly string[] = [
  'home',
  'assistant',
  'inbox',
  'research/tasks',
  'my-work',
  'library/files',
];

/** True when a path is one of the pinned pages. */
export function isFixed(path: string): boolean {
  return FIXED_TABS.includes(path);
}

/** The pinned pages, as entries, so the strip renders them without a lookup. */
export const FIXED_PAGES: readonly PageEntry[] = FIXED_TABS.map((path) =>
  PAGES.find((page) => page.path === path)!,
);

/**
 * Every page the picker behind `+` offers.
 *
 * The pinned pages are in it too: the picker is the index, and jumping to Home from it should
 * land on the Home tab rather than open a second one. Settings is a page *and* a set of pages,
 * so the hidden list is deduped against the pages above rather than listed twice.
 */
export const PICKER_PAGES: readonly PageEntry[] = [
  ...PAGES,
  ...HIDDEN_VIEWS.filter((view) => !PAGES.some((page) => page.path === view.path)),
];

/** A path's own name, with the record's name when the caller can resolve it. */
export function titleOf(path: string, titles: ReadonlyMap<string, string>): string {
  const match = matchRoute(path);
  if (!match.isDetail) {
    return match.label;
  }
  // A file's name is in its own path, so its tab never reads “File”.
  if (match.pattern === 'library/files/:fileId') {
    return match.params.fileId?.split(/[\\/]/).filter(Boolean).pop() ?? match.label;
  }
  return titles.get(path) ?? match.label;
}

/** The icon a tab wears: the record's, which is its list's. */
export function iconOf(path: string) {
  return matchRoute(path).icon;
}

/** True when a path is a file's own page rather than a list or a record of another kind. */
export function isFile(path: string): boolean {
  return matchRoute(path).pattern === 'library/files/:fileId';
}

/**
 * The dynamic tabs a restored window had.
 *
 * A tab is only ever a path the strip can show, and the route that was on screen belongs in
 * the strip even if the list of tabs was lost — otherwise the window reopens on a page with
 * no tab to explain it.
 */
export function restoreTabs(paths: readonly string[] | undefined, route: string): string[] {
  const tabs = (paths ?? []).filter((path) => hasTab(path) && !isFixed(path));
  if (hasTab(route) && !isFixed(route) && !tabs.includes(route)) {
    tabs.unshift(route);
  }
  return tabs;
}

/**
 * A path with a tab.
 *
 * `workspace/new` is the one route that is not a place in the strip: creating a workspace is
 * a full-window flow, so it has no tab to come back to.
 */
export function hasTab(path: string): boolean {
  return path !== 'workspace/new';
}

/** The root every fallback lands on. */
export { HOME };
