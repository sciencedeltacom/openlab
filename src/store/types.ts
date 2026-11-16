/**
 * Domain types for openlab.
 *
 * The hierarchy is Workspace → Session → Message.
 *
 * A **Project** is a folder on disk — the workspace. There is no in-memory mode: without a
 * folder there is nothing to read, write, run or save, so the app shows the way to open one.
 * Everything a workspace owns — its sessions and their transcripts, its results, its tracker —
 * lives on the project, so switching folders switches the whole surface and every one of them
 * is persisted.
 */

import type { InboxEntry, Label, Member, Note, SavedView, Task, TaskFilter, Wave } from '@/store/research';
import type { PackId } from '@/lib/agent/packs';
import type { PermissionRequest } from '@/lib/agent/permissions';
import type { ExecutionSettings } from '@/lib/execution';
import type { GuardSettings } from '@/lib/guard';
import type { Preferences, PromptOverrides } from '@/lib/settings';
import type { Job, Target } from '@/store/compute';
import type { ScienceRecord } from '@/lib/science/connectors';
import { mergeProviders, type Provider } from '@/lib/providers';
import type { Phase } from '@/theme/tokens';

/**
 * Everything a workspace owns.
 *
 * Held on the project rather than the app so two folders are two independent labs: different
 * sessions, different transcripts, different tasks. The app keeps the active workspace's copy
 * flattened in {@link AppState} for the surfaces to read; it is snapshotted back onto the
 * project on every switch and on every save.
 */
export interface WorkspaceData {
  sessions: Session[];
  activeSessionId: string | null;
  /** One transcript per session, so opening a session picks its conversation back up. */
  transcripts: Record<string, Message[]>;
  results: SavedResult[];
  tasks: Task[];
  waves: Wave[];
  members: Member[];
  labels: Label[];
  notes: Note[];
  views: SavedView[];
  inbox: InboxEntry[];
  /** Compute targets and the job ledger, both workspace-scoped and persisted. */
  targets: Target[];
  jobs: Job[];
  /** Sources the agent cited, kept so a `record:<id>` reference can be opened. */
  records: ScienceRecord[];
}

/** A folder on disk: the workspace everything else is scoped to. */
export interface Project {
  id: string;
  name: string;
  /** Absolute path of the folder. A project always has one. */
  path: string;
  /** The name of the workspace's icon, so workspaces are distinguishable at a glance. */
  icon: string;
  createdAt: number;
  lastOpenedAt: number;
  /** The workspace this folder owns. */
  workspace: WorkspaceData;
}

/** A block of content inside one message. */
export type Block =
  /** Prose. Rendered as markdown. */
  | { kind: 'text'; text: string }
  /** A model's reasoning trace. Collapsible, and never the only thing shown. */
  | { kind: 'thinking'; text: string; startedAt: number; endedAt: number | null }
  /** A tool the agent ran, with the label a human reads. */
  | {
      kind: 'tool';
      name: string;
      /** One line describing what it did, e.g. `read_file src/store/app.tsx`. */
      description: string;
      status: 'running' | 'ok' | 'error';
      startedAt: number;
      endedAt: number | null;
      output?: string;
      /** The provider's call id, so two calls with the same label stay two rows. */
      callId?: string;
      /** Parsed arguments, for the reader who wants to check the call, not just its output. */
      input?: Record<string, unknown>;
      /**
       * The worker that ran this call, when it was delegated.
       *
       * A worker's tools are drawn in the lead's transcript so the reader can watch the job,
       * but they are not replayed to the lead model: its own `task` result is what it acts on,
       * and replaying the worker's file reads was doubling the context delegation was meant
       * to save.
       */
      worker?: string;
    }
  /** Summary of the files a turn touched. */
  | { kind: 'diff'; filesChanged: number; added: number; removed: number }
  /** Footer metadata: which model ran, in which mode, for how long. */
  | {
      kind: 'run';
      modelRef: string;
      mode: AgentMode;
      durationMs: number;
      tokensIn?: number;
      tokensOut?: number;
      /** Input tokens served from the provider's cache, when it reported them. */
      cachedTokens?: number;
    };

