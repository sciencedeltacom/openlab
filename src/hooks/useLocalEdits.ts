/**
 * Local, in-memory edits over a static collection.
 *
 * The domain is seed data: nothing here is persisted or sent anywhere. Every list that
 * wants to be editable holds one of these, seeded from the domain constant, so the list
 * visibly reflects its own rename, state change, removal or addition for the visit.
 *
 * Every mutator reports what happened through {@link notify}. That is the point: a list
 * does not need a toast call per action, only a noun and a name for its rows, so the
 * common case cannot forget to say anything.
 */

import { useMemo, useState } from 'react';

import { notify } from '@/lib/toast';

/** What a list can do to its own rows. */
export interface LocalEdits<T> {
  /** The seed plus additions, minus removals, with patches applied. */
  items: T[];
  /**
   * Merge changes into one record.
   *
   * `message` is the notification, when a caller can say more than the generic one —
   * "Status changed to In progress" rather than "Updated task".
   */
  patch: (key: string, changes: Partial<T>, message?: string) => void;
  /** Rename a record that carries a `name`. `label` names the record for the message. */
  rename: (key: string, name: string, label?: string) => void;
  /** Drop a record from the list. The toast offers an Undo. */
  remove: (key: string, label?: string) => void;
  /** Put a newly created record at the top. `label` names it for the message. */
  add: (item: T, label?: string) => void;
}

/** How a list describes itself in a notification. */
export interface LocalEditsOptions<T> {
  /** One record's human name, e.g. its title. */
  nameOf?: (item: T) => string;
  /** What one record is, e.g. `"task"`, used when no name is available. */
  noun?: string;
}

/**
 * Hold rename, patch, remove and add for a static collection.
 *
 * `keyOf` names a record: an id for a domain record, a chosen column for a table row. The
 * seed is read fresh every render but existing edits survive, so a spec that rebuilds its
 * array (the assistant's results, for instance) does not lose what the reader changed.
 */
export function useLocalEdits<T>(
  seed: readonly T[],
  keyOf: (item: T) => string,
  options: LocalEditsOptions<T> = {},
): LocalEdits<T> {
  const { nameOf, noun } = options;
  const [added, setAdded] = useState<T[]>([]);
  const [patched, setPatched] = useState<Record<string, Partial<T>>>({});
  const [removed, setRemoved] = useState<Record<string, true>>({});

  const items = useMemo(
    () =>
      [...added, ...seed]
        .filter((item) => !removed[keyOf(item)])
        .map((item) => (patched[keyOf(item)] ? { ...item, ...patched[keyOf(item)] } : item)),
    // `keyOf` is a stable function per call site; `seed` drives the recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [added, seed, patched, removed],
  );

  const nameFor = (item: T | undefined): string => (item && nameOf?.(item)) || noun || 'item';

  return {
    items,
    patch: (key, changes, message) => {
      setPatched((current) => ({ ...current, [key]: { ...current[key], ...changes } }));
      const item = items.find((candidate) => keyOf(candidate) === key);
      notify(message ?? `Updated ${nameFor(item)}`);
    },
    // A rename is a patch of the one field every named record shares.
    rename: (key, name, label) => {
      setPatched((current) => ({ ...current, [key]: { ...current[key], name } as Partial<T> }));
      notify(label ? `Renamed “${label}” to “${name}”` : `Renamed to “${name}”`);
    },
    remove: (key, label) => {
      const item = items.find((candidate) => keyOf(candidate) === key);
      setRemoved((current) => ({ ...current, [key]: true }));
      notify(`Removed “${label ?? nameFor(item)}”`, {
        // The edit is a flag in memory, so putting the row back is exact.
        action: {
          label: 'Undo',
          onClick: () =>
            setRemoved((current) => {
              const next = { ...current };
              delete next[key];
              return next;
            }),
        },
      });
    },
    add: (item, label) => {
      setAdded((current) => [item, ...current]);
      notify(`Created “${label ?? nameFor(item)}”`, { tone: 'success' });
    },
  };
}
