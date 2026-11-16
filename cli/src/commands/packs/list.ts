/**
 * The domain packs.
 *
 * A pack is the unit that turns the workbench into a specific lab: it declares the tools, MCP
 * servers and procedures a stream of work brings. This lists the catalogue with the two facts
 * that decide what a session can do — whether the pack is installed here, and whether it is
 * opened to the agent.
 */

import { allPacks, packToolIds } from '@/lib/agent/packs';

import { LabCommand } from '../../lib/base';

export default class PacksList extends LabCommand {
  static description = 'List the domain packs: what each brings, and whether it is installed and open';

  async run(): Promise<void> {
    await this.parse(PacksList);
    const lab = await this.lab({ root: null });
    const rows = allPacks().map((pack) => {
      const tools = packToolIds(pack.id);
      return {
        id: pack.id,
        name: pack.name,
        family: pack.family,
        brings: `${tools.length} tools · ${pack.mcps.length} mcp · ${pack.skills.length} skills`,
        installed: lab.state.installedPacks.includes(pack.id) ? 'installed' : '',
        enabled: lab.state.enabledPacks.includes(pack.id) ? 'open' : '',
      };
    });

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'pack', truncate: true, width: 22 },
        { key: 'family', label: 'family', truncate: true, width: 24 },
        { key: 'brings', label: 'brings' },
        { key: 'installed', label: '' },
        { key: 'enabled', label: '' },
      ],
      'No packs in this build.',
    );
  }
}