/** How much latitude the agent has. */
export type AgentMode = 'agent' | 'plan' | 'ask';

/** How hard the model should think before answering. */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';

/**
 * Which way the tabs are drawn.
 *
 * One tab system, two directions: `horizontal` is a strip across the top, `vertical` is the
 * same strip in a column down the side. Nothing else differs — what opens a tab, what closes
 * one and what Ctrl+Tab walks are identical.
 */
export type NavMode = 'horizontal' | 'vertical';

/** One turn. */
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  blocks: Block[];
  createdAt: number;
  /**
   * Who wrote an assistant turn: the lead agent, or the worker a delegation ran as.
   *
   * A snapshot rather than a reference, because an agent can be renamed or removed and the
   * transcript still has to say who answered. Absent on turns written before this existed.
   */
  agent?: { id: string; name: string };
  /** Context this message contributed, for the usage meter. */
  tokens?: number;
}

/**
 * A file the agent produced, kept as a pointer rather than a copy.
 *
 * A saved result is the path plus what produced it, so the file on disk stays the source of
 * truth and the list never goes stale against a copy nobody regenerates.
 */
export interface SavedResult {
  id: string;
  /** The file's base name, which is what a list row shows. */
  name: string;
  /** Workspace path, or an empty string when the result has no file. */
  path: string;
  /** The session that produced it, when there was one. */
  sessionId: string | null;
  createdAt: number;
  pinned: boolean;
}

/** A line of enquiry inside a project. */
export interface Session {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Where the work stands, surfaced as a phase chip. */
  phase: Phase;
  /** The agent that leads this session's turns, when one was chosen at creation. */
  agentId?: string;
  /** The experiment this session belongs to, when it is running one. */
  experimentId?: string;
  /** Branch the session is on, when the project folder is a repository. */
  branch?: string;
  /** Linked pull request, when one exists. */
  pullRequest?: { number: number; state: 'open' | 'merged' | 'closed' };
  /** Shown at the top of the list, regardless of age. */
  pinned?: boolean;
  /** The steps the agent planned for this session, shown above the composer. */
  plan?: SessionPlan;
  /**
   * The session that delegated this one. A worker's transcript is a session of its own, so a
   * delegation can be read without scrolling the lead's turn.
   */
  parentId?: string;
  /** The worker this subsession ran as, when it is one. */
  worker?: { id: string; name: string };
  /** When the delegated turn ended; absent while it is still working. */
  finishedAt?: number;
  /** What the session's turns spent, when the engine reported it. */
  usage?: SessionUsage;
}

/** Tokens one run or one delegated turn spent. */
export interface SessionUsage {
  input: number;
  output: number;
  /** Input tokens the provider served from its cache. */
  cached: number;
}

/** How one step of a session plan stands. */
export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';

/** One step the agent wrote down before starting, and updates as it goes. */
export interface PlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
}

/**
 * The plan for one session.
 *
 * It lives beside the transcript rather than in it: the reader needs it while the turn runs,
 * above the composer, and the model keeps it current with the `plan_update` tool.
 */
export interface SessionPlan {
  goal: string;
  steps: PlanStep[];
  updatedAt: number;
}

/** A file shown in the dynamic island: the path to read and the name to display. */
export interface IslandFile {
  path: string;
  name: string;
  /**
   * Inline content for a file with no real path on disk — the seeded demo attachments. When
   * present the island renders this instead of reading the workspace, so a demo notebook or
   * archive opens without the user having those files.
   */
  demo?: IslandDemo;
}

/** One entry inside a demo archive. Mirrors what the Rust lister returns. */
export interface IslandZipEntry {
  name: string;
  isDir: boolean;
  size: number;
  compressed: number;
}

