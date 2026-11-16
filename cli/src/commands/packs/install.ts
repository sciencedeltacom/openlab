/**
 * Install a domain pack.
 *
 * Install is the app's own transition, mirroring the reducer's `pack/install`: the pack is
 * marked provisioned on this machine and opened to the agent. It is a user assertion — openlab
 * cannot fetch a reference genome or a GPU stack — so nothing here downloads anything.
 */

import { Args } from '@oclif/core';

import { findPack, isPackId } from '@/lib/agent/packs';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class PacksInstall extends LabCommand {
  static description = 'Mark a domain pack installed and open it to the agent';

  static args = { id: Args.string({ description: 'The pack id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(PacksInstall);
    const lab = await this.lab({ root: null });
    if (!isPackId(args.id)) {
      this.fail(`No pack “${args.id}”. See \`openlab packs list\`.`);
    }

    const state = lab.state;
    if (!state.installedPacks.includes(args.id)) {
      state.installedPacks = [...state.installedPacks, args.id];
    }
    if (!state.enabledPacks.includes(args.id)) {
      state.enabledPacks = [...state.enabledPacks, args.id];
    }
    await lab.save();

    this.emit(
      { id: args.id, installed: true, enabled: true },
      () =>
        `${out.mark.ok} Installed ${out.c.bold(findPack(args.id)?.name ?? args.id)} and opened it to the agent.`,
    );
  }
}
