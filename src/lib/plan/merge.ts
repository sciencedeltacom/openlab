/**
 * Reconciling the plan files with the store.
 *
 * The files are written by openlab, so the usual case is that they agree with the store and
 * this does nothing. The interesting case is a file somebody else changed — a colleague's
 * commit, or an edit in an editor — and that is what this decides: which fields a file is
 * allowed to set, and what happens when it names something the workspace does not have.
 *
 * The rules, in full:
 *
 * - A wave file is matched by its `id`, or by its number when it carries no id (someone
 *   wrote a new wave by hand). A file that matches neither creates a wave.
 * - A wave file sets its name, dates and goal. Those are the plan.
 * - An item line sets the title, status, kind, priority and owner of the task it names.
 * - An item that names a key the workspace does not have is reported, not created: a
 *   markdown line is not enough to invent a task, and inventing one would silently grow the
 *   tracker from a typo.
 * - Everything a file does not mention is left alone, so a file that lists four fields
 *   cannot erase the fifth.
 */

import { newWave, type Member, type Task, type Wave } from '@/store/research';
import { memberHandle, type PlannedWave, type TaskLine } from './format';

/** A wave that has to be created, and the file it came from. */
export interface WaveCreation {
  wave: Wave;
  path: string;
}

/** A wave that exists and needs some of its plan fields set. */
export interface WaveEdit {
  id: string;
  patch: Partial<Wave>;
}

/** A task that exists and needs some of its plan fields set. */
export interface TaskEdit {
  id: string;
  key: string;
  patch: Partial<Task>;
}

/** What a read of the plan files asks the store to do. */
export interface PlanMerge {
  created: WaveCreation[];
  waves: WaveEdit[];
  tasks: TaskEdit[];
  /** Item lines naming a key the workspace does not have, with the file they were in. */
  unknown: { key: string; path: string }[];
}

/** The plan fields a wave file owns. */
function wavePatch(wave: Wave, file: PlannedWave): Partial<Wave> {
  const patch: Partial<Wave> = {};
  if (file.name && file.name !== wave.name) patch.name = file.name;
  if (file.start && file.start !== wave.startDate) patch.startDate = file.start;
  if (file.end && file.end !== wave.endDate) patch.endDate = file.end;
  if (file.goal && file.goal !== wave.goal) patch.goal = file.goal;
  return patch;
}

/** The plan fields an item line owns. */
function taskPatch(task: Task, line: TaskLine, owner: string | null, waveId: string | null): Partial<Task> {
  const patch: Partial<Task> = {};
  if (line.title && line.title !== task.title) patch.title = line.title;
  if (line.status !== task.status) patch.status = line.status;
  if (line.kind !== task.kind) patch.kind = line.kind;
  if (line.priority !== task.priority) patch.priority = line.priority;
  if (owner !== task.assigneeId) patch.assigneeId = owner;
  if (waveId !== task.waveId) patch.waveId = waveId;
  return patch;
}

/**
 * The member an item's owner field refers to, or `null` when nobody here answers to it.
 *
 * Three ways in, because three kinds of writer exist: openlab writes a handle, a person
 * types a name, and a script may carry an id. An owner nobody matches leaves the task
 * unowned rather than failing the import.
 */
function memberFor(owner: string | null, members: readonly Member[]): string | null {
  if (!owner) return null;
  const wanted = owner.trim().toLowerCase();
  return (
    members.find((member) => member.id.toLowerCase() === wanted)?.id ??
    members.find((member) => memberHandle(member) === wanted)?.id ??
    members.find((member) => member.name.toLowerCase() === wanted)?.id ??
    null
  );
}

/**
 * Work out what the files are asking for.
 *
 * `waves` is every wave file read, `backlog` the backlog's items; `store` is the workspace
 * as it stands. A wave file's items are assigned to that wave, which is what makes the file
 * the place a task's membership is decided.
 */
export function planMerge(input: {
  files: readonly PlannedWave[];
  backlog: readonly TaskLine[];
  waves: readonly Wave[];
  tasks: readonly Task[];
  members: readonly Member[];
}): PlanMerge {
  const merge: PlanMerge = { created: [], waves: [], tasks: [], unknown: [] };
  const byKey = new Map(input.tasks.map((task) => [task.key.toLowerCase(), task]));
  const patched = new Set<string>();

  /** Apply one file's items to the tasks they name. */
  const applyItems = (items: readonly TaskLine[], path: string, waveId: string | null) => {
    for (const line of items) {
      const task = byKey.get(line.key.toLowerCase());
      if (!task) {
        merge.unknown.push({ key: line.key, path });
        continue;
      }
      const patch = taskPatch(task, line, memberFor(line.assignee, input.members), waveId);
      if (Object.keys(patch).length === 0) continue;
      merge.tasks.push({ id: task.id, key: task.key, patch });
      patched.add(task.id);
    }
  };

  for (const file of input.files) {
    const existing =
      (file.id ? input.waves.find((wave) => wave.id === file.id) : undefined) ??
      input.waves.find((wave) => wave.number === file.number);

    if (!existing) {
      const fresh = newWave(input.waves);
      const wave: Wave = {
        ...fresh,
        number: file.number,
        name: file.name || `Wave ${file.number}`,
        // A file with no dates still has to land somewhere sensible; a wave is a stretch.
        startDate: file.start || fresh.startDate,
        endDate: file.end || fresh.endDate,
        goal: file.goal,
      };
      merge.created.push({ wave, path: file.path });
      applyItems(file.items, file.path, wave.id);
      continue;
    }

    const patch = wavePatch(existing, file);
    if (Object.keys(patch).length > 0) merge.waves.push({ id: existing.id, patch });
    applyItems(file.items, file.path, existing.id);
  }

  // The backlog owns "in no wave": a task listed there leaves whatever wave it was in.
  applyItems(input.backlog, 'backlog.md', null);

  return merge;
}

/** True when a merge asks for nothing — the usual case, and worth answering cheaply. */
export function mergeIsEmpty(merge: PlanMerge): boolean {
  return (
    merge.created.length === 0 &&
    merge.waves.length === 0 &&
    merge.tasks.length === 0 &&
    merge.unknown.length === 0
  );
}