/** What a demo file holds, keyed by the same kinds the reader dispatches on. */
export type IslandDemo =
  | { kind: 'markdown'; text: string }
  | { kind: 'notebook'; text: string }
  | { kind: 'image'; src: string }
  | { kind: 'zip'; entries: IslandZipEntry[] }
  | { kind: 'text'; text: string };

/** Everything the app needs to render, in one place. */
export interface AppState {
  projects: Project[];
  activeProjectId: string | null;
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  /** One transcript per session for the active workspace. */
  transcripts: Record<string, Message[]>;
  /** Files the agent produced, recorded from its own writes. Newest first. */
  results: SavedResult[];
  /** The tracker's tasks. Empty until the user plans work. */
  tasks: Task[];
  /** The tracker's waves. Empty until the user plans work. */
  waves: Wave[];
  /** The people work can be assigned to. */
  members: Member[];
  /** The labels a task can carry. */
  labels: Label[];
  /** Free-form notes attached to a study or program. */
  notes: Note[];
  /** Saved tracker views. */
  views: SavedView[];
  /** The inbox feed. */
  inbox: InboxEntry[];
  /** Compute targets the workspace can send jobs to. */
  targets: Target[];
  /** The compute job ledger. */
  jobs: Job[];
  /** Sources the agent cited, so a `record:<id>` reference can open them. */
  records: ScienceRecord[];
  /** The cited record whose island is open, or `null`. Not persisted. */
  citationId: string | null;
  /**
   * Which session panel is open beside the transcript, if any.
   *
   * A panel in the row rather than an overlay: it takes width from the transcript the way the
   * agent column does, so the session's numbers never cover the work they describe.
   */
  sessionIsland: 'context' | 'stats' | 'settings' | null;
  /** The file the dynamic island is showing, or `null`. Not persisted. */
  fileIsland: IslandFile | null;

  /** Git status for the active project's folder; `null` for the scratch project. */
  git: import('@/lib/ipc-types').GitStatus | null;
  gitLoading: boolean;
  gitError: string | null;
  /** Commit message typed in the Git panel. */
  commitMessage: string;
  /** Paths ticked for staging. */
  selectedPaths: string[];

  /** `provider/model-id` for the session model. */
  modelRef: string;
  /** Providers the user added, keyed by id; a custom entry overrides a built-in of the same id. */
  customProviders: Provider[];
  /**
   * The models.dev catalog, loaded once at startup.
   *
   * Not persisted: it is reference data the app ships, not something the user wrote. It sits
   * between the built-ins and the user's own providers, so a curated entry wins over the
   * catalog and a user's entry wins over both.
   */
  catalogProviders: Provider[];
  /** Per-provider base URL overrides. Keys are not stored here — see the Rust secrets module. */
  providerBaseUrls: Record<string, string>;
  /**
   * Where the PDF scan index lives.
   *
   * Empty means the active project's `.openlab` folder, so the index travels with the
   * workspace; a path here pins it somewhere else (a shared drive, a global cache).
   */
  indexRoot: string;
  /**
   * Which providers have a credential in the OS store.
   *
   * Only the fact, never the secret. The engine reads this to decide whether it can reach a
   * model, and says which credential is missing when it cannot.
   */
  providerKeys: Record<string, boolean>;
  reasoning: ReasoningEffort;
  mode: AgentMode;
  /** Whether the theme is dark. */
  theme: 'light' | 'dark';
  /** Which way the tabs are drawn. The choice is the user's, in Settings → Appearance. */
  navMode: NavMode;
  /** Where a command runs: this machine, a sandbox, or a container. Settings → Sandbox / Container. */
  execution: ExecutionSettings;
  /** Automatic review of tool calls: allow, ask, or block. Settings → Permissions. */
  guard: GuardSettings;
  /** Every editable setting, by key. Kept with the prompt so it can be read by the model. */
  preferences: Preferences;
  /** The workspace's own words for the global, mode and worker instructions. */
  prompts: PromptOverrides;

