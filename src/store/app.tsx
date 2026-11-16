/**
 * Application store.
 *
 * A reducer plus context. The important property is that **a workspace is optional**:
 * openlab starts in a scratch project so the interface is usable immediately, and a
 * project backed by a folder is something you add, not something you must supply before
 * you are allowed in.
 *
 * Everything that touches the outside world (git, the run engine) lives in the action
 * helpers rather than in a component, so the same operation is reachable from a command
 * palette later.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';

import { type Provider } from '@/lib/providers';
import { randomProjectIcon } from '@/lib/project-icons';
import type { Job, Target } from '@/store/compute';
import type { DomainHost } from '@/lib/agent/domain';
import type { ScienceRecord } from '@/lib/science/connectors';
import { invokeCommand } from '@/lib/ipc';
import { notify } from '@/lib/toast';
import type { GitStatus } from '@/lib/ipc-types';
import { createToolHost } from '@/lib/agent/host';
import { PermissionQueue } from '@/lib/permission-queue';
import { activeAgent, teammates } from '@/components/agents/store';
import { HOME, hasTab, isFixed } from '@/app/pages';
import { closeGroup, closeTab, cycleTab, goTo } from '@/app/tabs';
import { services } from '@/lib/container';
import { startReview } from '@/lib/literature/runner';
import { sourceIds } from '@/lib/catalog/sources';
import {
  addDomain,
  allDomains,
  allExperiments,
  createExperiment,
  logTrial as logExperimentTrial,
  setOutcome as setExperimentOutcome,
} from '@/components/experiments/store';
import { resolveAssignment, resolveWorkbenchSurface, type PackSurface } from '@/lib/agent/packs';
import { buildSystemPrompt } from '@/lib/agent/prompt';
import { agentPolicy } from '@/lib/agent/policy';
import { specFor } from '@/lib/agent/spec';
import { estimateTokens, fitTranscript, messageTokens, transcriptBudget } from '@/lib/agent/tokens';
import { expandDraft } from '@/lib/commands/commands';
import { referencesFrom, withReferences } from '@/lib/chat/references';
import { allDatabases } from '@/components/databases/store';
import { type PermissionGate, type PermissionRequest } from '@/lib/agent/permissions';
import { createEngine } from './engine';
import { blocksToTranscript, windowMessages } from './transcript';
import { loadPersisted, savePersisted } from './persist';
import { seedState } from './seed';
import { emptyWorkspace, loadWorkspace, snapshotWorkspace } from './workspace';
import {
  activeProject,
  allProviders,
  type AppState,
  type Block,
  type Message,
  type Project,
  type ReasoningEffort,
  type AgentMode,
  type NavMode,
  type SavedResult,
  type IslandFile,
} from './types';
import { newInboxEntry } from '@/store/research';
import type { InboxEntry, Label, Member, Note, SavedView, Task, Wave } from '@/store/research';

/** Default model. A starting point, not a vendor commitment. */
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

/** Accent colours cycled through when projects are created. */

type Action =
  | { type: 'project/open'; name: string; path: string; icon?: string }
  | { type: 'project/select'; id: string }
  | { type: 'project/rename'; id: string; name: string }
  | { type: 'project/remove'; id: string }
  | { type: 'session/create'; id: string; title: string; agentId?: string }
  | { type: 'session/split'; id: string; parentId: string; title: string; agentId?: string }
  | {
      type: 'session/subagent';
      parentId: string;
      id: string;
      title: string;
      worker: { id: string; name: string };
    }
  | {
      type: 'session/subagentDone';
      id: string;
      usage: import('./types').SessionUsage;
    }
  | { type: 'session/select'; id: string }
  | { type: 'session/rename'; id: string; title: string }
  | { type: 'session/pin'; id: string; pinned: boolean }
  | { type: 'session/experiment'; id: string; experimentId: string }
  | { type: 'session/plan'; id: string; plan: import('./types').SessionPlan | null }
  | { type: 'session/archive'; id: string }
  | { type: 'git/loading' }
  | { type: 'git/loaded'; status: GitStatus }
  | { type: 'git/failed'; message: string }
  | { type: 'git/select'; path: string; selected: boolean }
  | { type: 'git/selectAll'; selected: boolean }
  | { type: 'git/selection'; paths: string[] }
  | { type: 'git/commitMessage'; value: string }
  | { type: 'message/append'; message: Message; sessionId?: string }
  | { type: 'message/appendBlock'; messageId: string; block: Block; sessionId?: string }
  | { type: 'run/started'; sessionId: string; agentId: string }
  | { type: 'run/finished'; sessionId: string }
  | { type: 'draft/changed'; value: string }
  | { type: 'guarded/toggled' }
  | { type: 'pack/enable'; id: import('@/lib/agent/packs').PackId }
  | { type: 'pack/disable'; id: import('@/lib/agent/packs').PackId }
  | { type: 'pack/toggle'; id: import('@/lib/agent/packs').PackId }
  | { type: 'pack/install'; id: import('@/lib/agent/packs').PackId }
  | { type: 'pack/uninstall'; id: import('@/lib/agent/packs').PackId }
  | { type: 'permission/request'; request: PermissionRequest }
  | { type: 'permission/set'; request: PermissionRequest | null }
  | { type: 'permission/clear' }
  | { type: 'result/save'; path: string; name: string; sessionId: string | null }
  | { type: 'result/remove'; id: string }
  | { type: 'result/pin'; id: string }
  | { type: 'task/create'; task: Task }
  | { type: 'target/create'; target: Target }
  | { type: 'target/patch'; id: string; patch: Partial<Target> }
  | { type: 'target/remove'; id: string }
  | { type: 'job/create'; job: Job }
  | { type: 'job/patch'; id: string; patch: Partial<Job> }
  | { type: 'job/remove'; id: string }
  | { type: 'record/add'; records: readonly ScienceRecord[] }
  | { type: 'citation/open'; id: string }
  | { type: 'citation/close' }
  | { type: 'session/island'; island: AppState['sessionIsland'] }
  | { type: 'mcp/toggle'; id: import('@/lib/agent/mcp').McpServerId }
  | { type: 'file/islandOpen'; file: IslandFile }
  | { type: 'file/islandClose' }
  | { type: 'task/patch'; id: string; patch: Partial<Task> }
  | { type: 'task/remove'; id: string }
  | { type: 'wave/create'; wave: Wave }
  | { type: 'wave/patch'; id: string; patch: Partial<Wave> }
  | { type: 'wave/remove'; id: string }
  | { type: 'member/create'; member: Member }
  | { type: 'member/patch'; id: string; patch: Partial<Member> }
  | { type: 'member/remove'; id: string }
  | { type: 'label/create'; label: Label }
  | { type: 'label/remove'; id: string }
  | { type: 'note/create'; note: Note }
  | { type: 'note/patch'; id: string; patch: Partial<Note> }
  | { type: 'note/remove'; id: string }
  | { type: 'view/create'; view: SavedView }
  | { type: 'view/remove'; id: string }
  | { type: 'inbox/add'; entry: InboxEntry }
  | { type: 'inbox/read'; id: string; read: boolean }
  | { type: 'inbox/remove'; id: string }
  | { type: 'attachment/add'; path: string }
  | { type: 'attachment/remove'; path: string }
  | { type: 'model/selected'; modelRef: string }
  | { type: 'provider/add'; provider: Provider }
  | { type: 'provider/update'; id: string; patch: Partial<Provider> }
  | { type: 'provider/remove'; id: string }
  | { type: 'catalog/set'; providers: Provider[] }
  | { type: 'provider/baseUrl'; providerId: string; baseUrl: string }
  | { type: 'setting/indexRoot'; value: string }
  | { type: 'providers/keys'; keys: Record<string, boolean> }
  | { type: 'message/streamText'; messageId: string; text: string; sessionId?: string }
  | { type: 'message/streamThinking'; messageId: string; text: string; sessionId?: string }
  | { type: 'model/reasoning'; effort: ReasoningEffort }
  | { type: 'model/mode'; mode: AgentMode }
  | { type: 'route/go'; route: string }
  | { type: 'tab/open'; path: string }
  | { type: 'tab/close'; path: string }
  | { type: 'tab/closeGroup'; parent: string }
  | { type: 'tab/cycle'; delta: number }
  | { type: 'page/title'; title: string | null }
  | { type: 'palette/set'; open: boolean }
  | { type: 'review/step'; step: string }
  | { type: 'task/layout'; layout: 'list' | 'board' | 'timeline' }
  | { type: 'task/group'; groupBy: 'none' | 'status' | 'assignee' | 'priority' | 'kind' }
  | { type: 'task/sort'; sort: 'priority' | 'updated' | 'due' | 'key' }
  | { type: 'task/filter'; filter: import('@/store/research').TaskFilter }
  | {
      type: 'view/apply';
      viewId: string | null;
      layout?: 'list' | 'board' | 'timeline';
      filter?: import('@/store/research').TaskFilter;
    }
  | { type: 'theme/toggled' }
  | { type: 'theme/set'; theme: 'light' | 'dark' }
  | { type: 'nav/mode'; mode: NavMode }
  | { type: 'execution/set'; execution: import('@/lib/execution').ExecutionSettings }
  | { type: 'guard/set'; guard: import('@/lib/guard').GuardSettings }
  | { type: 'pref/set'; key: string; entry: import('@/lib/settings').PreferenceEntry }
  | { type: 'prompt/set'; prompts: import('@/lib/settings').PromptOverrides };

