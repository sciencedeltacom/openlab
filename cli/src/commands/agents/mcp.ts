/**
 * The MCP servers the packs allow, and whether the workbench has them closed.
 *
 * A pack *allows* a server; opening it is a second decision, because a server needs a
 * credential or a runtime the workbench cannot supply. So a row shows three separate facts:
 * what the packs allow, whether the workbench has closed it, and whether it can actually run
 * (`installed` is false until it can).
 */

import { MCP_SERVERS } from '@/lib/agent/mcp';
import type { McpTransport } from '@/lib/agent/mcp';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** How a server is reached, in one line. */
function transport(transport: McpTransport): string {
  return transport.kind === 'stdio' ? `${transport.command} ${transport.args.join(' ')}` : transport.url;
}

export default class AgentsMcp extends LabCommand {
  static description = 'List the MCP servers the packs allow, and whether they are closed';

  async run(): Promise<void> {
    const lab = await this.lab();
    const closed = new Set(lab.state.closedMcps);

    const rows = MCP_SERVERS.map((server) => ({
      id: server.id,
      name: server.name,
      transport: transport(server.transport),
      closed: closed.has(server.id) ? out.mark.warn : '',
      requires: server.requires.join('; '),
      kind: server.startable ? 'startable' : 'reference',
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'name' },
        { key: 'transport', label: 'transport', width: 40, truncate: true },
        { key: 'closed', label: 'closed' },
        { key: 'requires', label: 'needs', width: 36, truncate: true },
        { key: 'kind', label: 'kind' },
      ],
      'No MCP servers.',
    );
  }
}
