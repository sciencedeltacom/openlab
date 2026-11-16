/**
 * The MCP servers.
 *
 * A domain pack allows a server; the workbench opens it, and turning one off is the only way to
 * say no, because a pack’s allowance is the default. `installed` is a separate question — true
 * only once the workbench can actually start the server — so a server that is declared but not
 * runnable says so rather than looking ready.
 */

import { MCP_SERVERS } from '@/lib/agent/mcp';

import { LabCommand } from '../../../lib/base';

/** How a server is reached, in one line. */
function transportOf(server: (typeof MCP_SERVERS)[number]): string {
  return server.transport.kind === 'stdio'
    ? [server.transport.command, ...server.transport.args].join(' ')
    : server.transport.url;
}

export default class ToolsMcpList extends LabCommand {
  static description = 'List the MCP servers, whether each can run and whether it is open';

  async run(): Promise<void> {
    await this.parse(ToolsMcpList);
    const lab = await this.lab({ root: null });
    const rows = MCP_SERVERS.map((server) => ({
      id: server.id,
      name: server.name,
      transport: transportOf(server),
      kind: server.startable ? 'startable' : 'reference',
      state: lab.state.closedMcps.includes(server.id) ? 'closed' : 'open',
      needs: server.requires.join(', '),
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'server', truncate: true, width: 14 },
        { key: 'transport', label: 'transport', truncate: true, width: 30 },
        { key: 'kind', label: 'kind' },
        { key: 'state', label: 'state' },
        { key: 'needs', label: 'needs', truncate: true, width: 30 },
      ],
      'No MCP servers in this build.',
    );
  }
}