/** New projects start on a fresh scratch session so the composer is never dead. */
function newSession(
  projectId: string,
  title = 'Untitled session',
  id = `s-${crypto.randomUUID().slice(0, 8)}`,
  agentId?: string,
) {
  return {
    id,
    projectId,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phase: 'ANALYSIS' as const,
    ...(agentId ? { agentId } : {}),
  };
}

/**
 * Write a session's messages, wherever it is.
 *
 * A run keeps going while the reader is elsewhere, so a message action names the session it
 * belongs to. The transcript map is the truth; the open session's `messages` mirror it when
 * that session is the one being written.
 */
function withMessages(
  state: AppState,
  sessionId: string,
  transform: (messages: Message[]) => Message[],
): AppState {
  const current = state.transcripts[sessionId] ?? (sessionId === state.activeSessionId ? state.messages : []);
  // Every transcript write goes through here, so the window bounds the growth at the one place
  // a message is added rather than at every call site.
  const next = windowMessages(transform(current));
  return {
    ...state,
    transcripts: { ...state.transcripts, [sessionId]: next },
    messages: sessionId === state.activeSessionId ? next : state.messages,
  };
}

/**
 * Identity of a block that can be reported more than once.
 *
 * The run engine reports progress by *re-emitting* a step: a tool goes out as
 * `running`, then again as `ok` with the same description. Coalescing on this key is
 * what turns those two emissions into one row that settles, instead of two rows where
 * the first never stops ticking.
 */
/**
 * Fold streamed text into a message.
 *
 * A stream calls back many times a second, so each call replaces the block it owns rather
 * than appending one. The trailing block of the right kind is that owner.
 */
function streamInto(blocks: Block[], kind: 'text' | 'thinking', value: string): Block[] {
  const last = blocks[blocks.length - 1];

  if (kind === 'text') {
    if (last?.kind === 'text') {
      const next = blocks.slice();
      next[next.length - 1] = { kind: 'text', text: value };
      return next;
    }
    return [...blocks, { kind: 'text', text: value }];
  }

  if (last?.kind === 'thinking' && last.endedAt === null) {
    const next = blocks.slice();
    next[next.length - 1] = { ...last, text: value };
    return next;
  }
  return [...blocks, { kind: 'thinking', text: value, startedAt: Date.now(), endedAt: null }];
}

/**
 * Close any open reasoning trace.
 *
 * A trace is open only until the next thing the model does — a tool call, prose, or the end
 * of the turn — so its line settles on a duration instead of ticking on forever.
 */
function closeThinking(blocks: Block[], at = Date.now()): Block[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.kind === 'thinking' && block.endedAt === null) {
      changed = true;
      return { ...block, endedAt: at };
    }
    return block;
  });
  return changed ? next : blocks;
}

function blockKey(block: Block): string | null {
  switch (block.kind) {
    case 'tool':
      // Prefer the provider's call id: two calls that read the same path are two rows.
      return block.callId ? `tool:${block.callId}` : `tool:${block.name}:${block.description}`;
    case 'thinking':
      return `thinking:${block.startedAt}`;
    default:
      return null;
  }
}

/** Fold the active workspace's live data back onto its project before it stops being active. */
function stashActive(state: AppState): Project[] {
  return state.projects.map((project) =>
    project.id === state.activeProjectId ? { ...project, workspace: snapshotWorkspace(state) } : project,
  );
}

/** Make a folder active: stash the current workspace, spread the target's data out. */
function selectProject(state: AppState, id: string): AppState {
  if (id === state.activeProjectId) {
    return state;
  }
  const target = state.projects.find((project) => project.id === id);
  if (!target) {
    return state;
  }
  return {
    ...state,
    projects: stashActive(state).map((project) =>
      project.id === id ? { ...project, lastOpenedAt: Date.now() } : project,
    ),
    activeProjectId: id,
    ...loadWorkspace(target.workspace),
    // The tabs were the last folder's records. Two folders are two labs, so the strip starts
    // clean and the window opens where every folder opens: on its home.
    tabs: [],
    route: HOME,
    pageTitle: null,
    selectedPaths: [],
    commitMessage: '',
  };
}

