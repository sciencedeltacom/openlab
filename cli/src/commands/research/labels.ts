/**
 * The labels a task can carry.
 *
 * A label is a method, a domain or a topic, and the group is what the filter groups by, so it
 * is worth setting when the label is created rather than guessed later.
 */

import { Flags } from '@oclif/core';

import { newLabel, type Label } from '@/store/research';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class ResearchLabels extends LabCommand {
  static description = 'List the tracker’s labels, or add one';

  static flags = {
    new: Flags.boolean({ description: 'Add a label instead of listing them' }),
    name: Flags.string({ char: 'n', description: 'The label’s name (with --new)' }),
    color: Flags.string({ description: 'A hex colour, e.g. #2FBF8F' }),
    group: Flags.string({ description: 'What kind of label it is', options: ['method', 'domain', 'topic'] }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ResearchLabels);
    const lab = await this.requireLab();
    const state = lab.state;

    if (flags.new) {
      if (!flags.name) this.fail('A label needs a --name.');
      if (flags.color && !/^#[0-9a-f]{6}$/i.test(flags.color)) {
        this.fail(`“${flags.color}” is not a hex colour like #2FBF8F.`);
      }
      const label = newLabel(
        flags.name,
        flags.color ?? '#1E5DB3',
        (flags.group as Label['group']) ?? 'topic',
      );
      // The store's own `label/create` puts the newest first.
      state.labels = [label, ...state.labels];
      await lab.save();
      this.emit(
        label,
        (created) => `${out.mark.ok} Added label ${out.c.bold(created.name)} ${out.c.grey(created.group)}`,
      );
      return;
    }

    this.list(
      state.labels,
      [
        { key: 'name', label: 'name', truncate: true, width: 28 },
        { key: 'group', label: 'group' },
        { key: 'color', label: 'colour' },
        {
          key: 'tasks',
          label: 'tasks',
          align: 'right',
          format: (label) => String(state.tasks.filter((task) => task.labels.includes(label.id)).length),
        },
      ],
      'No labels yet. `openlab research labels --new --name "docking"` adds one.',
    );
  }
}
