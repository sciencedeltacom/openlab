/**
 * Workspace snapshots.
 *
 * A workspace's data lives on its project so two folders are two independent labs. The
 * surfaces read the active workspace's copy flattened on `AppState`, which is cheaper than
 * threading the active project through every component. These two functions are the seam:
 * `snapshotWorkspace` folds the flat copy back onto the project before a switch or a save,
 * and `loadWorkspace` spreads a project's data back out when it becomes active.
 */

import type { AppState, WorkspaceData } from './types';

/** A new, empty workspace. */
export function emptyWorkspace(): WorkspaceData {
  return {
    sessions: [],
    activeSessionId: null,
    transcripts: {},
    results: [],
    tasks: [],
    waves: [],
    members: [],
    labels: [],
    notes: [],
    views: [],
    inbox: [],
    targets: [],
    jobs: [],
    records: [],
  };
}

/** The flat workspace fields, folded back onto a workspace record (with the open transcript). */
export function snapshotWorkspace(state: AppState): WorkspaceData {
  return {
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    // Fold the live transcript into the map so it survives the switch or the save.
    transcripts: state.activeSessionId
      ? { ...state.transcripts, [state.activeSessionId]: state.messages }
      : state.transcripts,
    results: state.results,
    tasks: state.tasks,
    waves: state.waves,
    members: state.members,
    labels: state.labels,
    notes: state.notes,
    views: state.views,
    inbox: state.inbox,
    targets: state.targets,
    jobs: state.jobs,
    records: state.records,
  };
}

/** The flat fields a workspace record spreads into, opening its active transcript. */
export function loadWorkspace(
  data: WorkspaceData,
): Pick<
  AppState,
  | 'sessions'
  | 'activeSessionId'
  | 'messages'
  | 'transcripts'
  | 'results'
  | 'tasks'
  | 'waves'
  | 'members'
  | 'labels'
  | 'notes'
  | 'views'
  | 'inbox'
  | 'targets'
  | 'jobs'
  | 'records'
> {
  return {
    sessions: data.sessions,
    activeSessionId: data.activeSessionId,
    transcripts: data.transcripts,
    messages: data.activeSessionId ? (data.transcripts[data.activeSessionId] ?? []) : [],
    results: data.results,
    tasks: data.tasks,
    waves: data.waves,
    members: data.members,
    labels: data.labels,
    notes: data.notes,
    views: data.views,
    inbox: data.inbox,
    targets: data.targets ?? [],
    jobs: data.jobs ?? [],
    records: data.records ?? [],
  };
}
