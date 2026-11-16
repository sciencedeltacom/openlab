/**
 * Search plus facets over a list.
 *
 * Ten views build the same control: a search field, a popover of faceted
 * check-lists, a count of what is narrowing the list, a clear. The filtering
 * rule is the same everywhere — a needle narrows the rows, values are ORed
 * within one facet and ANDed across facets — so it lives here and each view
 * keeps only the markup that draws its own marks.
 */

import { useCallback, useMemo, useState } from 'react';

/** One dimension a list can be narrowed by. */
export interface FacetDef<T> {
  /** Stable identity, e.g. `"kind"`. */
  id: string;
  /**
   * The values one item belongs to in this facet.
   *
   * An array because a row can fall in more than one bucket: a 2 GB file is
   * both "large" and, under a different facet, whatever its kind says.
   */
  valuesOf: (item: T) => readonly string[];
}

/** What a facet filter needs to know about its list. */
export interface FacetFilterOptions<T> {
  facets: readonly FacetDef<T>[];
  /** The text a search matches. Omit to leave the list unfiltered by text. */
  searchOf?: (item: T) => string;
  /**
   * A controlled needle. When given, the caller owns the search field — the debounced
   * value can be handed in while the input draws the immediate one.
   */
  query?: string;
}

/** The narrowing state, returned to the view that draws it. */
export interface FacetFilter<T> {
  /** The search-matched, facet-matched rows. */
  rows: T[];
  query: string;
  setQuery: (value: string) => void;
  /** How many search-matched rows carry each value, for a facet row's badge. */
  counts: Record<string, Record<string, number>>;
  isOn: (facetId: string, value: string) => boolean;
  /** Flip one value in a multi-select facet. */
  toggle: (facetId: string, value: string) => void;
  /** Set one facet to a single value, or clear it. */
  setOnly: (facetId: string, value: string | null) => void;
  /** Back to everything. */
  clear: () => void;
  /** How many values are narrowing the list, for the filter button's badge. */
  activeCount: number;
}

/** Filter `items` by a search needle and any number of facets. */
export function useFacetFilter<T>(items: readonly T[], options: FacetFilterOptions<T>): FacetFilter<T> {
  const { facets, searchOf, query: controlledQuery } = options;
  const [internalQuery, setInternalQuery] = useState('');
  const query = controlledQuery ?? internalQuery;
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  const searchMatched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !searchOf) return items;
    return items.filter((item) => searchOf(item).toLowerCase().includes(needle));
  }, [items, query, searchOf]);

  const rows = useMemo(
    () =>
      searchMatched.filter((item) =>
        facets.every((facet) => {
          const on = selected[facet.id];
          return !on || on.size === 0 || facet.valuesOf(item).some((value) => on.has(value));
        }),
      ),
    [searchMatched, facets, selected],
  );

  const counts = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const facet of facets) {
      const perValue: Record<string, number> = {};
      for (const item of searchMatched) {
        for (const value of facet.valuesOf(item)) {
          perValue[value] = (perValue[value] ?? 0) + 1;
        }
      }
      result[facet.id] = perValue;
    }
    return result;
  }, [facets, searchMatched]);

  const toggle = useCallback((facetId: string, value: string) => {
    setSelected((current) => {
      const next = new Set(current[facetId] ?? []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...current, [facetId]: next };
    });
  }, []);

  const setOnly = useCallback((facetId: string, value: string | null) => {
    setSelected((current) => ({ ...current, [facetId]: new Set(value ? [value] : []) }));
  }, []);

  const clear = useCallback(() => setSelected({}), []);
  const isOn = useCallback(
    (facetId: string, value: string) => Boolean(selected[facetId]?.has(value)),
    [selected],
  );
  const activeCount = useMemo(
    () => Object.values(selected).reduce((sum, set) => sum + set.size, 0),
    [selected],
  );

  return { rows, query, setQuery: setInternalQuery, counts, isOn, toggle, setOnly, clear, activeCount };
}
