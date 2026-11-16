/**
 * The credentials the CLI has.
 *
 * The vault's names, plus which providers have a key in the environment — the two places a key
 * is looked up, environment first. A value is never printed; only its name is.
 */

import { LabCommand } from '../../lib/base';
import { catalog, envFor } from '../../lib/catalog';
import { secretNames } from '../../lib/host/secrets';
import * as out from '../../lib/output';

import { PROVIDERS } from '@/lib/providers';

export default class SecretsList extends LabCommand {
  static description = 'List stored credential names, and providers with a key in the environment';

  async run(): Promise<void> {
    const stored = secretNames();

    const ids = new Set([
      ...PROVIDERS.map((provider) => provider.id),
      ...catalog().entries.map((entry) => entry.id),
    ]);
    const environment = [...ids]
      .map((provider) => ({
        provider,
        variables: envFor(provider).filter((name) => Boolean(process.env[name])),
      }))
      .filter((entry) => entry.variables.length > 0);

    const value = { stored, environment };
    this.emit(value, (list) =>
      [
        out.heading('Stored'),
        list.stored.length > 0 ? out.bullets(list.stored) : out.note('nothing stored in the vault'),
        '',
        out.heading('In the environment'),
        list.environment.length > 0
          ? out.bullets(
              list.environment.map((entry) => `${entry.provider}  ${out.c.grey(entry.variables.join(', '))}`),
            )
          : out.note('no provider key found in the environment'),
      ].join('\n'),
    );
  }
}
