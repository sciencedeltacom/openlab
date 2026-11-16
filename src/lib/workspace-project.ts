/**
 * Project structure.
 *
 * A research folder has a shape worth agreeing on before the first file: inputs apart from
 * outputs, code apart from results, and a place for the assumptions and the run log. This
 * is the layout openlab offers when a folder is empty, and it is data so the offer and the
 * writer cannot drift.
 */

import { invokeCommand } from '@/lib/ipc';

/** One folder in the structure, with the line that explains it. */
export interface ProjectFolder {
  dir: string;
  description: string;
}

/** The folders a scaffolded project gets, in the order the tree reads. */
export const PROJECT_FOLDERS: readonly ProjectFolder[] = [
  { dir: 'data', description: 'original inputs' },
  { dir: 'scripts', description: 'analysis code' },
  { dir: 'results', description: 'figures, tables, and reports' },
  { dir: 'methods', description: 'protocols and assumptions' },
  { dir: 'config', description: 'parameters, environment, and model settings' },
  { dir: 'tests', description: 'data verification and code unit tests' },
  { dir: 'logs', description: 'execution runs and agent audit trails' },
];

/** The two files at the root of the structure. */
export const PROJECT_FILES: readonly ProjectFolder[] = [
  { dir: 'AGENTS.md', description: 'project instructions' },
  { dir: 'README.md', description: 'project documentation and overview' },
];

/** True when a folder holds nothing but the finder's own droppings. */
export async function folderIsEmpty(root: string): Promise<boolean> {
  const listed = await invokeCommand<{ name: string }[]>('list_dir', { path: root, root });
  if (!listed.ok) {
    return false;
  }
  return listed.value.every((entry) => entry.name === '.DS_Store');
}

/** Write a file inside the workspace, quietly ignoring a failure. */
async function write(root: string, path: string, contents: string): Promise<void> {
  await invokeCommand('write_file', { path, contents, root });
}

/** Lay out the standard structure in a fresh folder. */
export async function scaffoldProject(root: string, name: string): Promise<void> {
  for (const [path, contents] of scaffoldFiles(name)) {
    await write(root, path, contents);
  }
}

/**
 * The files a scaffolded project is made of, as paths and contents.
 *
 * Pure, and the single description of the structure: the app writes these through the Rust
 * file commands and the CLI writes them through the filesystem, so the two cannot drift.
 */
export function scaffoldFiles(name: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const { dir, description } of PROJECT_FOLDERS) {
    // A `.gitkeep` gives an otherwise empty folder a reason to exist in version control.
    files.set(`${dir}/.gitkeep`, '');
    files.set(`${dir}/README.md`, `# ${dir}\n\n${description}.\n`);
  }
  files.set('AGENTS.md', agentsFile(name));
  files.set('README.md', readmeFile(name));
  return files;
}

/** The project instructions the agent reads first. */
function agentsFile(name: string): string {
  const folders = PROJECT_FOLDERS.map(({ dir, description }) => `- \`${dir}/\`: ${description}`).join('\n');
  return [
    `# ${name}: project instructions`,
    '',
    'This repository follows the openlab project structure:',
    '',
    folders,
    '',
    '## Conventions',
    '',
    '- Keep original inputs under `data/`; never edit them in place.',
    '- Write analysis code under `scripts/` and its checks under `tests/`.',
    '- Send every generated figure, table and report to `results/`.',
    '- Record protocols and assumptions under `methods/`, parameters under `config/`.',
    '- Let tools append their runs to `logs/` rather than to a transcript.',
    '',
  ].join('\n');
}

/** The project overview a reader meets first. */
function readmeFile(name: string): string {
  const tree = [...PROJECT_FOLDERS, ...PROJECT_FILES]
    .map(({ dir, description }) => `  ${dir.padEnd(11)} ${description}`)
    .join('\n');
  return [
    `# ${name}`,
    '',
    'A research project laid out by openlab.',
    '',
    '```',
    `${name}/`,
    tree,
    '```',
    '',
  ].join('\n');
}
