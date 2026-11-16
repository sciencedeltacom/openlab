/**
 * Mirroring a record into a folder.
 *
 * Some of what openlab holds is the lab's, not the app's: the plan a workspace works to, the
 * figures it produces. Those live in the repository under `.openlab/`, where git carries
 * them, a colleague reads them without the app, and a diff says what changed. This module is
 * the one place that writes and reads such a folder, so every mirrored record inherits the
 * same two safety rules:
 *
 * - **A file is imported only when it differs from what openlab last wrote.** The last
 *   written content of each path is remembered, so openlab's own output is never re-imported
 *   as if a person had typed it, a file nobody touched is never rewritten, and a change made
 *   in the app and never exported is not overwritten on the next open — the file still
 *   matches what was last written, so the app's own record wins.
 * - **Writing waits for reading.** Putting openlab's version over a colleague's commit
 *   before anyone read it is the one unrecoverable mistake here, so a folder's mirror does
 *   not write until that folder has been read.
 *
 * The memory is keyed by workspace root, because two folders are two bodies of work.
 */

import { invokeCommand, isDesktop } from '@/lib/ipc';

/**
 * A cheap fingerprint of a file's content.
 *
 * This only ever compares openlab's own output with itself, so a collision would need two
 * different records to hash alike — and the consequence would be a skipped write, not a lost
 * one. djb2 is the right size of tool.
 */
export function fingerprint(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${(hash >>> 0).toString(36)}:${text.length}`;
}

/** True when a file does not hold what openlab last wrote there. */
export function isForeign(written: string | undefined, content: string): boolean {
  return written === undefined || written !== fingerprint(content);
}

/** True when the file on disk already holds exactly this content, so there is nothing to write. */
export function alreadyWritten(written: string | undefined, content: string): boolean {
  return written !== undefined && written === fingerprint(content);
}

/** The files openlab wrote before that the record no longer has: a deleted wave's file. */
export function orphanedPaths(
  written: Record<string, string> | undefined,
  files: Map<string, string>,
): string[] {
  return Object.keys(written ?? {}).filter((path) => !files.has(path));
}

/** What a folder's mirror reads back. */
export interface MirrorRead {
  /** Every file the mirror owns, by path, as it is on disk. */
  files: Map<string, string>;
  /** The paths that differ from what openlab last wrote — a commit, or an edit. */
  foreign: string[];
  problems: string[];
}

/** One folder of files, written by openlab and read back when somebody else changes them. */
export interface Mirror {
  /** Read every file the mirror owns. Never throws; a missing folder reads as empty. */
  read(root: string): Promise<MirrorRead>;
  /** Write the record's files, remove the ones it no longer has, and remember what was written. */
  write(root: string, files: Map<string, string>): Promise<string[]>;
  /** Mark a folder as read, so writing may begin. Called by whoever does the reading. */
  ready(root: string): void;
  /** True when a folder has been read. */
  isReady(root: string): boolean;
  /** Forget what was written, for a full reset or a test. */
  forget(root?: string): void;
}

interface Memory {
  version: 1;
  roots: Record<string, Record<string, string>>;
}

/** The memory of every mirror, as it is stored. One key, so a reset is one write. */
const MEMORY_KEY = 'openlab.mirrors.v1';

function readMemory(): Memory {
  try {
    if (typeof localStorage === 'undefined') return { version: 1, roots: {} };
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return { version: 1, roots: {} };
    const parsed = JSON.parse(raw) as Memory;
    return parsed.version === 1 && parsed.roots ? parsed : { version: 1, roots: {} };
  } catch {
    return { version: 1, roots: {} };
  }
}

let memory: Memory = readMemory();

function writeMemory(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Storage full or disabled: the next open re-imports what is on disk, which is harmless.
  }
}

/** The roots each mirror has read this session. */
const readRoots = new Set<string>();

/** The key a mirror's memory is filed under. */
function memoryKey(id: string, root: string): string {
  return `${id}\u0000${root}`;
}

/**
 * Make a mirror for one folder of files.
 *
 * `id` names the mirror in the shared memory; `pattern` is the glob that finds its files.
 */
export function createMirror(options: { id: string; pattern: string }): Mirror {
  const written = (root: string): Record<string, string> => memory.roots[memoryKey(options.id, root)] ?? {};

  /** Writes are queued, so two saves can never interleave their file operations. */
  let queue: Promise<unknown> = Promise.resolve();

  return {
    async read(root: string): Promise<MirrorRead> {
      const found: MirrorRead = { files: new Map(), foreign: [], problems: [] };
      if (!isDesktop() || !root) return found;

      const listed = await invokeCommand<string[]>('glob_files', { pattern: options.pattern, root });
      if (!listed.ok) {
        found.problems.push(listed.error.message);
        return found;
      }

      const remembered = written(root);
      for (const path of listed.value.sort()) {
        const file = await invokeCommand<string>('read_file', { path, root });
        if (!file.ok) {
          found.problems.push(`${path}: ${file.error.message}`);
          continue;
        }
        found.files.set(path, file.value);
        if (isForeign(remembered[path], file.value)) found.foreign.push(path);
      }
      return found;
    },

    write(root: string, files: Map<string, string>): Promise<string[]> {
      const run = queue.then(async () => {
        // Nothing may be written before the folder has been read; see the module note.
        if (!isDesktop() || !root || !readRoots.has(memoryKey(options.id, root))) return [];

        const remembered = written(root);
        const next: Record<string, string> = {};
        const wrote: string[] = [];

        for (const [path, content] of files) {
          next[path] = fingerprint(content);
          if (alreadyWritten(remembered[path], content)) continue;
          const result = await invokeCommand('write_file', { path, contents: content, root });
          if (result.ok) wrote.push(path);
          // A write that failed leaves the memory as it was, so the next save tries again.
          else next[path] = remembered[path] ?? next[path]!;
        }

        // A record that is gone leaves no file behind for a reader to believe.
        for (const path of orphanedPaths(remembered, files)) {
          await invokeCommand('remove_file', { path, root });
          delete next[path];
        }

        memory = { version: 1, roots: { ...memory.roots, [memoryKey(options.id, root)]: next } };
        writeMemory();
        return wrote;
      });
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },

    ready(root: string): void {
      readRoots.add(memoryKey(options.id, root));
    },

    isReady(root: string): boolean {
      return readRoots.has(memoryKey(options.id, root));
    },

    forget(root?: string): void {
      if (!root) {
        memory = { version: 1, roots: {} };
        readRoots.clear();
      } else {
        const key = memoryKey(options.id, root);
        const { [key]: _dropped, ...rest } = memory.roots;
        memory = { version: 1, roots: rest };
        readRoots.delete(key);
      }
      writeMemory();
    },
  };
}
