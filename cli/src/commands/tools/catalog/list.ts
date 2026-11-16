/**
 * The tool catalogue.
 *
 * The inventory says what an agent can do, what each action touches and which domain pack
 * unlocks it. It is read from `lib/agent/tools` — plus whatever an installed extension added —
 * so the catalogue here is the same one the model’s brief is built from.
 */

import { allTools, type ToolEffects } from '@/lib/agent/tools';

import { LabCommand } from '../../../lib/base';

/** The effects a tool has, as short words a reader scans. */
function effectsOf(effects: ToolEffects): string {
  const parts = [
    effects.readOnly ? 'read' : '',
    effects.writes ? 'write' : '',
    effects.executes ? 'exec' : '',
    effects.network ? 'net' : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'none';
}

export default class ToolsCatalogList extends LabCommand {
  static description = 'List the tool catalogue: id, name, effects and the pack that owns it';

  async run(): Promise<void> {
    await this.parse(ToolsCatalogList);
    const rows = allTools().map((tool) => ({
      id: tool.id,
      name: tool.name,
      effects: effectsOf(tool.effects),
      pack: tool.scope,
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'tool', truncate: true, width: 26 },
        { key: 'effects', label: 'effects' },
        { key: 'pack', label: 'pack' },
      ],
      'No tools in this build.',
    );
  }
}
