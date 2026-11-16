/**
 * Where a navigation lands.
 *
 * One place decides whether a destination is a tab or a move inside the tab you are in. The
 * alternative — seventy call sites each knowing the rule — is how a tab strip ends up with
 * four copies of the same page and a back arrow that goes somewhere else.
 *
 * The rule:
 *
 *   pinned page       → its own pinned tab
 *   Settings page     → moves inside the Settings tab, and gets a tab of its own only when
 *                       entered from somewhere else
 *   anything else     → a tab of its own, or the tab already open on that path
 *
 * `workspace/new` is the one route with no tab: creating a workspace is a full-window flow.
 *
 * The rule is the same whichever chrome is chosen. Both are tab systems — a strip across the
 * top, or a column down the side — so a record opens a tab in either, and Ctrl+Tab walks the
 * same list. Only where the tabs are drawn differs.
 */

import { FIXED_TABS, HOME, hasTab, isFixed } from './pages';
import { matchRoute, pageFor } from './routes';

/** The part of the store a navigation reads and writes. */
export interface TabState {
  /** The reader's own tabs, in strip order. Pinned pages are not in it. */
  tabs: string[];
  /** The path on screen, which is the active tab's path. */
  route: string;
}

/** The strip in order: the pinned pages, then what the reader opened. */
export function tabOrder(state: TabState): string[] {
  return [...FIXED_TABS, ...state.tabs];
}

/** The page a tab belongs to: a record's list, or the page itself. */
export function parentOf(path: string): string {
  const match = matchRoute(path);
  return match.isDetail ? match.parent : match.pattern;
}

/** Two or more tabs on one page, drawn as one entry. */
export interface TabGroup {
  /** The page they all belong to, e.g. `library/files`. */
  parent: string;
  /** Its tabs, in strip order. */
  tabs: string[];
}

/** One entry in the strip: a lone tab, or a group of tabs that share a page. */
export type TabEntry = { kind: 'tab'; path: string } | { kind: 'group'; group: TabGroup };

/**
 * The strip's entries, in order.
 *
 * A page that several tabs belong to — three files, two tasks — becomes one group rather than
 * three entries that all say the same thing, because what the reader is choosing between is
 * the files, not the fact that they are files. A page with a single tab stays a plain tab:
 * a group of one is a group nobody needs to open.
 */
export function groupTabs(tabs: readonly string[]): TabEntry[] {
  const groups = new Map<string, string[]>();
  for (const path of tabs) {
    const parent = parentOf(path);
    const existing = groups.get(parent);
    if (existing) {
      existing.push(path);
    } else {
      groups.set(parent, [path]);
    }
  }
  return [...groups.entries()].map(([parent, paths]) =>
    paths.length > 1 ? { kind: 'group', group: { parent, tabs: paths } } : { kind: 'tab', path: paths[0]! },
  );
}

/** Activate a pinned page, or open (or re-activate) the tab a path belongs to. */
export function openTab(state: TabState, path: string): TabState {
  if (isFixed(path) || !hasTab(path)) {
    return { tabs: state.tabs, route: path };
  }
  const tabs = state.tabs.includes(path) ? state.tabs : [...state.tabs, path];
  return { tabs, route: path };
}

/** Navigate somewhere, by the rule above. */
export function goTo(state: TabState, path: string): TabState {
  if (!hasTab(path) || isFixed(path)) {
    return { tabs: state.tabs, route: path };
  }
  const match = matchRoute(path);
  const insideSurface = pageFor(state.route)?.inPlace ?? false;
  if (!match.isDetail && pageFor(path)?.inPlace && insideSurface) {
    const at = state.tabs.indexOf(state.route);
    if (at >= 0) {
      const tabs = [...state.tabs];
      tabs[at] = path;
      return { tabs, route: path };
    }
  }
  return openTab(state, path);
}

/** Close a tab. The tab to its left takes over, as it does in a browser. */
export function closeTab(state: TabState, path: string): TabState {
  const tabs = state.tabs.filter((tab) => tab !== path);
  if (state.route !== path) {
    return { tabs, route: state.route };
  }
  const order = tabOrder(state);
  const at = order.indexOf(path);
  return { tabs, route: order[at - 1] ?? order[at + 1] ?? HOME };
}

/** Close every tab that belongs to one page. */
export function closeGroup(state: TabState, parent: string): TabState {
  const closing = state.tabs.filter((tab) => parentOf(tab) === parent);
  let next = state;
  for (const path of closing) {
    next = closeTab(next, path);
  }
  return next;
}

/** Move to the next or previous tab, wrapping at both ends. */
export function cycleTab(state: TabState, delta: number): TabState {
  const order = tabOrder(state);
  const at = order.indexOf(state.route);
  return { tabs: state.tabs, route: order[(at + delta + order.length) % order.length] ?? HOME };
}
