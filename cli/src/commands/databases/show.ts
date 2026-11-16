/**
 * One catalogue database in full: every request it understands, the arguments each takes, and
 * a request it would actually send.
 *
 * This is the definition a source searches through, so it is also the place to check what a
 * `find` will send before a review runs — the example is built from the operation's own
 * defaults, not invented.
 */

import { Args } from '@oclif/core';

import { findOperation, operationDefaults } from '@/components/databases/data';
import type { Operation } from '@/components/databases/data';
import { findDatabase } from '@/components/databases/store';
import { operationUrl } from '@/lib/catalog/request';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** One parameter as a line: where it goes, what it is called, and its default. */
function parameterLine(parameter: Operation['parameters'][number]): string {
  const parts = [
    out.c.bold(parameter.name),
    out.c.grey(`${parameter.in}${parameter.param ? ` as ${parameter.param}` : ''}`),
    parameter.label,
  ];
  if (parameter.default !== undefined) parts.push(out.c.grey(`default ${parameter.default}`));
  if (parameter.required) parts.push(out.c.yellow('required'));
  if (parameter.encode) parts.push(out.c.grey(parameter.encode));
  return parts.join('  ');
}

export default class DatabasesShow extends LabCommand {
  static description = 'Show one catalogue database: its operations, arguments and an example request';

  static args = {
    id: Args.string({ description: 'The database id', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(DatabasesShow);
    await this.lab();

    const database = findDatabase(args.id);
    if (!database) {
      this.fail(`No database “${args.id}”. See \`openlab databases list\`.`);
    }

    const find = findOperation(database);
    const example = find ? operationUrl(database, find.id, operationDefaults(find)) : database.endpoint;

    this.emit({ database, example }, () => {
      const lines = [
        out.heading(database.name),
        out.keyValues([
          ['database', database.id],
          ['family', database.family],
          ['purpose', database.purpose],
          ['access', `${database.access} · ${database.state}`],
          ['endpoint', database.endpoint],
          ['holds', database.holds],
          ['updates', database.updateCadence],
          ['licence', database.licence],
          ['docs', database.docsUrl],
        ]),
        '',
        out.heading('Operations'),
      ];

      for (const operation of database.operations) {
        lines.push(
          `  ${out.c.bold(operation.id)}  ${out.c.grey(`${operation.method} ${operation.path}`)}  ${operation.label}`,
        );
        lines.push(
          out.note(
            `    returns ${operation.records === 'ids' ? 'ids, then a fetch for the records' : 'a list of records'}`,
          ),
        );
        for (const parameter of operation.parameters) {
          lines.push(`    ${parameterLine(parameter)}`);
        }
        if (operation.parameters.length === 0) {
          lines.push(out.note('    no arguments'));
        }
      }

      lines.push('', out.heading('Example request'), `  ${example}`);
      return lines.join('\n');
    });
  }
}
