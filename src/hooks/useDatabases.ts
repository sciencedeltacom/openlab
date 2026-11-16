/**
 * Databases, as a hook.
 *
 * The store lives in `lib/catalog`; this is the hook the screens import, so a component never
 * reaches into the catalogue's internals to read or change it.
 */

export { useDatabases, findDatabase, addDatabase, removeDatabase } from '@/components/databases/store';
