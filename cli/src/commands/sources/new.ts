/**
 * Adding a source to the workspace catalogue.
 *
 * A source is a database plus a saved question: what to look for, which document kinds, over
 * which years. `--filters` states it directly (`query=…,types=article|review,limit=25`), and
 * `--from <databaseId>` seeds it from the shipped catalogue's own defaults for that database —
 * the same starting point the app's source form opens with.
 */

import { Flags } from '@oclif/core';

import { findDatabase } from '@/components/databases/store';
import { findOperation, operationDefaults } from '@/components/databases/data';
import { SOURCE_TYPES, addSource } from '@/lib/catalog/sources';
import type { Source, SourceFilters, SourceType } from '@/lib/catalog/sources';

import { LabCommand } from '../../lib/base';

/** The filters a database's own find operation suggests, as a starting point. */
function seededFilters(databaseId: string): Partial<SourceFilters> {
  const database = findDatabase(databaseId);
  const operation = database ? findOperation(database) : undefined;
  const defaults = operation ? operationDefaults(operation) : {};
  const limit = Number(defaults.limit);
  return Number.isFinite(limit) && limit > 0 ? { limit } : {};
}

/** The document kinds a comma-separated list names, dropping anything the catalogue does not know. */
function toTypes(value: string): SourceType[] {
  return value
    .split('|')
    .map((part) => part.trim())
    .filter((part): part is SourceType => (SOURCE_TYPES as readonly string[]).includes(part));
}

/**
 * Read `--filters`.
 *
 * A `key=value` list is the friendly form; a JSON object is accepted too, for a caller that
 * would rather not quote a value with a comma in it.
 */
function parseFilters(text: string): Partial<SourceFilters> {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as Partial<SourceFilters>;
  }
  const filters: Partial<SourceFilters> = {};
  for (const part of trimmed.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 'query') filters.query = value;
    else if (key === 'types') filters.types = toTypes(value);
    else if (key === 'yearFrom') filters.yearFrom = Number(value);
    else if (key === 'yearTo') filters.yearTo = Number(value);
    else if (key === 'limit') filters.limit = Number(value);
  }
  return filters;
}

export default class SourcesNew extends LabCommand {
  static description = 'Add a source to the workspace catalogue';

  static flags = {
    id: Flags.string({ description: 'The source id (default: generated)' }),
    label: Flags.string({ description: 'A name for the source', required: true }),
    database: Flags.string({ description: 'The catalogue database to search' }),
    from: Flags.string({ description: 'Seed the source from this shipped database’s defaults' }),
    filters: Flags.string({
      description: 'The saved question, e.g. `query=CRISPR,types=article|review,yearFrom=2015,limit=25`',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SourcesNew);
    const lab = await this.lab();
    const databaseId = flags.database ?? flags.from;
    if (!databaseId) {
      this.fail('Name a database with --database <id>, or seed one with --from <id>.');
    }
    const database = findDatabase(databaseId);
    if (!database) {
      this.fail(`No database “${databaseId}”. See \`openlab databases list\`.`);
    }

    const seeded = flags.from ? seededFilters(databaseId) : {};
    const stated = flags.filters ? parseFilters(flags.filters) : {};
    const filters: SourceFilters = {
      query: stated.query ?? seeded.query ?? '',
      types: stated.types ?? seeded.types ?? [],
      ...((stated.yearFrom ?? seeded.yearFrom) !== undefined
        ? { yearFrom: stated.yearFrom ?? seeded.yearFrom }
        : {}),
      ...((stated.yearTo ?? seeded.yearTo) !== undefined ? { yearTo: stated.yearTo ?? seeded.yearTo } : {}),
      limit: stated.limit ?? seeded.limit ?? 25,
    };

    const source: Source = {
      id: flags.id?.trim() || `src-${crypto.randomUUID().slice(0, 8)}`,
      name: flags.label.trim(),
      databaseId,
      filters,
      preview: [],
      createdAt: Date.now(),
    };
    addSource(source);
    await lab.save();

    this.record(source, [
      ['source', source.id],
      ['name', source.name],
      ['database', database.name],
      ['query', source.filters.query || 'none'],
      ['types', source.filters.types.join(', ') || 'any'],
      ['limit', String(source.filters.limit)],
    ]);
  }
}
