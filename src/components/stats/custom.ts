/**
 * The workspace's own procedures, live.
 *
 * A procedure a lab writes is the lab's, not the app's, so it lives in the workspace the way
 * figures and the plan do: `.openlab/statistics/<id>/procedure.yaml` + `procedure.py`, read
 * when a folder opens and written when one is saved. `createMirror` gives the folder the same
 * two guarantees every mirrored record has — a colleague's commit is never overwritten before
 * it is read, and openlab's own output is never re-imported as an edit.
 *
 * Running is a process, not a computation: the payload is written beside the run, `python3`
 * is asked to execute the folder's script, and the JSON it prints is read back. It runs where
 * the app's Execution setting says, which is a sandbox unless the reader changed it.
 */

import { useSyncExternalStore } from 'react';

import { invokeCommand, isDesktop } from '@/lib/ipc';
import { createMirror } from '@/lib/workspace/mirror';
import { quote } from '@/lib/compute/adapters';
import { executionPayload, type ExecutionSettings } from '@/lib/execution';
import {
  CODE_FILE,
  MANIFEST_FILE,
  parseManifest,
  readScriptOutput,
  STATISTICS_DIR,
  type ProcedureManifest,
} from '@/lib/science/procedures';
import type { AssumptionCheck } from '@/lib/science/stats';
import {
  columnNumbers,
  numericColumns,
  type Dataset,
  type DataPlan,
  toParsedData,
} from '@/lib/science/dataset';

/** One procedure read from disk, valid or not. */
export interface CustomProcedure {
  /** The manifest id, or the folder name when the manifest could not be read. */
  id: string;
  /** The folder, relative to the workspace. */
  dir: string;
  yaml: string;
  python: string;
  /** The manifest when it validated. */
  manifest?: ProcedureManifest;
  /** Why it did not validate, shown where the procedure would be. */
  errors: string[];
}

/** The folder the store is pointed at, or `null` when no workspace is open. */
const mirror = createMirror({ id: 'statistics', pattern: `${STATISTICS_DIR}/*/*` });

