/**
 * The command every openlab command extends.
 *
 * Two jobs: it owns the flags every command shares (`--json`, `--workspace`, `--data`), and it
 * owns the workbench handle, opened once and closed when the command returns. Commands then
 * read as what they do — open the lab, change one thing, save — rather than as plumbing.
 */

import { Command, Errors, Flags } from '@oclif/core';
import { resolve } from 'node:path';

import { openLab, requireProject, type Lab } from './lab';
import * as out from './output';
import { resolveLabRoot, shortPath } from './paths';

/** The flags this base class contributes. */
interface SharedFlags {
  json: boolean;
  workspace?: string;
  data?: string;
}

/** What `parse` accepts; a class with static flags satisfies it. */
type ParseInput = Parameters<Command['parse']>[0];

export abstract class LabCommand extends Command {
  static baseFlags = {
    json: Flags.boolean({
      char: 'j',
      description: 'Print JSON instead of a table, for pipes',
    }),
    workspace: Flags.string({
      char: 'w',
      description: 'The lab folder (default: the nearest one above the working directory)',
    }),
    data: Flags.string({
      description: 'The app data directory (default: the desktop app’s)',
    }),
  };

  /** The shared flags, parsed before `run`. */
  protected opts!: SharedFlags;

  private opened: Lab | null = null;

  async init(): Promise<void> {
    const { flags } = await this.parse(this.constructor as unknown as ParseInput);
    this.opts = flags as unknown as SharedFlags;
    // The vault, the database and the CLI's own config all resolve the data directory from the
    // environment, so `--data` is applied once here rather than in every command that needs a
    // path the workbench handle does not carry.
    if (this.opts.data) {
      process.env.OPENLAB_DATA_DIR = resolve(this.opts.data);
    }
  }

  /** True when the command was asked for machine-readable output. */
  protected get json(): boolean {
    return Boolean(this.opts.json);
  }

  /**
   * The workbench.
   *
   * Opens the store, and the lab folder when one was named or found. `root: null` opens the
   * store alone — the right thing for a command about the workbench itself rather than a lab.
   */
  protected async lab(options: { root?: string | null; name?: string } = {}): Promise<Lab> {
    if (!this.opened) {
      const root = 'root' in options ? options.root : resolveLabRoot(this.opts.workspace);
      this.opened = await openLab({
        dataDir: this.opts.data,
        root: root ?? null,
        name: options.name,
      });
    }
    return this.opened;
  }

  /** The workbench, with a lab folder guaranteed. */
  protected async requireLab(): Promise<Lab> {
    const lab = await this.lab();
    if (!lab.root) {
      this.fail('No lab folder found. Run `openlab init <dir>`, or point at one with --workspace <dir>.');
    }
    return lab;
  }

  /** The lab's project record, for commands that need its id. */
  protected async project(): Promise<ReturnType<typeof requireProject>> {
    return requireProject(await this.requireLab());
  }

  /** Print `value` as JSON, or hand it to the human renderer. */
  protected emit<T>(value: T, human: (value: T) => string | void): void {
    if (this.json) {
      this.log(out.json(value));
      return;
    }
    const text = human(value);
    if (text) {
      this.log(text);
    }
  }

  /** Print a list as a table (or JSON). */
  protected list<T>(
    rows: readonly T[],
    columns: readonly out.Column<T>[],
    empty = 'Nothing here yet.',
  ): void {
    if (this.json) {
      this.log(out.json(rows));
      return;
    }
    if (rows.length === 0) {
      this.log(out.note(empty));
      return;
    }
    this.log(out.table(rows, columns));
  }

  /** Print one record as key/value pairs (or JSON). */
  protected record<T>(value: T, pairs: readonly (readonly [string, string | undefined | null])[]): void {
    this.emit(value, () => out.keyValues(pairs));
  }

  /** A confirmation line, suppressed when the output is JSON. */
  protected done(message: string): void {
    if (!this.json) {
      this.log(message);
    }
  }

  /** Fail with a readable message and a non-zero exit code. */
  protected fail(message: string): never {
    throw new Errors.CLIError(message);
  }

  /**
   * The value, or a readable failure.
   *
   * A lookup and the message for when it misses belong next to each other, and the returned
   * value keeps its narrowed type inside a renderer callback.
   */
  protected require<T>(value: T | undefined | null, message: string): NonNullable<T> {
    if (value === undefined || value === null) {
      this.fail(message);
    }
    return value as NonNullable<T>;
  }

  /** A path as the user would write it. */
  protected short(path: string): string {
    return shortPath(path);
  }

  async finally(): Promise<void> {
    this.opened?.close();
    this.opened = null;
  }
}
