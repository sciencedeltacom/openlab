/**
 * The plan on disk.
 *
 * The plan is one folder the mirror writes: `.openlab/plan/`, holding a file per wave and the
 * backlog. The safety rules — a file is imported only when it differs from what openlab last
 * wrote, and writing waits for reading — live in {@link createMirror}, and this module is
 * what the plan looks like as files.
 */

import { createMirror } from '@/lib/workspace/mirror';

// The rules the mirror applies are checked in `scripts/verify-plan.ts`, through these.
export { alreadyWritten, fingerprint, isForeign, orphanedPaths } from '@/lib/workspace/mirror';
import type { Job } from '@/store/compute';
import type { Member, Task, Wave } from '@/store/research';
import {
  PLAN_BACKLOG,
  PLAN_DIR,
  PLAN_README,
  PLAN_WAVE_DIR,
  jobsOfWave,
  memberHandle,
  readBacklogFile,
  readWaveFile,
  renderBacklogFile,
  renderPlanReadme,
  renderWaveFile,
  wavePath,
  type PlannedWave,
  type TaskLine,
} from './format';

/** The workspace root, as the app's records see it. */
export interface PlanSource {
  waves: readonly Wave[];
  tasks: readonly Task[];
  members: readonly Member[];
  jobs: readonly Job[];
}

/** The folder of plan files, and the memory of what was written into it. */
const mirror = createMirror({ id: 'plan', pattern: `${PLAN_DIR}/**/*.md` });

/** The plan as the files it should be. Pure: no disk, no store. */
export function planFiles(source: PlanSource, at: string): Map<string, string> {
  const handleOf = (id: string) => {
    const member = source.members.find((candidate) => candidate.id === id);
    return member ? memberHandle(member) : undefined;
  };
  const files = new Map<string, string>();

  files.set(PLAN_README, renderPlanReadme(at));
  files.set(
    PLAN_BACKLOG,
    renderBacklogFile({
      tasks: source.tasks.filter((task) => !task.waveId),
      handleOf,
      at,
    }),
  );

  for (const wave of source.waves) {
    const tasks = source.tasks.filter((task) => task.waveId === wave.id);
    files.set(
      wavePath(wave),
      renderWaveFile({
        wave,
        tasks,
        jobs: jobsOfWave(source.jobs, tasks),
        handleOf,
        at,
      }),
    );
  }

  return files;
}

/** Every plan file the workspace holds, with the waves and backlog read out of them. */
export interface PlanRead {
  waves: PlannedWave[];
  backlog: TaskLine[];
  /** Paths whose content differs from what openlab last wrote. */
  foreign: string[];
  problems: string[];
}

/**
 * Read the plan from disk, without touching the store.
 *
 * `foreign` is the list of files that changed since openlab wrote them — a colleague's
 * commit, or an edit in an editor — and it is the only part of the read a caller has to act
 * on.
 */
export async function readPlan(root: string): Promise<PlanRead | null> {
  const read = await mirror.read(root);
  if (!read.files.size && read.problems.length > 0) return null;

  const plan: PlanRead = { waves: [], backlog: [], foreign: read.foreign, problems: read.problems };
  for (const [path, text] of read.files) {
    if (path.endsWith('/backlog.md') || path === PLAN_BACKLOG) {
      plan.backlog.push(...readBacklogFile(text));
      continue;
    }
    if (!path.startsWith(`${PLAN_WAVE_DIR}/`)) continue;

    const wave = readWaveFile(path, text);
    if (!wave) {
      plan.problems.push(`${path}: no readable front matter`);
      continue;
    }
    plan.waves.push(wave);
  }
  return plan;
}

/**
 * Write the plan, and remove the files of waves that are gone.
 *
 * Returns the paths written, which is empty when nothing changed.
 */
export function writePlan(root: string, source: PlanSource): Promise<string[]> {
  return mirror.write(root, planFiles(source, new Date().toISOString()));
}

/** Mark a root's plan as read, so export may begin. Called by the importer. */
export function planWasRead(root: string): void {
  mirror.ready(root);
}
