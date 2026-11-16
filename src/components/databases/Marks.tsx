/**
 * The small marks the database screens share.
 *
 * A database's icon and a state's icon are drawn in the catalogue card, the facet popover
 * and the record eyebrow. Defining them once is what stops those three places disagreeing
 * about which icon a database wears.
 */

import { cn } from '@/lib/cn';
import { DATABASE_STATE, databaseMark, type Database, type DatabaseState } from './data';

/** A database's icon on its own tint. */
export function DatabaseMark({ database, className }: { database: Database; className?: string }) {
  const { icon: Icon, tint } = databaseMark(database.mark);
  return (
    <span aria-hidden className={cn('grid size-5 shrink-0 place-items-center rounded-md', tint, className)}>
      <Icon className="size-3.5" />
    </span>
  );
}

/** A database state's icon and label, as a chip-shaped row for the facets and the header. */
export function DatabaseStateMark({ state, className }: { state: DatabaseState; className?: string }) {
  const meta = DATABASE_STATE[state];
  const Icon = meta.icon;
  return (
    <span className={cn('flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label', meta.chip, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {meta.label}
    </span>
  );
}
