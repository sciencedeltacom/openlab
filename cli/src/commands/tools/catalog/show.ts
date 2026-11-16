/**
 * One tool, in full.
 *
 * What it does, what it is allowed to touch, and the JSON Schema the run loop validates a call
 * against before the executor runs. The schema is the app’s own `specFor`, so a third-party
 * tool shows the same shape the model was given.
 */

import { Args } from '@oclif/core';

import { specFor } from '@/lib/agent/spec';
import { findTool } from '@/lib/agent/tools';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

export default class ToolsCatalogShow extends LabCommand {
  static description = 'Show one tool: its summary, its JSON Schema and what it touches';

  static args = { id: Args.string({ description: 'The tool id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ToolsCatalogShow);
    const tool = findTool(args.id);
    if (!tool) {
      this.fail(`No tool “${args.id}”. See \`openlab tools catalog list\`.`);
    }
    const spec = specFor(args.id);
    const value = { tool, spec };

    this.emit(value, () => {
      const touches = [
        tool.effects.readOnly ? 'reads' : '',
        tool.effects.writes ? 'writes' : '',
        tool.effects.executes ? 'executes' : '',
        tool.effects.network ? 'reaches the network' : '',
      ].filter(Boolean);
      return [
        out.keyValues([
          ['tool', `${out.c.bold(tool.name)}  ${out.c.grey(tool.id)}`],
          ['pack', tool.scope],
          ['touches', touches.length > 0 ? touches.join(', ') : 'nothing outside its own record'],
          ['summary', tool.summary],
        ]),
        '',
        out.heading('Schema'),
        JSON.stringify(spec.parameters, null, 2),
      ].join('\n');
    });
  }
}
