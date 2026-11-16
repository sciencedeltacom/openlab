/**
 * The lab folder.
 *
 * A workspace is a folder with a shape: `.labconfig` says what it is, `openwiki/` is what the
 * agent reads, `.openlab/plan/` is the plan as files, and `.openlab/figures/` holds the figures
 * as documents. The app writes all of it through Rust; the CLI writes it through the filesystem
 * with the app's own renderers, so the same folder is produced either way and a file written
 * here is a file the app opens.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIGURE_DIR, figureFiles } from '@/components/figures/store';
import type { Figure } from '@/components/figures/types';
import { starterPages } from '@/lib/knowledge/init';
import {
  PLAN_BACKLOG,
  PLAN_DIR,
  PLAN_WAVE_DIR,
  readBacklogFile,
  readWaveFile,
  type PlannedWave,
  type TaskLine,
} from '@/lib/plan/format';
import { planFiles } from '@/lib/plan/files';
import type { Job } from '@/store/compute';
import type { Member, Task, Wave } from '@/store/research';
import { LAB_CONFIG_PATH, PROTOCOL_PRESETS, labConfigYaml, type LabConfig } from '@/lib/workspace-config';
import { PROJECT_FOLDERS, PROJECT_FILES, scaffoldFiles } from '@/lib/workspace-project';

import { listDir, readLines, scopedWrite } from './host/fs';

/** Write a workspace file, proving first that it stays inside the folder. */
function put(root: string, path: string, contents: string): string {
  Bun.write(scopedWrite(path, root), contents);
  return path;
}

/* ================================================================================================
 * The manifest
 * ============================================================================================== */

/** Read `.labconfig`, filling in what an older file may not carry. */
export function readLabConfig(root: string): LabConfig | null {
  const path = join(root, LAB_CONFIG_PATH);
  if (!existsSync(path)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const file = parsed as Partial<LabConfig> & { created?: string };
  return {
    version: typeof file.version === 'number' ? file.version : 1,
    name: typeof file.name === 'string' ? file.name : (root.split('/').filter(Boolean).pop() ?? 'lab'),
    icon: typeof file.icon === 'string' ? file.icon : 'atom',
    createdAt: file.createdAt ?? file.created ?? new Date().toISOString(),
    protocols: Array.isArray(file.protocols) ? file.protocols : [],
    methods: Array.isArray(file.methods) ? file.methods : [],
    settings: {
      structure: file.settings?.structure ?? true,
      wiki: file.settings?.wiki ?? true,
      defaultModel: file.settings?.defaultModel ?? '',
    },
  };
}

/** Write the manifest, in the app's own YAML. */
export function writeLabConfig(root: string, config: LabConfig): void {
  put(root, LAB_CONFIG_PATH, labConfigYaml(config));
}

/** A manifest for a folder that has none yet. */
export function defaultLabConfig(name: string, options: Partial<LabConfig> = {}): LabConfig {
  return {
    version: 1,
    name,
    icon: options.icon ?? 'atom',
    createdAt: new Date().toISOString(),
    protocols: options.protocols ?? [...PROTOCOL_PRESETS].slice(0, 3),
    methods: options.methods ?? [],
    settings: options.settings ?? { structure: true, wiki: true, defaultModel: '' },
  };
}

/* ================================================================================================
 * The structure
 * ============================================================================================== */

/**
 * Write a set of lab files, keeping anything already there.
 *
 * A folder is not empty just because openlab is new to it: a scaffold that overwrote a README
 * someone wrote would be the worst kind of convenience. `overwrite` is for the commands that
 * mean it (a plan export, a figure save).
 */
export function writeLabFiles(
  root: string,
  files: Map<string, string>,
  options: { overwrite?: boolean } = {},
): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [path, contents] of files) {
    if (!options.overwrite && existsSync(join(root, path))) {
      skipped.push(path);
      continue;
    }
    written.push(put(root, path, contents));
  }
  return { written, skipped };
}

/** Which parts of the standard structure a folder has. */
export function structure(root: string): { dir: string; description: string; present: boolean }[] {
  return [...PROJECT_FOLDERS, ...PROJECT_FILES].map(({ dir, description }) => ({
    dir,
    description,
    present: existsSync(join(root, dir)),
  }));
}

/* ================================================================================================
 * The plan, as files
 * ============================================================================================== */

/** What a plan read found on disk. */
export interface PlanRead {
  waves: PlannedWave[];
  backlog: TaskLine[];
  problems: string[];
  /** Every plan file the folder holds, relative to the root. */
  files: string[];
}

/** Write the plan into `.openlab/plan/`, returning the paths written. */
export function writePlan(
  root: string,
  source: {
    waves: readonly Wave[];
    tasks: readonly Task[];
    members: readonly Member[];
    jobs: readonly Job[];
  },
): string[] {
  return [...planFiles(source, new Date().toISOString())].map(([path, contents]) =>
    put(root, path, contents),
  );
}

/** Read the plan back from disk. */
export function readPlan(root: string): PlanRead {
  const plan: PlanRead = { waves: [], backlog: [], problems: [], files: [] };
  const dir = join(root, PLAN_DIR);
  if (!existsSync(dir)) {
    return plan;
  }
  const files = listDir(dir, root).flatMap((entry) =>
    entry.isDir
      ? entry.name === 'waves'
        ? listDir(entry.path, root).filter((inner) => !inner.isDir)
        : []
      : [entry],
  );

  for (const file of files) {
    if (!file.name.endsWith('.md')) continue;
    const relative = file.path.slice(root.length + 1);
    plan.files.push(relative);
    const text = readLines(file.path)?.join('\n') ?? '';
    if (relative === PLAN_BACKLOG) {
      plan.backlog.push(...readBacklogFile(text));
      continue;
    }
    if (!relative.startsWith(`${PLAN_WAVE_DIR}/`)) continue;
    const wave = readWaveFile(relative, text);
    if (wave) plan.waves.push(wave);
    else plan.problems.push(`${relative}: no readable front matter`);
  }
  return plan;
}

/* ================================================================================================
 * The figures, as documents
 * ============================================================================================== */

/** One figure document that failed to parse. */
export interface FigureProblem {
  path: string;
  problem: string;
}

/** Read `.openlab/figures/*.json`. */
export function readFigures(root: string): { figures: Figure[]; problems: FigureProblem[] } {
  const dir = join(root, FIGURE_DIR);
  const figures: Figure[] = [];
  const problems: FigureProblem[] = [];
  if (!existsSync(dir)) {
    return { figures, problems };
  }
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    const path = `${FIGURE_DIR}/${entry}`;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, entry), 'utf8')) as Figure;
      if (typeof parsed?.id !== 'string' || typeof parsed?.caption !== 'string') {
        problems.push({ path, problem: 'not a figure document' });
        continue;
      }
      figures.push(parsed);
    } catch (error) {
      problems.push({ path, problem: error instanceof Error ? error.message : 'unreadable' });
    }
  }
  return { figures, problems };
}

/** Write the figures folder: one document per figure, plus the README that explains it. */
export function writeFigures(root: string, figures: readonly Figure[]): string[] {
  return [...figureFiles(figures)].map(([path, contents]) => put(root, path, contents));
}