/* ================================================================================================
 * Navigation
 *
 * The rule itself lives in `@/app/tabs`: one place decides whether a destination is a tab or
 * a move inside the one you are in. The reducer only clears the page title, which belonged to
 * the page being left.
 * ============================================================================================== */

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'project/open': {
      // Opening the same folder again is just selecting it.
      const existing = state.projects.find((project) => project.path === action.path);
      if (existing) {
        return selectProject(state, existing.id);
      }
      const project: Project = {
        id: `p-${crypto.randomUUID().slice(0, 8)}`,
        name: action.name,
        path: action.path,
        icon: action.icon ?? randomProjectIcon(),
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        workspace: emptyWorkspace(),
      };
      return {
        ...state,
        projects: [...stashActive(state), project],
        activeProjectId: project.id,
        ...loadWorkspace(project.workspace),
        // Land on the workspace home, so opening a folder always shows its dashboard.
        route: 'home',
        tabs: [],
        selectedPaths: [],
        commitMessage: '',
      };
    }

    case 'project/select':
      return selectProject(state, action.id);

    case 'project/rename':
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.id === action.id ? { ...project, name: action.name } : project,
        ),
      };

    case 'project/remove': {
      const projects = state.projects.filter((project) => project.id !== action.id);
      if (state.activeProjectId !== action.id) {
        return { ...state, projects };
      }
      const next = projects[projects.length - 1];
      return {
        ...state,
        projects,
        activeProjectId: next?.id ?? null,
        ...loadWorkspace(next ? next.workspace : emptyWorkspace()),
        // The tabs were the removed folder's records, for the same reason they are cleared
        // when a switch happens.
        tabs: [],
        route: HOME,
        pageTitle: null,
        selectedPaths: [],
        commitMessage: '',
      };
    }

    case 'session/create': {
      if (!state.activeProjectId) {
        return state;
      }
      const session = newSession(state.activeProjectId, action.title, action.id, action.agentId);
      return {
        ...state,
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        messages: [],
        transcripts: { ...state.transcripts, [session.id]: [] },
      };
    }

    /**
     * A session opened because the reader turned to a different job.
     *
     * It sits beside the session it came from rather than under it: a worker's session is a
     * delegation, this one is the reader's next piece of work. It is not opened here — the
     * turn that asked for it is still running — so the page moves once that turn is done.
     */
    case 'session/split': {
      const parent = state.sessions.find((session) => session.id === action.parentId);
      if (!parent) {
        return state;
      }
      const session = {
        ...newSession(parent.projectId, action.title, action.id, action.agentId),
        phase: parent.phase,
      };
      return {
        ...state,
        sessions: [session, ...state.sessions],
        transcripts: { ...state.transcripts, [session.id]: [] },
      };
    }

    /**
     * A worker's own session.
     *
     * It belongs to the project and inherits the phase its lead is in, but it is not opened:
     * the reader is watching the lead's turn, and a delegation must not steal the page. It is
     * listed under the parent rather than in the session list.
     */
    case 'session/subagent': {
      const parent = state.sessions.find((session) => session.id === action.parentId);
      if (!parent) {
        return state;
      }
      const child = {
        ...newSession(parent.projectId, action.title, action.id),
        phase: parent.phase,
        parentId: parent.id,
        worker: action.worker,
      };
      return {
        ...state,
        sessions: [child, ...state.sessions],
        transcripts: { ...state.transcripts, [child.id]: [] },
      };
    }

    case 'session/subagentDone':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id ? { ...session, finishedAt: Date.now(), usage: action.usage } : session,
        ),
      };

    case 'session/select': {
      if (action.id === state.activeSessionId) {
        return state;
      }
      // Keep the open transcript before switching, then open the one that was asked for.
      const transcripts = state.activeSessionId
        ? { ...state.transcripts, [state.activeSessionId]: state.messages }
        : state.transcripts;
      return {
        ...state,
        activeSessionId: action.id,
        transcripts,
        messages: transcripts[action.id] ?? [],
        // A session already working keeps its clock running while you look elsewhere.
        running: Boolean(state.runs[action.id]),
      };
    }

    case 'session/plan':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id
            ? { ...session, plan: action.plan ?? undefined, updatedAt: Date.now() }
            : session,
        ),
      };

    case 'session/rename':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id ? { ...session, title: action.title, updatedAt: Date.now() } : session,
        ),
      };

    case 'session/pin':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id ? { ...session, pinned: action.pinned } : session,
        ),
      };

    case 'session/experiment':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id ? { ...session, experimentId: action.experimentId } : session,
        ),
      };

    case 'session/archive': {
      const sessions = state.sessions.filter((session) => session.id !== action.id);
      const { [action.id]: _archived, ...transcripts } = state.transcripts;
      if (state.activeSessionId !== action.id) {
        return { ...state, sessions, transcripts };
      }
      const next = sessions[0];
      return {
        ...state,
        sessions,
        transcripts,
        activeSessionId: next?.id ?? null,
        messages: next ? (transcripts[next.id] ?? []) : [],
      };
    }

    case 'git/loading':
      return { ...state, gitLoading: true, gitError: null };
    case 'git/loaded':
      return { ...state, git: action.status, gitLoading: false, gitError: null };
    case 'git/failed':
      return { ...state, gitLoading: false, gitError: action.message };

    case 'git/select': {
      const next = new Set(state.selectedPaths);
      if (action.selected) {
        next.add(action.path);
      } else {
        next.delete(action.path);
      }
      return { ...state, selectedPaths: [...next] };
    }

    case 'git/selectAll':
      return {
        ...state,
        selectedPaths: action.selected ? (state.git?.files ?? []).map((file) => file.path) : [],
      };

    case 'git/selection':
      return { ...state, selectedPaths: action.paths };

    case 'git/commitMessage':
      return { ...state, commitMessage: action.value };

    case 'message/append': {
      const sessionId = action.sessionId ?? state.activeSessionId;
      return sessionId ? withMessages(state, sessionId, (messages) => [...messages, action.message]) : state;
    }

    case 'message/appendBlock': {
      const sessionId = action.sessionId ?? state.activeSessionId;
      if (!sessionId) {
        return state;
      }
      return withMessages(state, sessionId, (messages) =>
        messages.map((message) => {
          if (message.id !== action.messageId) {
            return message;
          }
          const blocks = [...message.blocks];
          const key = blockKey(action.block);
          if (key) {
            const existing = blocks.findIndex((block) => blockKey(block) === key);
            if (existing >= 0) {
              blocks[existing] = action.block;
              return { ...message, blocks };
            }
          }
          const appended = [...blocks, action.block];
          // A tool call (or any block but reasoning) ends the trace it followed.
          return {
            ...message,
            blocks: action.block.kind === 'thinking' ? appended : closeThinking(appended),
          };
        }),
      );
    }

    case 'run/started': {
      const open = action.sessionId === state.activeSessionId;
      return {
        ...state,
        running: open,
        runs: { ...state.runs, [action.sessionId]: { startedAt: Date.now(), agentId: action.agentId } },
        draft: open ? '' : state.draft,
      };
    }
    case 'run/finished': {
      const { [action.sessionId]: _finished, ...runs } = state.runs;
      const closed = withMessages(state, action.sessionId, (messages) =>
        messages.map((message) => ({ ...message, blocks: closeThinking(message.blocks) })),
      );
      return {
        ...closed,
        runs,
        running: action.sessionId === state.activeSessionId ? false : state.running,
        // A turn that ended cannot still be waiting on a prompt.
        permission: null,
      };
    }
    case 'draft/changed':
      return { ...state, draft: action.value };
    case 'guarded/toggled':
      return { ...state, guarded: !state.guarded };
    case 'pack/enable':
      return state.installedPacks.includes(action.id) && !state.enabledPacks.includes(action.id)
        ? { ...state, enabledPacks: [...state.enabledPacks, action.id] }
        : state;
    case 'pack/disable':
      return state.enabledPacks.includes(action.id)
        ? { ...state, enabledPacks: state.enabledPacks.filter((id) => id !== action.id) }
        : state;
    case 'pack/toggle':
      if (!state.installedPacks.includes(action.id)) {
        return state;
      }
      return state.enabledPacks.includes(action.id)
        ? { ...state, enabledPacks: state.enabledPacks.filter((id) => id !== action.id) }
        : { ...state, enabledPacks: [...state.enabledPacks, action.id] };
    case 'pack/install':
      return {
        ...state,
        installedPacks: state.installedPacks.includes(action.id)
          ? state.installedPacks
          : [...state.installedPacks, action.id],
        enabledPacks: state.enabledPacks.includes(action.id)
          ? state.enabledPacks
          : [...state.enabledPacks, action.id],
      };
    case 'pack/uninstall':
      return {
        ...state,
        installedPacks: state.installedPacks.filter((id) => id !== action.id),
        enabledPacks: state.enabledPacks.filter((id) => id !== action.id),
      };
    case 'permission/request':
      return state.permission === null ? { ...state, permission: action.request } : state;
    case 'permission/set':
      return { ...state, permission: action.request };
    case 'permission/clear':
      return state.permission === null ? state : { ...state, permission: null };
    case 'result/save': {
      // One row per file: a rewrite refreshes the existing entry rather than piling up.
      const existing = state.results.find((result) => result.path === action.path);
      if (existing) {
        return {
          ...state,
          results: state.results.map((result) =>
            result.path === action.path
              ? { ...result, createdAt: Date.now(), sessionId: action.sessionId ?? result.sessionId }
              : result,
          ),
        };
      }
      const result: SavedResult = {
        id: `r-${crypto.randomUUID().slice(0, 8)}`,
        name: action.name,
        path: action.path,
        sessionId: action.sessionId,
        createdAt: Date.now(),
        pinned: false,
      };
      return { ...state, results: [result, ...state.results] };
    }
    case 'result/remove':
      return { ...state, results: state.results.filter((result) => result.id !== action.id) };
    case 'result/pin':
      return {
        ...state,
        results: state.results.map((result) =>
          result.id === action.id ? { ...result, pinned: !result.pinned } : result,
        ),
      };
    case 'task/create':
      return { ...state, tasks: [action.task, ...state.tasks] };
    case 'task/patch':
      return {
        ...state,
        tasks: state.tasks.map((task) => (task.id === action.id ? { ...task, ...action.patch } : task)),
      };
    case 'task/remove':
      return { ...state, tasks: state.tasks.filter((task) => task.id !== action.id) };
    case 'target/create':
      return { ...state, targets: [action.target, ...state.targets] };
    case 'target/patch':
      return {
        ...state,
        targets: state.targets.map((target) =>
          target.id === action.id ? { ...target, ...action.patch } : target,
        ),
      };
    case 'target/remove':
      return { ...state, targets: state.targets.filter((target) => target.id !== action.id) };
    case 'job/create':
      return { ...state, jobs: [action.job, ...state.jobs] };
    case 'job/patch':
      return {
        ...state,
        jobs: state.jobs.map((job) => (job.id === action.id ? { ...job, ...action.patch } : job)),
      };
    case 'job/remove':
      return { ...state, jobs: state.jobs.filter((job) => job.id !== action.id) };
    case 'record/add': {
      const byId = new Map(state.records.map((record) => [record.id, record]));
      for (const record of action.records) {
        byId.set(record.id, record);
      }
      return { ...state, records: [...byId.values()] };
    }
    case 'citation/open':
      return { ...state, citationId: action.id };
    case 'citation/close':
      return { ...state, citationId: null };
    case 'session/island':
      return { ...state, sessionIsland: action.island };
    case 'mcp/toggle': {
      const closed = state.closedMcps.includes(action.id)
        ? state.closedMcps.filter((id) => id !== action.id)
        : [...state.closedMcps, action.id];
      return { ...state, closedMcps: closed };
    }
    case 'file/islandOpen':
      return { ...state, fileIsland: action.file };
    case 'file/islandClose':
      return { ...state, fileIsland: null };
    case 'wave/create':
      return { ...state, waves: [action.wave, ...state.waves] };
    case 'wave/patch':
      return {
        ...state,
        waves: state.waves.map((wave) => (wave.id === action.id ? { ...wave, ...action.patch } : wave)),
      };
    case 'wave/remove':
      return { ...state, waves: state.waves.filter((wave) => wave.id !== action.id) };
    case 'member/create':
      return { ...state, members: [action.member, ...state.members] };
    case 'member/patch':
      return {
        ...state,
        members: state.members.map((member) =>
          member.id === action.id ? { ...member, ...action.patch } : member,
        ),
      };
    case 'member/remove':
      return { ...state, members: state.members.filter((member) => member.id !== action.id) };
    case 'label/create':
      return { ...state, labels: [action.label, ...state.labels] };
    case 'label/remove':
      return { ...state, labels: state.labels.filter((label) => label.id !== action.id) };
    case 'note/create':
      return { ...state, notes: [action.note, ...state.notes] };
    case 'note/patch':
      return {
        ...state,
        notes: state.notes.map((note) => (note.id === action.id ? { ...note, ...action.patch } : note)),
      };
    case 'note/remove':
      return { ...state, notes: state.notes.filter((note) => note.id !== action.id) };
    case 'view/create':
      return { ...state, views: [action.view, ...state.views] };
    case 'view/remove':
      return { ...state, views: state.views.filter((view) => view.id !== action.id) };
    case 'inbox/add':
      // Newest first: the inbox is read from the top.
      return { ...state, inbox: [action.entry, ...state.inbox] };
    case 'inbox/read':
      return {
        ...state,
        inbox: state.inbox.map((entry) => (entry.id === action.id ? { ...entry, read: action.read } : entry)),
      };
    case 'inbox/remove':
      return { ...state, inbox: state.inbox.filter((entry) => entry.id !== action.id) };
    case 'attachment/add':
      return state.attachments.includes(action.path)
        ? state
        : { ...state, attachments: [...state.attachments, action.path] };
    case 'attachment/remove':
      return { ...state, attachments: state.attachments.filter((path) => path !== action.path) };
    case 'model/selected':
      return { ...state, modelRef: action.modelRef };
    case 'provider/add':
      return {
        ...state,
        customProviders: [
          ...state.customProviders.filter((provider) => provider.id !== action.provider.id),
          action.provider,
        ],
      };
    case 'provider/update':
      return {
        ...state,
        customProviders: state.customProviders.map((provider) =>
          provider.id === action.id ? { ...provider, ...action.patch } : provider,
        ),
      };
    case 'provider/remove':
      return {
        ...state,
        customProviders: state.customProviders.filter((provider) => provider.id !== action.id),
      };
    case 'catalog/set':
      return { ...state, catalogProviders: action.providers };
    case 'providers/keys':
      return { ...state, providerKeys: action.keys };
    case 'message/streamText': {
      const sessionId = action.sessionId ?? state.activeSessionId;
      return sessionId
        ? withMessages(state, sessionId, (messages) =>
            messages.map((message) =>
              message.id === action.messageId
                ? // Prose ends the trace: the model has stopped thinking and started answering.
                  { ...message, blocks: closeThinking(streamInto(message.blocks, 'text', action.text)) }
                : message,
            ),
          )
        : state;
    }
    case 'message/streamThinking': {
      const sessionId = action.sessionId ?? state.activeSessionId;
      return sessionId
        ? withMessages(state, sessionId, (messages) =>
            messages.map((message) =>
              message.id === action.messageId
                ? { ...message, blocks: streamInto(message.blocks, 'thinking', action.text) }
                : message,
            ),
          )
        : state;
    }
    case 'provider/baseUrl':
      return {
        ...state,
        providerBaseUrls: { ...state.providerBaseUrls, [action.providerId]: action.baseUrl },
      };
    case 'setting/indexRoot':
      return { ...state, indexRoot: action.value };
    case 'model/reasoning':
      return { ...state, reasoning: action.effort };
    case 'model/mode':
      return { ...state, mode: action.mode };
    case 'route/go':
      return { ...state, ...goTo(state, action.route), pageTitle: null };
    case 'tab/open':
      return { ...state, ...goTo(state, action.path), pageTitle: null };
    case 'tab/close':
      return { ...state, ...closeTab(state, action.path), pageTitle: null };
    case 'tab/closeGroup':
      return { ...state, ...closeGroup(state, action.parent), pageTitle: null };
    case 'tab/cycle':
      return { ...state, ...cycleTab(state, action.delta), pageTitle: null };
    case 'page/title':
      return state.pageTitle === action.title ? state : { ...state, pageTitle: action.title };
    case 'palette/set':
      return { ...state, paletteOpen: action.open };
    case 'review/step':
      return { ...state, reviewStep: action.step };
    case 'task/layout':
      return { ...state, taskLayout: action.layout };
    case 'task/group':
      return { ...state, taskGroupBy: action.groupBy };
    case 'task/sort':
      return { ...state, taskSort: action.sort };
    case 'task/filter':
      return { ...state, taskFilter: action.filter, activeViewId: null };
    case 'view/apply':
      return {
        ...state,
        activeViewId: action.viewId,
        taskFilter: action.filter ?? (action.viewId ? state.taskFilter : {}),
        taskLayout: action.layout ?? state.taskLayout,
      };
    case 'theme/toggled':
      return { ...state, theme: state.theme === 'light' ? 'dark' : 'light' };
    case 'execution/set':
      return { ...state, execution: action.execution };
    case 'guard/set':
      return { ...state, guard: action.guard };
    case 'pref/set':
      return { ...state, preferences: { ...state.preferences, [action.key]: action.entry } };
    case 'prompt/set':
      return { ...state, prompts: action.prompts };
    case 'theme/set':
      return { ...state, theme: action.theme };
    case 'nav/mode':
      // Both chromes are tab systems; this only decides where the tabs are drawn.
      return action.mode === state.navMode ? state : { ...state, navMode: action.mode };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
  /** Re-read git status for the active project. No-op for the scratch project. */
  refreshGit: () => Promise<void>;
  /** Stage and commit what is selected. */
  commit: (options?: { addAll?: boolean }) => Promise<void>;
  /** Stage or unstage the selected paths. */
  stageSelected: (staged: boolean) => Promise<void>;
  /** Send the current draft to the run engine. */
  send: (prompt?: string, onStarted?: (sessionId: string) => void) => Promise<void>;
  /** Stop the in-flight run. */
  stop: () => void;
  /** Start a new session in the active project. */
  newSession: () => void;
  /** Re-read which providers have a credential in the OS store. */
  refreshProviderKeys: () => Promise<void>;
  /** Answer the pending tool-permission prompt. */
  answerPermission: (request: PermissionRequest, allow: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * The store's actions, without the store's state.
 *
 * `AppContext`'s value changes on every dispatch, so any component that reads it re-renders
 * on every keystroke and every streamed token. A generated interface is expensive to redraw
 * and only ever needs to *send*, so it reads this instead: `dispatch` is stable, and `send`
 * is a stable wrapper over the latest closure.
 */
interface AppActionsValue {
  dispatch: Dispatch<Action>;
  send: (prompt?: string, onStarted?: (sessionId: string) => void) => Promise<void>;
}

const AppActionsContext = createContext<AppActionsValue | null>(null);

/** Store provider. Wrap the app once; read it with {@link useApp}. */
export function AppProvider({ children }: { children: ReactNode }) {
  // Restore the durable slice on first render. A folder is never required to get here.
  const [state, dispatch] = useReducer(reducer, undefined, () => seedState(loadPersisted()));
  // The latest state, for readers that outlive a render — the domain host, which the agent
  // calls between tool calls and must see what the last one wrote.
  const stateRef = useRef(state);
  stateRef.current = state;
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  // A queue rather than one resolver: parallel calls and a background session can both ask,
  // and the second must not overwrite the first promise.
  const [permissions] = useState(
    () =>
      new PermissionQueue<import('@/lib/agent/permissions').PermissionRequest>((request) =>
        dispatch({ type: 'permission/set', request }),
      ),
  );

  /**
   * Ask the user before a call that changes the workspace or reaches the network.
   *
   * The promise is settled by the dialog through {@link answerPermission}; an abort resolves
   * it as a refusal so a stopped turn cannot leave a prompt on screen.
   */
  const askPermission = useCallback<PermissionGate>(
    (request, signal) => permissions.enqueue(request, signal),
    [permissions],
  );

  const answerPermission = useCallback(
    (request: PermissionRequest, allow: boolean) => {
      permissions.answer(allow, request);
    },
    [permissions],
  );

  // Persist the durable slice, debounced. Serialising every project's transcripts is not
  // cheap, and it was running on every keystroke — the draft changes on each one, and the
  // whole store was being written to storage as a side effect of typing. The write now
  // happens once the state has settled, and on the way out.
  useEffect(() => {
    const timer = window.setTimeout(() => savePersisted(stateRef.current), 400);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const flush = () => savePersisted(stateRef.current);
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Apply the theme to the document so Tailwind's `dark:` variants follow it.
  useEffect(() => {
    const dark = state.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'openlab-dark' : 'openlab';
    document.documentElement.classList.toggle('dark', dark);
    // Tells the engine which way native widgets (scrollbars, form controls) should render.
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [state.theme]);

  const project = activeProject(state);
  const workspacePath = project?.path ?? null;

  const refreshGit = useCallback(async () => {
    if (!workspacePath) {
      dispatch({
        type: 'git/loaded',
        status: { info: { isRepo: false, root: null, branch: null, ahead: 0, behind: 0 }, files: [] },
      });
      return;
    }
    dispatch({ type: 'git/loading' });
    const result = await invokeCommand<GitStatus>('git_status', { cwd: workspacePath });
    if (result.ok) {
      dispatch({ type: 'git/loaded', status: result.value });
    } else {
      dispatch({ type: 'git/failed', message: result.error.message });
    }
  }, [workspacePath]);

  useEffect(() => {
    void refreshGit();
  }, [refreshGit]);

  const stageSelected = useCallback(
    async (staged: boolean) => {
      if (!workspacePath || state.selectedPaths.length === 0) {
        return;
      }
      const result = await invokeCommand(staged ? 'git_stage' : 'git_unstage', {
        cwd: workspacePath,
        paths: state.selectedPaths,
      });
      if (!result.ok) {
        notify(staged ? 'Could not stage the selection' : 'Could not unstage the selection', {
          description: result.error.message,
          tone: 'danger',
        });
      }
      await refreshGit();
    },
    [workspacePath, state.selectedPaths, refreshGit],
  );

  const commit = useCallback(
    async (options?: { addAll?: boolean }) => {
      if (!workspacePath || state.commitMessage.trim().length === 0) {
        return;
      }
      const result = await invokeCommand<string>('git_commit', {
        cwd: workspacePath,
        message: state.commitMessage,
        addAll: options?.addAll ?? state.selectedPaths.length === 0,
      });
      if (result.ok) {
        dispatch({ type: 'git/commitMessage', value: '' });
        dispatch({ type: 'git/selectAll', selected: false });
        notify('Committed', { description: state.commitMessage, tone: 'success' });
      } else {
        notify('Commit failed', { description: result.error.message, tone: 'danger' });
      }
      await refreshGit();
    },
    [workspacePath, state.commitMessage, state.selectedPaths.length, refreshGit],
  );

  const stop = useCallback(() => {
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      return;
    }
    controllersRef.current.get(sessionId)?.abort();
    controllersRef.current.delete(sessionId);
    dispatch({ type: 'run/finished', sessionId });
  }, [state.activeSessionId]);

  const newSession = useCallback(() => {
    const id = `s-${crypto.randomUUID().slice(0, 8)}`;
    dispatch({ type: 'session/create', id, title: 'Untitled session', agentId: activeAgent().id });
    // A session is a page, so making one should take you to it rather than to a list.
    dispatch({ type: 'route/go', route: `assistant/${id}` });
  }, []);

  /** Re-read which providers have a credential. The Models panel calls this after an edit. */
  const refreshProviderKeys = useCallback(async () => {
    const result = await invokeCommand<{ provider: string; hasKey: boolean }[]>('secrets_status', {
      providers: allProviders(state).map((provider) => provider.id),
    });
    if (result.ok) {
      dispatch({
        type: 'providers/keys',
        keys: Object.fromEntries(result.value.map((entry) => [entry.provider, entry.hasKey])),
      });
    }
  }, [state.customProviders, state.catalogProviders]);

  // Which providers can actually be reached. Read once on mount; the Models panel refreshes
  // it after a credential changes, so the engine never guesses.
  useEffect(() => {
    void refreshProviderKeys();
  }, [refreshProviderKeys]);

  // A review runs while the reader is somewhere else, so when one comes back it is filed in
  // the inbox: that is the surface for work that finished without being watched.
  useEffect(() => {
    services.reviewRuns.report = (run) => {
      dispatch({
        type: 'inbox/add',
        entry: newInboxEntry({
          kind: run.status === 'done' ? 'review-done' : 'run-failed',
          body:
            run.status === 'done'
              ? `The review “${run.question}” finished: ${run.records} records screened.`
              : `The review “${run.question}” failed: ${run.error ?? 'no reason given'}`,
        }),
      });
    };
    return () => {
      services.reviewRuns.report = () => {};
    };
  }, [dispatch]);

  const send = useCallback(
    async (
      explicit?: string,
      onStarted?: (sessionId: string) => void,
      into?: { id: string; title: string },
    ) => {
      const typed = (explicit ?? state.draft).trim();
      if (!typed) {
        return;
      }
      // A draft that is a slash command is expanded into the prompt it stands for, so what
      // the transcript records is what actually ran rather than the shorthand for it. A
      // mention of a record is spelled out the same way: the model cannot see the store, so
      // `@job:j-1a2b3c4d` reaches it as the job's id and the facts that identify it.
      const written = expandDraft(typed)?.prompt ?? typed;
      const prompt = withReferences(
        written,
        referencesFrom({
          jobs: state.jobs,
          targets: state.targets,
          tasks: state.tasks,
          waves: state.waves,
          experiments: allExperiments(),
          databases: allDatabases(),
        }),
      );

      // A session is created on demand, so the composer always works. A split names its
      // session outright: the turn that asked for it is still finishing, so the active
      // session is the wrong answer for it.
      let sessionId = into?.id ?? state.activeSessionId;
      if (sessionId && state.runs[sessionId]) {
        // This session is already working; a second turn would race it.
        return;
      }
      if (!sessionId) {
        sessionId = `s-${crypto.randomUUID().slice(0, 8)}`;
        dispatch({
          type: 'session/create',
          id: sessionId,
          title: prompt.slice(0, 60),
          agentId: activeAgent().id,
        });
      }

      const userMessage: Message = {
        id: `m-${crypto.randomUUID().slice(0, 8)}`,
        role: 'user',
        blocks: [{ kind: 'text', text: prompt }],
        createdAt: Date.now(),
      };
      // The agent that answers this turn, recorded on the turn itself: the transcript says who
      // answered even after the bar has moved on to another agent.
      const agent = activeAgent();
      const assistantId = `m-${crypto.randomUUID().slice(0, 8)}`;
      dispatch({ type: 'message/append', message: userMessage, sessionId });
      dispatch({
        type: 'message/append',
        message: {
          id: assistantId,
          role: 'assistant',
          agent: { id: agent.id, name: agent.name },
          blocks: [],
          createdAt: Date.now(),
        },
        sessionId,
      });
      dispatch({ type: 'run/started', sessionId, agentId: agent.id });
      // The session exists and the turn has started; a caller that is not already on the
      // session's page (Home) can follow it now.
      onStarted?.(sessionId);
      state.attachments.forEach((path) => dispatch({ type: 'attachment/remove', path }));

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        notify('This machine looks offline', {
          description: 'A hosted provider will not be reachable; a local model still works.',
          tone: 'warning',
        });
      }
      const controller = new AbortController();
      controllersRef.current.set(sessionId, controller);
      // The wall-clock limit is a rule, not a preference: a turn that runs past it stops and
      // says so, with the work it already has.
      const policy = agentPolicy(state.preferences);
      let timedOut = false;
      const turnTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, policy.turnMinutes * 60_000);
      // The agent bar chooses how this turn leads: its instructions, its model, its team.
      const runModelRef = agent.modelRef || state.modelRef;
      const engine = createEngine({
        modelRef: runModelRef,
        baseUrls: state.providerBaseUrls,
        providersWithKeys: state.providerKeys,
        providers: allProviders(state),
        sessionId,
        preferences: state.preferences,
        prompts: state.prompts,
      });

      // The transcript is rebuilt from the blocks, so tool calls and their results survive
      // into the next turn instead of collapsing to the prose alone.
      // The session keeps its whole record; what the model sees is fitted to the window.
      const transcript = fitTranscript(
        blocksToTranscript([...(into ? [] : state.messages), userMessage]),
        transcriptBudget(contextWindowFor(state)),
      );
      // A bounded agent narrows the surface the way a delegated worker's is narrowed — packs
      // chosen, or read-only — while the built-in main agent keeps the whole workbench.
      const resolved = resolveAssignment(
        { packs: agent.packs, readOnly: agent.readOnly },
        { enabledPacks: state.enabledPacks },
      );
      const surface =
        agent.packs.length > 0 || agent.readOnly
          ? { toolIds: resolved.toolIds, mcpIds: resolved.mcpIds, skillIds: resolved.skillIds }
          : resolveWorkbenchSurface({
              enabledPacks: state.enabledPacks,
              closedMcps: state.closedMcps,
            });
      const host = createToolHost(workspacePath ?? '', state.execution);
      // A session the agent opened for a different job. The page moves to it only after this
      // turn is written, so the work that asked for the split stays where it happened.
      const split: { into: string | null; title: string; prompt: string } = {
        into: null,
        title: '',
        prompt: '',
      };
      // The app's own records, read and written through the store so the agent and the
      // screens cannot disagree about what a workspace holds.
      const domain: DomainHost = {
        tasks: () => stateRef.current.tasks,
        waves: () => stateRef.current.waves,
        targets: () => stateRef.current.targets,
        jobs: () => stateRef.current.jobs,
        records: () => stateRef.current.records,
        experiments: () => allExperiments(),
        domains: () => allDomains(),
        addTask: (task) => dispatch({ type: 'task/create', task }),
        patchTask: (id, patch) => dispatch({ type: 'task/patch', id, patch }),
        addWave: (wave) => dispatch({ type: 'wave/create', wave }),
        patchWave: (id, patch) => dispatch({ type: 'wave/patch', id, patch }),
        addTarget: (target) => dispatch({ type: 'target/create', target }),
        addJob: (job) => dispatch({ type: 'job/create', job }),
        addRecords: (records) => dispatch({ type: 'record/add', records }),
        createExperiment: (input) => createExperiment(input),
        linkExperiment: (sessionId, experimentId) =>
          dispatch({ type: 'session/experiment', id: sessionId, experimentId }),
        logTrial: (id, trial) => logExperimentTrial(id, trial),
        setOutcome: (id, outcome, summary) => setExperimentOutcome(id, outcome, summary),
        createDomain: (domain) => addDomain(domain),
        sessionPlan: () => stateRef.current.sessions.find((candidate) => candidate.id === sessionId)?.plan,
        setSessionPlan: (plan) => dispatch({ type: 'session/plan', id: sessionId, plan }),
        // The session the turn is running in, by name: the lead names it while it is still
        // “Untitled session”, and never once the reader or a first name has settled it.
        sessionTitle: () => stateRef.current.sessions.find((candidate) => candidate.id === sessionId)?.title,
        setSessionTitle: (title) => dispatch({ type: 'session/rename', id: sessionId, title }),
        // A different job gets its own session, so the two do not share a context. The prompt
        // it carried runs there, once this turn is on the record.
        splitSession: (title, prompt) => {
          const id = `s-${crypto.randomUUID().slice(0, 8)}`;
          dispatch({ type: 'session/split', id, parentId: sessionId, title, agentId: agent.id });
          split.into = id;
          split.title = title;
          split.prompt = prompt;
          return id;
        },
        // A review the agent starts runs in the background like one the user starts; with no
        // sources named it reviews against the first few saved ones.
        startReview: (inputs) => {
          const sources =
            inputs.sources && inputs.sources.length > 0 ? inputs.sources : sourceIds().slice(0, 3);
          if (sources.length === 0) {
            return null;
          }
          const { id } = startReview(stateRef.current, {
            question: inputs.question,
            inclusion: '',
            exclusion: '',
            dateRange: '',
            sources,
            maxRecords: inputs.maxRecords ?? 24,
            depth: 'standard',
            analysis: ['Narrative synthesis'],
            format: 'narrative',
          });
          return id;
        },
      };

      try {
        await engine.run({
          prompt,
          workspace: workspacePath ?? '',
          modelRef: runModelRef,
          mode: state.mode,
          reasoning: state.reasoning,
          transcript,
          surface,
          enabledPacks: state.enabledPacks,
          agent: {
            id: agent.id,
            name: agent.name,
            instructions: agent.instructions,
            teammates: teammates().map((mate) => `${mate.name} (${mate.id})`),
          },
          sessionTitle: into?.title ?? state.sessions.find((candidate) => candidate.id === sessionId)?.title,
          guard: { guarded: state.guarded, ask: askPermission, policy: state.guard },
          host,
          domain,
          signal: controller.signal,
          onBlock: (block) => {
            dispatch({ type: 'message/appendBlock', messageId: assistantId, block, sessionId });
            // A file the agent wrote is a result: record the pointer so it can be found again.
            if (block.kind === 'tool' && block.name === 'write_file' && block.status === 'ok') {
              const path = typeof block.input?.path === 'string' ? block.input.path : null;
              if (path) {
                dispatch({
                  type: 'result/save',
                  path,
                  name: path.split(/[\\/]/).pop() || path,
                  sessionId,
                });
              }
            }
          },
          onText: (text) => dispatch({ type: 'message/streamText', messageId: assistantId, text, sessionId }),
          onThinking: (text) =>
            dispatch({ type: 'message/streamThinking', messageId: assistantId, text, sessionId }),
          // A delegation gets a session of its own: the reader can follow the worker's work
          // without the lead's turn growing a second transcript inside it.
          openSubsession: ({ worker, description }) => {
            const childId = `s-${crypto.randomUUID().slice(0, 8)}`;
            dispatch({
              type: 'session/subagent',
              parentId: sessionId,
              id: childId,
              title: description,
              worker: { id: worker.id, name: worker.name },
            });
            const messageId = `m-${crypto.randomUUID().slice(0, 8)}`;
            dispatch({
              type: 'message/append',
              sessionId: childId,
              message: {
                id: messageId,
                role: 'assistant',
                agent: { id: worker.id, name: worker.name },
                blocks: [],
                createdAt: Date.now(),
              },
            });
            return {
              onBlock: (block) =>
                dispatch({ type: 'message/appendBlock', messageId, block, sessionId: childId }),
              onText: (text) => dispatch({ type: 'message/streamText', messageId, text, sessionId: childId }),
              onThinking: (text) =>
                dispatch({ type: 'message/streamThinking', messageId, text, sessionId: childId }),
              onDone: (usage) => dispatch({ type: 'session/subagentDone', id: childId, usage }),
            };
          },
          onDone: () => {
            void refreshGit();
          },
        });
        // The split takes effect once this turn is written: a tab of its own, and the prompt
        // it carried starts there rather than waiting to be typed again.
        if (split.into) {
          const id = split.into;
          dispatch({ type: 'route/go', route: `assistant/${id}` });
          void send(split.prompt, undefined, { id, title: split.title });
        }
      } finally {
        clearTimeout(turnTimer);
        controllersRef.current.delete(sessionId);
        dispatch({ type: 'run/finished', sessionId });
        if (timedOut) {
          notify('Stopped at the wall-clock limit', {
            description: `The turn ran for ${policy.turnMinutes} minutes. The work so far is kept; ask for it to continue.`,
            tone: 'warning',
          });
        }
      }
    },
    [
      state.draft,
      state.running,
      state.runs,
      state.activeSessionId,
      state.modelRef,
      state.mode,
      state.reasoning,
      state.messages,
      state.enabledPacks,
      state.guarded,
      state.customProviders,
      state.catalogProviders,
      workspacePath,
      refreshGit,
      askPermission,
    ],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      dispatch,
      refreshGit,
      commit,
      stageSelected,
      send,
      stop,
      newSession,
      refreshProviderKeys,
      answerPermission,
    }),
    [state, refreshGit, commit, stageSelected, send, stop, newSession, refreshProviderKeys, answerPermission],
  );

  // A stable handle on `send`, so readers of the actions context never re-render when the
  // state (and therefore `send`'s identity) changes.
  const sendRef = useRef(send);
  sendRef.current = send;
  const actions = useMemo<AppActionsValue>(
    () => ({ dispatch, send: (prompt?: string) => sendRef.current(prompt) }),
    [],
  );

  return (
    <AppContext.Provider value={value}>
      <AppActionsContext.Provider value={actions}>{children}</AppActionsContext.Provider>
    </AppContext.Provider>
  );
}

