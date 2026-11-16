/**
 * Uninstall a domain pack.
 *
 * The reducer’s `pack/uninstall`: the pack is no longer provisioned here, and it is closed with
 * it, because a pack that is not installed cannot be open to the agent.
 */

import { Args } from '@oclif/core';

import { findPack, isPackId } from '@/lib/agent/packs';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class PacksUninstall extends LabCommand {
  static description = 'Uninstall a domain pack and close it';

  static args = { id: Args.string({ description: 'The pack id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(PacksUninstall);
    const lab = await this.lab({ root: null });
    if (!isPackId(args.id)) {
      this.fail(`No pack “${args.id}”. See \`openlab packs list\`.`);
    }

    const state = lab.state;
    state.installedPacks = state.installedPacks.filter((id) => id !== args.id);
    state.enabledPacks = state.enabledPacks.filter((id) => id !== args.id);
    await lab.save();

    this.emit(
      { id: args.id, installed: false, enabled: false },
      () => `${out.mark.ok} Uninstalled ${out.c.bold(findPack(args.id)?.name ?? args.id)}.`,
    );
  }
}
