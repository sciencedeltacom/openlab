/**
 * Session persistence.
 *
 * Workspaces, their sessions, transcripts, results and tracker are written to the app's
 * SQLite database (`src/lib/db`) so that opening a folder means something: everything done in
 * it is still there next launch, and a second folder is a second, separate lab. The data lives
 * on each project, so saving folds the active workspace back onto its project first.
 *
 * This module is the seam the app store already knew — {@link loadPersisted} on the way in,
 * {@link savePersisted} on the way out — so the reducer never learned that storage changed.
 * Loading happens once at boot; afterwards the slice is cached and reads stay synchronous.
 *
 * Deliberately not persisted: git status, the in-flight run, the draft, and which overlay is
 * open. Those are derived or ephemeral, and restoring them would resurrect stale state.
 */

import { logError } from '@/lib/log';
import { getDb, serialized } from '@/lib/db/client';
import { clearStorageIssue, reportStorageIssue } from '@/lib/db/health';
import { loadState, saveState, type Persisted } from '@/lib/db/state';
import { writePlan } from '@/lib/plan/files';
import { iconForId } from '@/lib/project-icons';
import { activeProject } from './types';
import { seedState } from './seed';
import { windowMessages } from './transcript';
import type { AppState, Block, Message, Project } from './types';

/** The persisted slice, read once at boot and served synchronously after. */
let cached: Partial<Persisted> | null = null;

/** The key the pre-SQLite build wrote, and the shape it wrote there. */
const LEGACY_KEY = 'openlab.state.v2';
const LEGACY_VERSION = 2;

/**
 * Close any block that was still open when the app last closed.
 *
 * A turn interrupted by a quit would otherwise be restored with a reasoning trace that
 * never finishes and a tool call that spins forever. An interrupted step is a fact worth
 * keeping, so it is marked rather than deleted.
 */
function sanitizeMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    blocks: message.blocks.map((block): Block => {
      if (block.kind === 'thinking' && block.endedAt === null) {
        return { ...block, endedAt: block.startedAt };
      }
      if (block.kind === 'tool' && block.status === 'running') {
        return {
          ...block,
          status: 'error',
          endedAt: block.startedAt,
          output: 'Interrupted when openlab closed.',
        };
      }
      return block;
    }),
  }));
}

/** A project restored with every transcript's interrupted blocks closed. */
function sanitizeProject(project: Project): Project {
  const transcripts = Object.fromEntries(
    Object.entries(project.workspace.transcripts).map(([id, messages]) => [
      id,
      windowMessages(sanitizeMessages(messages)),
    ]),
  );
  // Workspaces used to wear a colour; they wear an icon now. Derive one for old data.
  const icon = typeof project.icon === 'string' && project.icon ? project.icon : iconForId(project.id);
  return { ...project, icon, workspace: { ...project.workspace, transcripts } };
}

/**
 * The state the previous build left in webview storage, if any.
 *
 * Storage moved from `localStorage` to SQLite. Without this, the first launch on the new
 * build starts from nothing — the chosen theme snaps back to the system default and an open
 * folder looks empty. The old key is read once, imported into an empty database, then
 * removed.
 */
function readLegacy(): Partial<Persisted> | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { version?: number } & Partial<Persisted>;
    if (parsed.version !== LEGACY_VERSION || !Array.isArray(parsed.projects)) {
      return null;
    }
    return { ...parsed, projects: parsed.projects.map(sanitizeProject) };
  } catch {
    return null;
  }
}

/** Read the durable slice from the database. Called once, by `bootStorage`. */
export async function initPersistence(): Promise<void> {
  const db = getDb();
  if (!db) {
    return;
  }

  const loaded = await loadState(db);
  const legacy = (loaded.projects?.length ?? 0) === 0 ? readLegacy() : null;

  if (legacy) {
    // Import once, into an empty database. If the write fails the old key stays put, so the
    // next launch tries again rather than losing the only copy.
    await serialized(() => saveState(db, seedState(legacy)));
    cached = legacy;
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Storage disabled mid-session; the import already happened.
    }
    return;
  }

  cached = { ...loaded, projects: (loaded.projects ?? []).map(sanitizeProject) };
}

/** The saved slice, or `null` when there is nothing to restore. */
export function loadPersisted(): Partial<Persisted> | null {
  return cached;
}

/**
 * Write the slice, debounced by the caller.
 *
 * Writes are queued so two saves can never interleave their transactions, and failures are
 * logged rather than thrown: storage is a convenience, and a keystroke must not fail because
 * a disk did.
 *
 * The workspace's plan is mirrored to `.openlab/plan/` after the same debounce, so a wave or
 * a task a lab commits lands in the repository with the work it belongs to. The mirror is a
 * consequence of the record, never the other way round: the database is the truth here, and
 * the files are read back only when somebody else changed them (see `lib/plan/files.ts`).
 */
export function savePersisted(state: AppState): void {
  const db = getDb();
  if (db) {
    void serialized(() => saveState(db, state))
      .then(() => clearStorageIssue('write'))
      .catch((error) => {
        void logError('storage', error);
        console.error('openlab could not write to its database', error);
        reportStorageIssue('write', error);
      });
  }

  const root = activeProject(state)?.path;
  if (!root) return;
  void writePlan(root, {
    waves: state.waves,
    tasks: state.tasks,
    members: state.members,
    jobs: state.jobs,
  }).catch((error) => {
    console.error('openlab could not write its plan to the workspace', error);
  });
}
