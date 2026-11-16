/**
 * A starting OpenWiki.
 *
 * OpenWiki keeps a linked Markdown wiki under `openwiki/`. A fresh workspace has none, so
 * when a folder is opened openlab lays down a small, honest starter — an index, a
 * quickstart and the folder layout — that the Knowledge graph can show and the agent can
 * grow. It never overwrites an existing wiki.
 */

import { invokeCommand } from '@/lib/ipc';
import { PROJECT_FOLDERS } from '@/lib/workspace-project';

/** Starter pages, keyed by their path within the workspace. */
export function starterPages(name: string): Record<string, string> {
  const layout = PROJECT_FOLDERS.map(({ dir, description }) => `| \`${dir}/\` | ${description} |`).join('\n');

  return {
    'openwiki/index.md': [
      '---',
      `title: ${name}`,
      '---',
      '',
      `# ${name}`,
      '',
      `This wiki is the living documentation for **${name}**. It is kept in the repository`,
      'under `openwiki/` and read by the agent as context.',
      '',
      '- [Quickstart](quickstart.md): where things live and how to run them.',
      '- [Architecture](architecture.md): the folder layout and what each part is for.',
      '',
    ].join('\n'),

    'openwiki/quickstart.md': [
      '# Quickstart',
      '',
      'Inputs are read from `data/`, code lives in `scripts/`, and anything produced is',
      'written to `results/`. Parameters belong in `config/`, protocols and assumptions in',
      '`methods/`, and run records in `logs/`.',
      '',
      'See [Architecture](architecture.md) for the full layout, or the [index](index.md).',
      '',
    ].join('\n'),

    'openwiki/architecture.md': [
      '# Architecture',
      '',
      'The repository follows one layout:',
      '',
      '| Folder | Purpose |',
      '| --- | --- |',
      layout,
      '',
      'Original inputs are never edited in place; a derived artefact always names the input',
      'and the code that produced it. See the [index](index.md) or [Quickstart](quickstart.md).',
      '',
    ].join('\n'),
  };
}

/**
 * Write the starter wiki if the workspace has none.
 *
 * Returns `true` when pages were created, `false` when a wiki was already there or the write
 * failed — a caller can ignore the result, because a wiki is a convenience, not a gate.
 */
export async function ensureOpenWiki(root: string, name: string): Promise<boolean> {
  const exists = await invokeCommand<boolean>('path_exists', { path: `${root}/openwiki/index.md` });
  if (!exists.ok || exists.value) {
    return false;
  }
  for (const [path, contents] of Object.entries(starterPages(name))) {
    const written = await invokeCommand('write_file', { path, contents, root });
    if (!written.ok) {
      return false;
    }
  }
  return true;
}
