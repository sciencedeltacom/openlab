/**
 * One connector, in full.
 *
 * What it is, who to credit, and the requests it would make — the connector’s own `plan` for a
 * sample query, so the URLs a search would hit are visible rather than described. Nothing is
 * fetched here; a plan is data, which is what keeps the whole layer testable.
 */

import { Args } from '@oclif/core';

import { findConnector } from '@/lib/science/connectors';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

export default class ToolsConnectorsShow extends LabCommand {
  static description = 'Show one connector: what it returns, its plan and its credential';

  static args = { id: Args.string({ description: 'The connector id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ToolsConnectorsShow);
    const connector = findConnector(args.id);
    if (!connector) {
      this.fail(`No connector “${args.id}”. See \`openlab tools connectors list\`.`);
    }
    const steps = connector.plan('example query', 3);
    const value = { ...connector, plan: steps };

    this.emit(value, () => {
      const lines = [
        out.keyValues([
          ['connector', `${out.c.bold(connector.label)}  ${out.c.grey(connector.id)}`],
          ['category', connector.category],
          ['returns', connector.summary],
          ['credential', 'none. Free to use, no API key'],
          ['docs', connector.docsUrl],
          ['credit', connector.attribution],
        ]),
        '',
        out.heading(`Request plan (${steps.length} step${steps.length === 1 ? '' : 's'})`),
        ...steps.flatMap((step, index) => {
          const headers = Object.entries(step.headers ?? {}).map(([name, value]) => `${name}: ${value}`);
          return [`  ${index + 1}. ${step.url}`, ...headers.map((header) => `     ${out.c.grey(header)}`)];
        }),
        '',
        out.note('A plan is data; `openlab` fetches nothing until a search runs.'),
      ];
      return lines.join('\n');
    });
  }
}
