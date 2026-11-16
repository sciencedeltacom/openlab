/**
 * Store one credential in the CLI’s vault.
 *
 * The vault is the terminal’s own `0600` JSON file, separate from the desktop app’s Stronghold
 * snapshot: a key stored here is one a command run from this shell can use. Lookup checks the
 * environment first, so a key already exported in the shell wins over one stored here.
 */

import { Args } from '@oclif/core';

import { LabCommand } from '../../../lib/base';
import { setSecret } from '../../../lib/host/secrets';
import * as out from '../../../lib/output';

export default class ToolsCredentialsSet extends LabCommand {
  static description = 'Store one credential in the CLI’s vault';

  static args = {
    name: Args.string({
      description: 'The name to store it under, e.g. ANTHROPIC_API_KEY',
      required: true,
    }),
    value: Args.string({
      description: 'The value; it is written to the vault, never printed back',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ToolsCredentialsSet);
    setSecret(args.name, args.value);
    this.emit(
      { name: args.name, stored: true },
      () => `${out.mark.ok} Stored ${out.c.bold(args.name)} in the CLI’s vault.`,
    );
  }
}
