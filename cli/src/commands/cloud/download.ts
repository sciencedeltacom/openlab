/**
 * Download a URL into the workspace.
 *
 * The file the reader asked for is fetched only here, into the folder it belongs to, the way the
 * app's `download_url` writes an imported file — with the same public-URL guard and a cap, so one
 * URL cannot fill the disk. The bytes written are reported, because a silent write is a write
 * nobody checked.
 */

import { Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { checkPublicUrl } from '../../lib/host/exec';
import { removeFile, scopedWrite } from '../../lib/host/fs';
import * as out from '../../lib/output';

/** A single file may not exceed this; the app's Rust import uses the same ceiling. */
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

export default class CloudDownload extends LabCommand {
  static description = 'Download a public URL to a path inside the workspace';

  static flags = {
    url: Flags.string({ required: true, description: 'The URL to download' }),
    out: Flags.string({ required: true, description: 'Where to write it, inside the workspace' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CloudDownload);
    const lab = await this.requireLab();

    let url: URL;
    try {
      url = checkPublicUrl(flags.url);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'openlab/1.0 (research workbench)' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      this.fail(`the server answered ${response.status} for ${url}`);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
      this.fail(`that file is ${Math.round(declared / 1024 / 1024)} MB; too large to download`);
    }

    let dest: string;
    try {
      dest = scopedWrite(flags.out, lab.root as string);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
    const written = await Bun.write(dest, response);
    if (written > MAX_DOWNLOAD_BYTES) {
      removeFile(dest);
      this.fail(`that file is larger than the ${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)} MB cap`);
    }

    this.emit(
      { url: url.toString(), out: flags.out, bytes: written },
      (result) =>
        `${out.mark.ok} ${result.bytes} bytes → ${out.c.bold(this.short(`${lab.root as string}/${result.out}`))}`,
    );
  }
}
