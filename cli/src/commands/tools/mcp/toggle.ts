/**
 * Turn an MCP server off or on.
 *
 * The reducer’s `mcp/toggle`: the workbench stores the servers that are *closed* rather than the
 * ones that are open, so a pack’s allowance stays the default and turning one off is the
 * explicit act. Toggling a server the pack never allowed changes nothing the model can see.
 */

import { Args } from '@oclif/core';

import { MCP_SERVERS } from '@/lib/agent/mcp';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

export default class ToolsMcpToggle extends LabCommand {
  static description = 'Turn an MCP server off or on';

  static args = { id: Args.string({ description: 'The MCP server id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ToolsMcpToggle);
    const lab = await this.lab({ root: null });
    const server = MCP_SERVERS.find((candidate) => candidate.id === args.id);
    if (!server) {
      this.fail(`No MCP server “${args.id}”. See \`openlab tools mcp list\`.`);
    }

    const closed = lab.state.closedMcps.includes(server.id)
      ? lab.state.closedMcps.filter((id) => id !== server.id)
      : [...lab.state.closedMcps, server.id];
    lab.state.closedMcps = closed;
    await lab.save();

    const open = !closed.includes(server.id);
    this.emit({ id: server.id, open }, () =>
      open
        ? `${out.mark.ok} Opened ${out.c.bold(server.name)} to the agent.`
        : `${out.mark.ok} Closed ${out.c.bold(server.name)}; a pack that allows it will not open it.`,
    );
  }
}