/**
 * Let a record page name itself in the breadcrumb.
 *
 * Call with the record's own label. The section pages do not call it: their route already
 * knows what they are.
 */
export function usePageTitle(title: string | undefined): void {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ type: 'page/title', title: title ?? null });
    return () => dispatch({ type: 'page/title', title: null });
  }, [dispatch, title]);
}

/** Read the store. Throws when used outside {@link AppProvider}. */
export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error('useApp must be used inside <AppProvider>');
  }
  return value;
}

/**
 * Read the store's actions without subscribing to its state.
 *
 * Use this where a component only needs to *dispatch* or *send* — a generated interface, a
 * deep row — so it does not re-render every time the draft or the transcript changes.
 */
export function useAppActions(): AppActionsValue {
  const value = useContext(AppActionsContext);
  if (!value) {
    throw new Error('useAppActions must be used inside <AppProvider>');
  }
  return value;
}

/** The context window the selected model reports, with a conservative fallback. */
export function contextWindowFor(state: AppState): number {
  const slash = state.modelRef.indexOf('/');
  const providerId = slash === -1 ? state.modelRef : state.modelRef.slice(0, slash);
  const modelId = slash === -1 ? '' : state.modelRef.slice(slash + 1);
  const provider = allProviders(state).find((candidate) => candidate.id === providerId);
  return provider?.models.find((model) => model.id === modelId)?.contextWindow ?? 200_000;
}

