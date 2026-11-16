/**
 * Remove one credential from the CLI’s vault.
 *
 * Only the CLI’s own vault is touched; the desktop app’s Stronghold snapshot is the app’s and is
 * not reachable from here. An environment variable is the shell’s to unset, so a name that is
 * only in the environment is reported as not stored rather than removed.
 */

import { Args } from '@oclif/core';

import { LabCommand } from '../../../lib/base';
import { deleteSecret } from '../../../lib/host/secrets';
import * as out from '../../../lib/output';

export default class ToolsCredentialsRm extends LabCommand {
  static description = 'Remove one credential from the CLI’s vault';

  static args = { name: Args.string({ description: 'The name to remove', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ToolsCredentialsRm);
    if (!deleteSecret(args.name)) {
      this.fail(`No credential named “${args.name}” in the CLI’s vault.`);
    }
    this.emit(
      { name: args.name, stored: false },
      () => `${out.mark.ok} Removed ${out.c.bold(args.name)} from the CLI’s vault.`,
    );
  }
}
