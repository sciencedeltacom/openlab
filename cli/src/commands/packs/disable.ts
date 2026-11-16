/**
 * Close a pack to the agent.
 *
 * The reducer’s `pack/disable`: the pack stays installed — the environment is still provisioned
 * — but its tools, servers and procedures leave the model’s surface entirely. A disabled pack is
 * not a hidden feature; the agent never learns the tool exists.
 */

import { Args } from '@oclif/core';

import { findPack, isPackId } from '@/lib/agent/packs';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class PacksDisable extends LabCommand {
  static description = 'Close a pack to the agent, keeping it installed';

  static args = { id: Args.string({ description: 'The pack id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(PacksDisable);
    const lab = await this.lab({ root: null });
    if (!isPackId(args.id)) {
      this.fail(`No pack “${args.id}”. See \`openlab packs list\`.`);
    }
    if (!lab.state.enabledPacks.includes(args.id)) {
      this.emit(
        { id: args.id, enabled: false, changed: false },
        () => `${out.c.grey('·')} ${findPack(args.id)?.name ?? args.id} is already closed.`,
      );
      return;
    }

    lab.state.enabledPacks = lab.state.enabledPacks.filter((id) => id !== args.id);
    await lab.save();
    this.emit(
      { id: args.id, enabled: false, changed: true },
      () => `${out.mark.ok} Closed ${out.c.bold(findPack(args.id)?.name ?? args.id)} to the agent.`,
    );
  }
}
