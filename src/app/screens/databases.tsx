/**
 * Database screen entry points.
 *
 * The registry imports the catalogue and the record page from here, so a route never has to
 * know which file a view lives in. Mirrors the other sections' screen modules.
 */

export { DatabaseCatalogue } from '@/components/databases/DatabaseCatalogue';
export { DatabaseDetail } from '@/components/databases/DatabaseDetail';
export { DatabaseCreate } from '@/components/databases/DatabaseCreate';
