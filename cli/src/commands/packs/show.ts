/**
 * One domain pack, in full.
 *
 * What the pack is, whether it is installed and open, and the three things it brings: the tools
 * it grants, the MCP servers it allows, and the skills and recipes it makes visible. A tool is
 * named from the inventory, so a pack cannot list a tool under a name the tool page does not
 * use.
 */

import { Args } from '@oclif/core';

import { findPack, packToolIds } from '@/lib/agent/packs';
import { findMcpServer } from '@/lib/agent/mcp';
import { findTool } from '@/lib/agent/tools';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class PacksShow extends LabCommand {
  static description = 'Show one domain pack: its tools, MCP servers, skills and procedures';

  static args = { id: Args.string({ description: 'The pack id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(PacksShow);
    const lab = await this.lab({ root: null });
    const pack = findPack(args.id);
    if (!pack) {
      this.fail(`No pack “${args.id}”. See \`openlab packs list\`.`);
    }
    const tools = packToolIds(pack.id).map((id) => ({ id, name: findTool(id)?.name ?? id }));
    const mcps = pack.mcps.map((id) => {
      const server = findMcpServer(id);
      return { id, name: server?.name ?? id };
    });
    const value = {
      ...pack,
      installed: lab.state.installedPacks.includes(pack.id),
      enabled: lab.state.enabledPacks.includes(pack.id),
      tools,
      mcps,
    };

    this.emit(value, () => {
      const lines = [
        out.keyValues([
          ['pack', `${out.c.bold(pack.name)}  ${out.c.grey(pack.id)}`],
          ['family', pack.family],
          ['installed', value.installed ? 'yes' : out.c.grey('no')],
          ['open', value.enabled ? 'yes' : out.c.grey('no')],
        ]),
        '',
        out.heading(`Tools (${tools.length})`),
        ...(tools.length > 0
          ? tools.map((tool) => `  ${tool.name}  ${out.c.grey(tool.id)}`)
          : [out.note('  none')]),
        '',
        out.heading(`MCP servers (${mcps.length})`),
        ...(mcps.length > 0
          ? mcps.map((server) => `  ${server.name}  ${out.c.grey('reference only, not started')}`)
          : [out.note('  none')]),
        '',
        out.heading(`Skills and procedures (${pack.skills.length})`),
        ...(pack.skills.length > 0 ? pack.skills.map((id) => `  ${id}`) : [out.note('  none')]),
      ];
      return lines.join('\n');
    });
  }
}
