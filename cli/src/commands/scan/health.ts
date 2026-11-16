/**
 * The scan engine's side of the workbench, checked honestly.
 *
 * The engine is a bundled Python worker plus an embedding server, and the app installs and
 * supervises it. A terminal process cannot — the worker is started by Rust, holds an index in
 * the app's data directory, and is torn down with the app — so this reports what is on disk
 * and where the index lives, and names the app for anything that needs the worker running.
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { appRoot, dataDir } from '../../lib/paths';

/** What a check found. */
interface Check {
  name: string;
  state: 'ok' | 'missing' | 'warn';
  detail: string;
}

/** A size in the words a person reads. */
function size(path: string): string {
  try {
    const stats = statSync(path);
    return stats.isDirectory() ? 'directory' : `${Math.round(stats.size / 1024)} kB`;
  } catch {
    return 'unreadable';
  }
}

/** Everything the worker needs on disk, as the app's engine module lays it out. */
function checks(indexRoot: string): Check[] {
  const resources = join(appRoot(), 'src-tauri', 'resources');
  const worker = join(resources, 'worker');
  const python = join(resources, 'python');
  const llama = join(resources, 'bin', 'llama-server');
  const index = join(dataDir(), 'vectors');

  return [
    {
      name: 'worker',
      state: existsSync(worker) ? 'ok' : 'missing',
      detail: existsSync(worker) ? `${worker} (${size(worker)})` : `${worker}: the Python scan pipeline`,
    },
    {
      name: 'python',
      state: existsSync(python) ? 'ok' : 'warn',
      detail: existsSync(python)
        ? `${python} (${size(python)})`
        : 'no bundled interpreter; the app installs one on demand (`openlab scan install` is an app action)',
    },
    {
      name: 'embeddings',
      state: existsSync(llama) ? 'ok' : 'warn',
      detail: existsSync(llama) ? `${llama} (${size(llama)})` : `${llama}: the local embedding server`,
    },
    {
      name: 'index root',
      state: indexRoot ? 'ok' : 'warn',
      detail: indexRoot ? indexRoot : 'not set; the app defaults to the workspace root',
    },
    {
      name: 'vector index',
      state: existsSync(index) ? 'ok' : 'warn',
      detail: existsSync(index)
        ? `${index} (${size(index)})`
        : `${index}: written by the app when it indexes`,
    },
  ];
}

export default class ScanHealth extends LabCommand {
  static description = 'Report what the document scan engine has on disk';

  async run(): Promise<void> {
    const lab = await this.lab({ root: null });
    const indexRoot = lab.state.indexRoot;
    const found = checks(indexRoot);
    const value = { indexRoot, checks: found, ready: found.every((check) => check.state === 'ok') };

    this.emit(value, () => {
      const lines = [
        out.heading('Scan engine'),
        out.bullets(
          found.map(
            (check) =>
              `${check.state === 'ok' ? out.mark.ok : check.state === 'warn' ? out.mark.warn : out.mark.bad} ${check.name.padEnd(12)} ${out.c.grey(check.detail)}`,
          ),
        ),
      ];
      if (!value.ready) {
        lines.push(
          '',
          out.note(
            'Scanning, indexing and library search run in the app: the worker is started by the desktop shell and its index is held open there.',
          ),
          out.note('Run `openlab scan status` for where the index would live.'),
        );
      }
      return lines.join('\n');
    });
  }
}