  /** True while the run engine is producing a turn for the open session. */
  running: boolean;
  /**
   * The sessions running right now, by id: when each started and which agent leads it. A run
   * keeps going while the reader is elsewhere, so this is the record the panes read to show an
   * orb and an elapsed clock beside a session that is still working.
   */
  runs: Record<string, { startedAt: number; agentId: string }>;
  /** Non-null while the user has typed but not sent. */
  draft: string;

  /** Ask before the agent runs anything that writes or reaches the network. */
  guarded: boolean;
  /**
   * Domain packs the user has opened.
   *
   * This is the workbench's capability boundary: the agent sees the core tools plus the union
   * of these packs, and nothing else. A disabled pack is not a hidden feature — its tools are
   * absent from the model's brief entirely.
   */
  enabledPacks: PackId[];
  /**
   * Packs whose environment the user has provisioned on this machine.
   *
   * Install is a user assertion — openlab cannot fetch a reference genome or a GPU stack — so
   * it is kept apart from `enabledPacks`: a pack can be installed and closed, and only an
   * installed pack can be opened to the agent.
   */
  installedPacks: PackId[];
  /**
   * MCP servers the user has turned off.
   *
   * A pack *allows* a server; opening it is a second decision, because a server needs a
   * credential or a runtime the workbench cannot supply. Storing the exclusions rather than
   * the inclusions keeps the pack's allowance as the default — enabling a pack still brings
   * everything it declares — and makes turning one off the explicit act.
   */
  closedMcps: import('@/lib/agent/mcp').McpServerId[];
  /** A tool call waiting for the user's decision, or `null` when none is pending. */
  permission: PermissionRequest | null;
  /** File paths attached to the next message. */
  attachments: string[];

  /* ---- navigation ------------------------------------------------------------------- */
  /**
   * The path being shown, e.g. `research/tasks/crs-142`.
   *
   * A string rather than a union member: the tree branches into records, and a record's
   * identity is a parameter. `matchRoute` turns this into a section and its parameters.
   */
  route: string;
  /**
   * The tabs open beside the pinned ones, in strip order.
   *
   * Only the reader's own tabs are here: the six pinned pages come from `FIXED_TABS`, so a
   * path in this list is by definition closable. One tab per path — navigating to something
   * already open activates it rather than adding a second copy.
   */
  tabs: string[];
  /**
   * What the open record calls itself, when a page can say.
   *
   * The route knows a task's id but not its key, and a breadcrumb reading "Research / Tasks
   * / Task" is worse than no breadcrumb. The page knows, so it says.
   */
  pageTitle: string | null;
  /** Whether the command palette is open. Not persisted: it is a transient surface. */
  paletteOpen: boolean;
  /**
   * Which step of a systematic review is open.
   *
   * In the store rather than in the review, because the control that changes it lives in the
   * top bar — the page and its chrome are not the same component.
   */
  reviewStep: string;

  /* ---- research tracker ------------------------------------------------------------- */
  /** Layout the task list is using. */
  taskLayout: 'list' | 'board' | 'timeline';
  /** What the task list is narrowed to. */
  taskFilter: TaskFilter;
  /** Which saved view is applied, if any. */
  activeViewId: string | null;
  /** Grouping for the list layout. */
  taskGroupBy: 'none' | 'status' | 'assignee' | 'priority' | 'kind';
  /** Sort for the list layout. */
  taskSort: 'priority' | 'updated' | 'due' | 'key';
}

/** The active workspace's project, or `undefined` when no folder is open. */
export function activeProject(state: AppState): Project | undefined {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

/**
 * Every provider in play.
 *
 * Ordered so the later entry wins: built-ins, then the models.dev catalog, then the user's
 * own — a curated base URL beats the catalog, and the user beats everything.
 */
export function allProviders(state: AppState): Provider[] {
  return mergeProviders([...state.catalogProviders, ...state.customProviders]);
}

/** The active session, if one is selected. */
export function activeSession(state: AppState): Session | undefined {
  return state.sessions.find((session) => session.id === state.activeSessionId);
}