/** The surface the next turn will run with, for the meter's prompt estimate. */
function surfaceForMeter(state: AppState): PackSurface {
  const agent = activeAgent();
  const resolved = resolveAssignment(
    { packs: agent.packs, readOnly: agent.readOnly },
    { enabledPacks: state.enabledPacks },
  );
  return agent.packs.length > 0 || agent.readOnly
    ? { toolIds: resolved.toolIds, mcpIds: resolved.mcpIds, skillIds: resolved.skillIds }
    : resolveWorkbenchSurface({ enabledPacks: state.enabledPacks, closedMcps: state.closedMcps });
}

/**
 * Context usage for the active session, for the header meter.
 *
 * The conversation is estimated from the stored blocks, and the static prefix — the system
 * prompt and the tool schemas the next request carries — is counted too, because it is real
 * context the reader is paying for on every step. Tokens a provider reported for a finished
 * run are not used here: they describe one call, not what the next one will send.
 */
export function useContextUsage(state: AppState): { used: number; limit: number; ratio: number } {
  const surface = surfaceForMeter(state);
  const agent = activeAgent();
  const system = buildSystemPrompt({
    mode: state.mode,
    workspace: activeProject(state)?.path ?? '',
    surface,
    agent: {
      id: agent.id,
      name: agent.name,
      instructions: agent.instructions,
      teammates: teammates().map((mate) => `${mate.name} (${mate.id})`),
    },
  });
  const schemas = surface.toolIds.reduce((sum, id) => sum + estimateTokens(JSON.stringify(specFor(id))), 0);
  const conversation = state.messages.reduce((sum, message) => sum + messageTokens(message), 0);
  const limit = contextWindowFor(state);
  const used = conversation + estimateTokens(system) + schemas;
  return { used, limit, ratio: Math.min(1, used / limit) };
}

export { DEFAULT_MODEL };
