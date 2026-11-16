/**
 * The subagent profiles the lead may delegate to.
 *
 * A profile is a named, bounded worker. What bounds it is its packs: a literature scout is not
 * given the chemistry stack, and a read-only explorer is not given a shell. A dispatch can
 * narrow the profile's packs but can never hand a worker a pack the workbench has not opened.
 */

import { SUBAGENT_PROFILES } from '@/lib/agent/subagents';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class AgentsSubagents extends LabCommand {
  static description = 'List the subagent profiles the lead may delegate to';

  async run(): Promise<void> {
    await this.lab();

    const rows = SUBAGENT_PROFILES.map((profile) => ({
      id: profile.id,
      name: profile.name,
      packs: profile.packs.join(', ') || out.c.grey('—'),
      read: profile.readOnly ? 'read-only' : '',
      summary: profile.summary,
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'name' },
        { key: 'packs', label: 'packs' },
        { key: 'read', label: '' },
        { key: 'summary', label: 'what it does', width: 60, truncate: true },
      ],
      'No subagent profiles.',
    );
  }
}
