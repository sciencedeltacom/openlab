/**
 * One source, or one catalogue database, in full.
 *
 * A source names a database and the filters it searches with; a database names its operations
 * — the URL each one builds, the arguments it takes, and what the response carries. Showing
 * both through the same command is what makes `sources show openalex` and `sources show <id>`
 * read the same way: the operations are the database's, the filters are the source's.
 */

import { Args } from '@oclif/core';

import { findDatabase } from '@/components/databases/store';
import { operationDefaults, findOperation } from '@/components/databases/data';
import type { Database, Operation } from '@/components/databases/data';
import { operationUrl } from '@/lib/catalog/request';
import { findArgs, findSource } from '@/lib/catalog/sources';
import type { SourceFilters } from '@/lib/catalog/sources';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** The arguments a search sends, with an empty document-type list dropped (a bare `type:` is a 400). */
function searchArgs(filters: SourceFilters): Record<string, unknown> {
  const args = findArgs(filters);
  if (Array.isArray(args.types) && args.types.length === 0) {
    delete args.types;
  }
  return args;
}

/** One operation as a line: its id, its request, and the arguments it takes. */
function operationLine(operation: Operation): string {
  const args = operation.parameters.map((parameter) => parameter.name).join(', ') || 'no arguments';
  return [
    out.c.bold(operation.id),
    out.c.grey(`${operation.method} ${operation.path}`),
    operation.label,
    out.c.grey(`(${args})`),
  ].join('  ');
}

/** What the response of an operation carries, in words. */
function returns(operation: Operation): string {
  return operation.records === 'ids'
    ? 'ids, then its `fetch` operation turns them into records'
    : 'a list of records';
}

export default class SourcesShow extends LabCommand {
  static description = 'Show one source, or one catalogue database, and the requests it makes';

  static args = {
    id: Args.string({ description: 'A source id, or a database id', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SourcesShow);
    await this.lab();

    const source = findSource(args.id);
    const database = source ? findDatabase(source.databaseId) : findDatabase(args.id);
    if (!database) {
      this.fail(
        `No source or database “${args.id}”. See \`openlab sources list\` and \`openlab databases list\`.`,
      );
    }

    const find = findOperation(database);
    const url = find
      ? operationUrl(database, find.id, source ? searchArgs(source.filters) : operationDefaults(find))
      : database.endpoint;

    this.emit({ kind: source ? 'source' : 'database', source: source ?? null, database, url }, () => {
      const lines: string[] = [];

      if (source) {
        lines.push(
          out.heading(source.name),
          out.keyValues([
            ['source', source.id],
            ['database', `${database.name} ${out.c.grey(`(${database.id})`)}`],
            ['query', source.filters.query || out.c.grey('none. The review’s question is the search')],
            ['types', source.filters.types.join(', ') || 'any'],
            [
              'years',
              source.filters.yearFrom === undefined && source.filters.yearTo === undefined
                ? 'any'
                : `${source.filters.yearFrom ?? ''}–${source.filters.yearTo ?? ''}`,
            ],
            ['limit', String(source.filters.limit)],
            ['preview', `${source.preview.length} record(s)`],
          ]),
        );
      } else {
        lines.push(
          out.heading(database.name),
          out.keyValues([
            ['database', database.id],
            ['family', database.family],
            ['purpose', database.purpose],
            ['access', `${database.access} · ${database.state}`],
            ['endpoint', database.endpoint],
            ['holds', database.holds],
            ['docs', database.docsUrl],
          ]),
        );
      }

      lines.push('', out.heading('Operations'));
      if (database.operations.length === 0) {
        lines.push(out.note('  none yet. This database has no request to make.'));
      } else {
        for (const operation of database.operations) {
          lines.push(`  ${operationLine(operation)}`);
          lines.push(out.note(`    returns ${returns(operation)}`));
        }
      }

      lines.push('', out.heading('Request'), `  ${url}`);
      if (find) {
        lines.push(out.note(`  the ${find.id} operation builds this URL`));
      }
      return lines.join('\n');
    });
  }
}
