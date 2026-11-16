/**
 * One persisted setting, by key.
 *
 * The counterpart to `settings list`: the value alone, so a script can read `theme` or `modelRef`
 * without parsing a table.
 */

import { Args } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { SETTING_KEYS, renderSetting } from './list';

export default class SettingsGet extends LabCommand {
  static description = 'Show one setting the workbench persists';

  static args = {
    key: Args.string({ required: true, description: 'The setting name' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SettingsGet);
    const lab = await this.lab();
    if (!(SETTING_KEYS as readonly string[]).includes(args.key)) {
      this.fail(`Unknown setting “${args.key}”. Try: ${SETTING_KEYS.join(', ')}.`);
    }

    const value = lab.state[args.key as (typeof SETTING_KEYS)[number]];
    this.emit({ key: args.key, value }, (setting) =>
      out.keyValues([[setting.key, renderSetting(setting.value)]]),
    );
  }
}
