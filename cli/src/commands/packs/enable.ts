/**
 * Open an installed pack to the agent.
 *
 * The reducer’s `pack/enable`: only an installed pack can be opened, because the workbench
 * cannot grant a capability whose environment the user has not provisioned. Enabling a pack is
 * additive — the session sees the core tools plus the union of the packs opened — so this only
 * ever adds.
 */

import { Args } from '@oclif/core';

import { findPack, isPackId } from '@/lib/agent/packs';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class PacksEnable extends LabCommand {
  static description = 'Open an installed pack to the agent';

  static args = { id: Args.string({ description: 'The pack id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(PacksEnable);
    const lab = await this.lab({ root: null });
    if (!isPackId(args.id)) {
      this.fail(`No pack “${args.id}”. See \`openlab packs list\`.`);
    }
    if (!lab.state.installedPacks.includes(args.id)) {
      this.fail(`${args.id} is not installed here. Install it first: \`openlab packs install ${args.id}\`.`);
    }
    if (lab.state.enabledPacks.includes(args.id)) {
      this.emit(
        { id: args.id, enabled: true, changed: false },
        () => `${out.c.grey('·')} ${findPack(args.id)?.name ?? args.id} is already open.`,
      );
      return;
    }

    lab.state.enabledPacks = [...lab.state.enabledPacks, args.id];
    await lab.save();
    this.emit(
      { id: args.id, enabled: true, changed: true },
      () => `${out.mark.ok} Opened ${out.c.bold(findPack(args.id)?.name ?? args.id)} to the agent.`,
    );
  }
}
