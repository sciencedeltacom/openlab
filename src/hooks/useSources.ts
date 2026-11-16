/**
 * Sources, as a hook.
 *
 * A source is a saved question against a database; the store lives in `lib/catalog`. Screens
 * read the list here and fetch records lazily, so a source stays light and the data is pulled
 * from its database only when it is used.
 */

export {
  useSources,
  findSource,
  addSource,
  removeSource,
  patchSource,
  fetchSourceRecords,
  previewSource,
  parseRecords,
  SOURCE_TYPES,
  type Source,
  type SourceFilters,
  type SourceRecord,
  type SourceType,
} from '@/lib/catalog/sources';
