/**
 * Storing a credential.
 *
 * The value comes from `--value` or standard input, so it never has to appear in the shell's
 * history. It goes to the CLI's own vault, not the app's Stronghold file; the two are separate
 * places to work. A value is stored, never echoed back.
 */

import { Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { setSecret } from '../../lib/host/secrets';
import * as out from '../../lib/output';

export default class SecretsSet extends LabCommand {
  static description = 'Store a credential, from --value or standard input';

  static flags = {
    name: Flags.string({ char: 'n', required: true, description: 'The name to store it under' }),
    value: Flags.string({ char: 'v', description: 'The value (omit to read it from standard input)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SecretsSet);
    const name = flags.name.trim();
    if (name === '') {
      this.fail('a name is required.');
    }

    // A value piped in usually ends with the newline that ended the line, not the value.
    const value = flags.value ?? (await Bun.stdin.text()).replace(/\r?\n$/, '');
    if (value === '') {
      this.fail('refusing to store an empty value.');
    }

    setSecret(name, value);
    this.emit(
      { name, stored: true },
      () => `${out.mark.ok} stored ${out.c.bold(name)} ${out.c.grey('(value hidden)')}`,
    );
  }
}