let procedures: CustomProcedure[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The folder's own explanation, so a reader arriving by git knows what a file is. */
const README = `${STATISTICS_DIR}/README.md`;

const README_BODY = `# Statistics procedures

Each folder here is one procedure: \`procedure.yaml\` declares it and \`procedure.py\` computes
it. openlab reads them when a workspace opens and runs them through the app's execution
setting, so the code travels with the analysis it produced.

The YAML is the contract — parameters, outputs and the shape of the data. The Python is
called with one argument, a JSON payload holding \`{ data, params }\`, and prints one JSON
object: \`{ values, summary, assumptions }\`. Values that are not declared in \`outputs\` are
not shown.

\`\`\`
.openlab/statistics/bootstrap-diff/
  procedure.yaml
  procedure.py
\`\`\`

Copy a folder that already works and change it. There is no build step.
`;

/** Read every procedure in a workspace. */
export async function loadWorkspaceStatistics(root: string): Promise<{ read: number; problems: string[] }> {
  if (!isDesktop() || !root) {
    procedures = [];
    emit();
    return { read: 0, problems: [] };
  }

  const found = await mirror.read(root);
  const folders = new Map<string, { yaml?: string; python?: string }>();
  for (const [path, text] of found.files) {
    const parts = path.split('/');
    const dir = parts.slice(0, -1).join('/');
    const entry = folders.get(dir) ?? {};
    if (parts[parts.length - 1] === MANIFEST_FILE) entry.yaml = text;
    if (parts[parts.length - 1] === CODE_FILE) entry.python = text;
    folders.set(dir, entry);
  }

  const next: CustomProcedure[] = [];
  for (const [dir, entry] of folders) {
    if (!entry.yaml) continue;
    const read = parseManifest(entry.yaml, { dir, python: entry.python });
    const folder = dir.split('/').pop() ?? dir;
    if (read.ok) {
      next.push({
        id: read.manifest.id,
        dir,
        yaml: entry.yaml,
        python: entry.python ?? '',
        manifest: read.manifest,
        errors: [],
      });
    } else {
      next.push({ id: folder, dir, yaml: entry.yaml, python: entry.python ?? '', errors: read.errors });
    }
  }

  procedures = next.sort((a, b) => a.id.localeCompare(b.id));
  mirror.ready(root);
  emit();
  return { read: procedures.length, problems: found.problems };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every valid procedure in this workspace. */
export function customProcedures(): CustomProcedure[] {
  return procedures;
}

/** The same list, as a component reads it. */
export function useCustomProcedures(): CustomProcedure[] {
  return useSyncExternalStore(subscribe, customProcedures);
}

/** The procedures that failed validation, so the page can say so rather than hide them. */
export function brokenProcedures(): CustomProcedure[] {
  return procedures.filter((procedure) => !procedure.manifest);
}

function allFiles(): Map<string, string> {
  const files = new Map<string, string>([[README, `${README_BODY}\n`]]);
  for (const procedure of procedures) {
    files.set(`${procedure.dir}/${MANIFEST_FILE}`, procedure.yaml.trimEnd() + '\n');
    files.set(`${procedure.dir}/${CODE_FILE}`, procedure.python.trimEnd() + '\n');
  }
  return files;
}

/** Save one procedure, replacing the folder it came from when the id changed. */
export async function saveCustomProcedure(input: {
  root: string;
  yaml: string;
  python: string;
  /** The folder this edit started from, so a rename moves instead of duplicating. */
  previous?: CustomProcedure;
}): Promise<{ ok: true; procedure: CustomProcedure } | { ok: false; errors: string[] }> {
  const read = parseManifest(input.yaml, { dir: 'pending', python: input.python });
  if (!read.ok) {
    return { ok: false, errors: read.errors };
  }
  const dir = `${STATISTICS_DIR}/${read.manifest.id}`;
  const procedure: CustomProcedure = {
    id: read.manifest.id,
    dir,
    yaml: input.yaml,
    python: input.python,
    manifest: { ...read.manifest, dir },
    errors: [],
  };

  // The folder is replaced even when the id changed: the old path is an orphan on write.
  const previous = input.previous;
  procedures = [
    ...procedures.filter((entry) => entry.id !== procedure.id && entry.id !== previous?.id),
    procedure,
  ].sort((a, b) => a.id.localeCompare(b.id));
  emit();

  if (isDesktop() && input.root) {
    mirror.ready(input.root);
    await mirror.write(input.root, allFiles());
    // A rename is a move: the folder the edit started from is removed explicitly, because
    // the mirror only removes paths it wrote itself and this one may have come from git.
    if (previous && previous.dir !== dir) {
      await removeProcedureFiles(input.root, previous.dir);
    }
  }
  return { ok: true, procedure };
}

/** Remove a procedure's two files from disk, leaving the folder empty. */
async function removeProcedureFiles(root: string, dir: string): Promise<void> {
  for (const file of [MANIFEST_FILE, CODE_FILE]) {
    await invokeCommand('remove_file', { path: `${dir}/${file}`, root });
  }
}

/** Remove a procedure and its two files. */
export async function removeCustomProcedure(workspace: string, id: string): Promise<void> {
  const removed = procedures.find((entry) => entry.id === id);
  procedures = procedures.filter((entry) => entry.id !== id);
  emit();
  if (!isDesktop() || !workspace) return;
  mirror.ready(workspace);
  if (removed) await removeProcedureFiles(workspace, removed.dir);
  await mirror.write(workspace, allFiles());
}

/* ================================================================================================
 * Running
 * ============================================================================================== */

/** Where a run's payload is written: two levels deep, so the procedure folder stays clean. */
export function payloadPath(id: string): string {
  return `.openlab/.runs/statistics-${id}.json`;
}

/** The numbers a script is given, in shapes a Python author can read without guessing. */
export function runPayload(
  procedure: ProcedureManifest,
  dataset: Dataset,
  plan: DataPlan,
  params: Record<string, string | number | boolean>,
): Record<string, unknown> {
  const data = toParsedData(dataset, plan);
  const numbers = numericColumns(dataset);
  return {
    procedure: procedure.id,
    params,
    data: {
      shape: procedure.data.shape,
      columns: dataset.columns.map((column) => ({ name: column.name, key: column.key, type: column.type })),
      rows: dataset.rows,
      blocks: data.blocks,
      // Two series only when the procedure asked for pairs; a group procedure gets blocks.
      pairs:
        procedure.data.shape === 'pairs'
          ? [columnNumbers(dataset, plan.roles.x), columnNumbers(dataset, plan.roles.y)]
          : [],
      matrix: data.matrix,
      p_values: data.pEntries,
      labels: data.labels.length > 0 ? data.labels : numbers.map((column) => column.name),
    },
  };
}

/** What a run produced. */
export interface CustomRun {
  ok: boolean;
  values: Record<string, unknown>;
  summary?: string;
  assumptions: AssumptionCheck[];
  /** Everything the process wrote, kept for the error state. */
  output: string;
  code: { r?: string; python: string };
}

/** Run one procedure through `python3` in the workspace. */
export async function runCustomProcedure(input: {
  procedure: ProcedureManifest;
  dataset: Dataset;
  plan: DataPlan;
  params: Record<string, string | number | boolean>;
  root: string;
  execution: ExecutionSettings;
}): Promise<CustomRun> {
  const { procedure, root } = input;
  const script = procedure.python ?? '';
  const code = { r: procedure.r, python: script };

  if (!isDesktop()) {
    return {
      ok: false,
      values: {},
      assumptions: [],
      output: 'A custom procedure needs the desktop app: it runs Python on this machine.',
      code,
    };
  }
  if (!procedure.dir) {
    return { ok: false, values: {}, assumptions: [], output: 'The procedure has no folder.', code };
  }

  const payload = payloadPath(procedure.id);
  const written = await invokeCommand('write_file', {
    path: payload,
    contents: JSON.stringify(runPayload(procedure, input.dataset, input.plan, input.params)),
    root,
  });
  if (!written.ok) {
    return { ok: false, values: {}, assumptions: [], output: written.error.message, code };
  }

  const command = `python3 -I ${quote(`${procedure.dir}/${CODE_FILE}`)} ${quote(payload)}`;
  const result = await invokeCommand<{ output: string; exitCode: number }>('run_command', {
    command,
    cwd: null,
    root,
    execution: executionPayload(input.execution),
    timeoutSecs: 180,
  });

  if (!result.ok) {
    return { ok: false, values: {}, assumptions: [], output: result.error.message, code };
  }

  const output = result.value.output;
  const exitCode = result.value.exitCode;
  const read = readScriptOutput(output);

  if (!read) {
    const missingPython =
      /command not found|not found|No such file/i.test(output) && /python3/i.test(command);
    return {
      ok: false,
      values: {},
      assumptions: [],
      output: missingPython ? `This machine has no python3 to run ${procedure.id}.\n\n${output}` : output,
      code,
    };
  }

  return {
    ok: exitCode === 0 || read.values !== undefined,
    values: read.values,
    summary: read.summary,
    assumptions: read.assumptions ?? [],
    output,
    code,
  };
}
