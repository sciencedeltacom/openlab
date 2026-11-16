/**
 * The science connectors.
 *
 * A connector is a declarative description of one public research API: how to build the request,
 * how to read the response and how to cite it. Every one openlab ships is free to use and needs
 * no API key, which is why the credential column says so rather than leaving it blank.
 */

import { SCIENCE_CONNECTORS } from '@/lib/science/connectors';

import { LabCommand } from '../../../lib/base';

export default class ToolsConnectorsList extends LabCommand {
  static description = 'List the science connectors: what each returns and what it needs';

  async run(): Promise<void> {
    await this.parse(ToolsConnectorsList);
    const rows = SCIENCE_CONNECTORS.map((connector) => ({
      id: connector.id,
      label: connector.label,
      category: connector.category,
      returns: connector.summary,
      credential: 'none',
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'label', label: 'connector', truncate: true, width: 20 },
        { key: 'category', label: 'category' },
        { key: 'returns', label: 'returns', truncate: true, width: 48 },
        { key: 'credential', label: 'credential' },
      ],
      'No connectors in this build.',
    );
  }
}
