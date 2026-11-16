/**
 * Removing a credential.
 *
 * Deleting one that is not there is reported, not failed — the caller wanted it gone, and it is.
 */

import { Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { deleteSecret } from '../../lib/host/secrets';
import * as out from '../../lib/output';

export default class SecretsRm extends LabCommand {
  static description = 'Remove a stored credential';

  static flags = {
    name: Flags.string({ char: 'n', required: true, description: 'The name to remove' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SecretsRm);
    const name = flags.name.trim();
    const removed = deleteSecret(name);
    this.emit({ name, removed }, (value) =>
      value.removed
        ? `${out.mark.ok} removed ${out.c.bold(value.name)}`
        : `${out.mark.skip} no stored value for ${value.name}`,
    );
  }
}
