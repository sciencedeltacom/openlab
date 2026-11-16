/**
 * Initial state.
 *
 * openlab opens to a welcome, not a workspace: there is no folder until the user opens one,
 * because a workspace is a folder on disk and an agent with no folder can neither read nor
 * write. Nothing is seeded — no sessions, no results, no tasks — since every one of those is
 * a record of work the user actually did.
 */

import type { AppState } from './types';
import { DEFAULT_EXECUTION, normalizeExecution } from '@/lib/execution';
import { DEFAULT_GUARD, normalizeGuard } from '@/lib/guard';
import { DEFAULT_PROMPTS, normalizePreferences, normalizePrompts } from '@/lib/settings';
import { toPackIds, type PackId } from '@/lib/agent/packs';
import { emptyWorkspace } from './workspace';

/**
 * The direction a stored value means.
 *
 * The first two names for these were `sidebar` and `tabs`, and a window that stored one of
 * them keeps the direction it chose. `unknown` because the value is read back from storage,
 * where a string this build no longer names is possible.
 */
function restoreNavMode(value: unknown, fallback: AppState['navMode']): AppState['navMode'] {
  if (value === 'horizontal' || value === 'tabs') return 'horizontal';
  if (value === 'vertical' || value === 'sidebar') return 'vertical';
  return fallback;
}

/**
 * Packs provisioned on first run.
 *
 * A pack's environment cannot be fetched by openlab — a reference genome or a GPU stack is the
 * user's to provide — so this is only the starting assertion that the three most common packs
 * are set up. The user can uninstall any of them, and installing one is what makes it
 * openable.
 */
const DEFAULT_INSTALLED_PACKS: PackId[] = ['genomics', 'molecular', 'ml'];

/**
 * The state the app starts in.
 *
 * The theme follows the operating system on first run and the user's toggle afterwards,
 * which is what "system default" means in practice. Defaulting to light on a dark machine
 * is the kind of mismatch that reads as unfinished.
 */
function preferredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The state the app starts in. */
export function seedState(persisted?: Partial<AppState> | null): AppState {
  const base: AppState = {
    projects: [],
    activeProjectId: null,
    ...emptyWorkspace(),
    messages: [],

    git: null,
    gitLoading: false,
    gitError: null,
    commitMessage: '',
    selectedPaths: [],

    modelRef: 'anthropic/claude-sonnet-4-6',
    customProviders: [],
    catalogProviders: [],
    providerBaseUrls: {},
    indexRoot: '',
    providerKeys: {},
    reasoning: 'medium',
    mode: 'agent',
    theme: preferredTheme(),
    navMode: 'vertical',
    execution: DEFAULT_EXECUTION,
    guard: DEFAULT_GUARD,
    preferences: {},
    prompts: DEFAULT_PROMPTS,

    running: false,
    runs: {},
    draft: '',
    guarded: true,
    enabledPacks: DEFAULT_INSTALLED_PACKS,
    installedPacks: DEFAULT_INSTALLED_PACKS,
    closedMcps: [],
    permission: null,
    attachments: [],
    citationId: null,
    sessionIsland: null,
    fileIsland: null,

    route: 'home',
    tabs: [],
    pageTitle: null,
    paletteOpen: false,
    reviewStep: 'sources',

    taskLayout: 'list',
    taskFilter: {},
    activeViewId: null,
    taskGroupBy: 'status',
    taskSort: 'priority',
  };

  if (!persisted) {
    return base;
  }

  // Restore the durable slice; anything derived stays as the fresh default.
  //
  // The folder is not restored. Every launch opens on the welcome, with the recent list as
  // the way back in: a workspace is a place you choose, not one the app puts you back inside.
  const projects = persisted.projects ?? base.projects;

  return {
    ...base,
    projects,
    modelRef: persisted.modelRef ?? base.modelRef,
    customProviders: persisted.customProviders ?? base.customProviders,
    indexRoot: persisted.indexRoot ?? base.indexRoot,
    reasoning: persisted.reasoning ?? base.reasoning,
    mode: persisted.mode ?? base.mode,
    theme: persisted.theme ?? base.theme,
    // The first two names for these were `sidebar` and `tabs`; a window that stored one of
    // those keeps the direction it chose.
    navMode: restoreNavMode(persisted.navMode, base.navMode),
    execution: persisted.execution ? normalizeExecution(persisted.execution) : base.execution,
    guard: persisted.guard ? normalizeGuard(persisted.guard) : base.guard,
    preferences: persisted.preferences ? normalizePreferences(persisted.preferences) : base.preferences,
    prompts: persisted.prompts ? normalizePrompts(persisted.prompts) : base.prompts,
    // The window opens on the welcome, not on the last page it was showing: the route and the
    // tabs belong to a folder, and no folder is open until one is chosen.
    route: base.route,
    tabs: base.tabs,

    enabledPacks: persisted.enabledPacks ? toPackIds(persisted.enabledPacks) : base.enabledPacks,
    closedMcps: persisted.closedMcps ?? base.closedMcps,
    // An enabled pack that is not installed is not possible; reconcile on restore.
    installedPacks: persisted.installedPacks
      ? toPackIds([...persisted.installedPacks, ...(persisted.enabledPacks ?? [])])
      : base.installedPacks,
  };
}
