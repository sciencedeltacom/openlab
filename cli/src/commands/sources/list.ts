/**
 * The saved sources: each one a database plus the filters a review searches it with.
 *
 * A source is not a copy of the data — it is the question. The list shows which database it
 * asks, what it keeps, and whether that database needs a credential the terminal would have to
 * carry, so a review knows what it can reach before it runs.
 */

import { findDatabase } from '@/components/databases/store';
import { findSource, sourceIds } from '@/lib/catalog/sources';
import type { Source, SourceFilters } from '@/lib/catalog/sources';

import { LabCommand } from '../../lib/base';

/** A readable year span, or `any`. */
function years(filters: SourceFilters): string {
  if (filters.yearFrom === undefined && filters.yearTo === undefined) {
    return 'any';
  }
  return `${filters.yearFrom ?? ''}–${filters.yearTo ?? ''}`;
}

export default class SourcesList extends LabCommand {
  static description = 'List the saved sources and the database each one searches';

  async run(): Promise<void> {
    await this.lab();

    const rows = sourceIds()
      .map((id) => findSource(id))
      .filter((source): source is Source => Boolean(source))
      .map((source) => {
        const database = findDatabase(source.databaseId);
        return {
          id: source.id,
          name: source.name,
          database: database?.name ?? source.databaseId,
          types: source.filters.types.join(', ') || 'any',
          years: years(source.filters),
          key: database ? (database.authorization === 'none' ? 'no' : 'yes') : '?',
          limit: source.filters.limit,
        };
      });

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'source' },
        { key: 'database', label: 'database' },
        { key: 'types', label: 'types' },
        { key: 'years', label: 'years' },
        { key: 'key', label: 'key' },
        { key: 'limit', label: 'limit', align: 'right' },
      ],
      'No sources yet. `openlab sources new` adds one.',
    );
  }
}
