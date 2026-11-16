/**
 * Change one setting.
 *
 * Only the scalar settings are settable here: the list and record settings (`tabs`, the pack
 * lists, the task views) are shaped by the surfaces that own them, so setting them from a single
 * string would write a value the app cannot read back. The refusal names what can be set.
 */

import { Args } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** The settings that are a single value, and so safe to set from one argument. */
const SCALARS = ['modelRef', 'theme', 'mode', 'reasoning', 'navMode', 'indexRoot'] as const;
type Scalar = (typeof SCALARS)[number];

/** The values a fixed-choice scalar accepts. */
const CHOICES: Partial<Record<Scalar, readonly string[]>> = {
  theme: ['light', 'dark'],
  mode: ['agent', 'plan', 'ask'],
  reasoning: ['off', 'low', 'medium', 'high'],
  navMode: ['horizontal', 'vertical'],
};

export default class SettingsSet extends LabCommand {
  static description = 'Change one scalar setting the workbench persists';

  static args = {
    key: Args.string({ required: true, description: 'The setting to change' }),
    value: Args.string({ required: true, description: 'Its new value' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SettingsSet);
    const lab = await this.lab();

    if (!(SCALARS as readonly string[]).includes(args.key)) {
      this.fail(`“${args.key}” is not settable here. Set one of: ${SCALARS.join(', ')}.`);
    }
    const key = args.key as Scalar;

    const choices = CHOICES[key];
    if (choices && !choices.includes(args.value)) {
      this.fail(`${key} must be one of: ${choices.join(', ')}.`);
    }

    (lab.state as unknown as Record<string, unknown>)[key] = args.value;
    await lab.save();

    this.emit({ key, value: args.value }, (setting) => out.keyValues([[setting.key, setting.value]]));
  }
}
