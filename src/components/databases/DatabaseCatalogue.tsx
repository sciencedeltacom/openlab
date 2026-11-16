/**
 * The database catalogue.
 *
 * Grouped by family, because a reader looking for a structure archive is not looking for a
 * citation index. Each card carries the database's own icon and tint, what it is for, what
 * it holds, how it is reached and whether it is ready — the four questions a reader asks
 * before opening a connection page.
 */

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Cloud, Filter, Lock, Plug, Plus, Search, X, type LucideIcon } from 'lucide-react';

import { Button, Chip, Input, Popover, ScrollShadow, SectionLabel, Tabs } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import { paths } from '@/app/routes';
import { MOTION } from '@/theme/tokens';
import { FacetRow } from '../compute/Facets';
import { DatabaseMark, DatabaseStateMark } from './Marks';
import { useDatabases } from './store';
import { DATABASE_STATE, databaseFamilies, type Database, type DatabaseState } from './data';

/** The icon and tint an access model wears in the filter and on the card. */
const ACCESS_META: Record<string, { icon: LucideIcon; tint: string }> = {
  Open: { icon: Cloud, tint: 'bg-success/15 text-success' },
  'API key': { icon: Plug, tint: 'bg-warning/15 text-warning' },
  'Bearer token': { icon: Lock, tint: 'bg-danger/15 text-danger' },
};

const FACETS = ['family', 'access', 'state'] as const;
type Facet = (typeof FACETS)[number];

const FACET_LABEL: Record<Facet, string> = { family: 'Family', access: 'Access', state: 'State' };

/** One database card. The whole card opens its record page. */
function DatabaseCard({ database, index }: { database: Database; index: number }) {
  const { dispatch } = useApp();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: MOTION.duration.panel,
        ease: MOTION.signature,
        delay: Math.min(index, 8) * 0.03,
      }}
    >
      <button
        type="button"
        onClick={() => dispatch({ type: 'route/go', route: paths.database(database.id) })}
        className="flex h-full w-full flex-col gap-3 rounded-2xl bg-surface p-4 text-left transition-colors hover:bg-surface-tertiary"
      >
        <div className="flex items-start gap-3">
          <DatabaseMark database={database} className="size-9 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body text-foreground">{database.name}</span>
            <span className="truncate text-meta text-muted">{database.family}</span>
          </div>
          <DatabaseStateMark state={database.state} />
        </div>

        <p className="line-clamp-2 text-meta text-muted">{database.purpose}</p>

        <div className="mt-auto flex flex-wrap gap-1.5">
          <Chip size="sm" variant="soft" color="default">
            {database.recordCount}
          </Chip>
          <Chip size="sm" variant="soft" color="default">
            {database.access}
          </Chip>
        </div>
      </button>
    </motion.div>
  );
}

/** The database catalogue, grouped by family. */
export function DatabaseCatalogue() {
  const { dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<Facet>('family');
  const [familyFilter, setFamilyFilter] = useState<string | null>(null);
  const [accessFilter, setAccessFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<DatabaseState | null>(null);

  const databases = useDatabases();
  const families = databaseFamilies(databases);
  const accessModels = Array.from(new Set(databases.map((database) => database.access)));
  const states = Object.keys(DATABASE_STATE) as DatabaseState[];
  const activeCount = (familyFilter ? 1 : 0) + (accessFilter ? 1 : 0) + (stateFilter ? 1 : 0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return databases.filter((database) => {
      if (familyFilter && database.family !== familyFilter) return false;
      if (accessFilter && database.access !== accessFilter) return false;
      if (stateFilter && database.state !== stateFilter) return false;
      if (!needle) return true;
      return [database.name, database.family, database.purpose, database.holds, database.access]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [databases, query, familyFilter, accessFilter, stateFilter]);

  const groups = useMemo(
    () =>
      families
        .map((family) => ({ family, databases: filtered.filter((database) => database.family === family) }))
        .filter((group) => group.databases.length > 0),
    [families, filtered],
  );

  return (
    <ScrollShadow className="h-full min-h-0">
      <div className="flex w-full flex-col gap-4 px-7 py-7">
        <div className="flex flex-wrap items-start gap-2">
          <p className="max-w-[80ch] text-body text-muted">
            Public archives the workbench can query. Each keeps the connection, the request and the response.
          </p>
          <Button
            variant="primary"
            className="ml-auto shrink-0 gap-1.5"
            onPress={() => dispatch({ type: 'route/go', route: 'library/databases/new' })}
          >
            <Plus className="size-3.5" />
            Create database
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search databases, families, what they hold"
              aria-label="Search databases"
              className="w-full pl-9"
            />
          </div>

          <Popover
            trigger={
              <Button size="sm" variant={activeCount ? 'secondary' : 'ghost'} className="gap-1.5">
                <Filter className="size-3.5" />
                Filter
                {activeCount > 0 && <Chip size="sm">{activeCount}</Chip>}
              </Button>
            }
            className="w-[280px]"
          >
            <Tabs selectedKey={facet} onSelectionChange={(key) => setFacet(key as Facet)}>
              <Tabs.ListContainer className="mx-1 mt-1">
                <Tabs.List aria-label="Filter databases">
                  {FACETS.map((id) => (
                    <Tabs.Tab key={id} id={id}>
                      {FACET_LABEL[id]}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>

              <Tabs.Panel id="family">
                <ScrollShadow className="max-h-[320px] px-1">
                  {families.map((family) => {
                    const representative = databases.find((database) => database.family === family);
                    return (
                      <FacetRow
                        key={family}
                        on={familyFilter === family}
                        mark={representative ? <DatabaseMark database={representative} /> : undefined}
                        label={family}
                        onPress={() => setFamilyFilter(familyFilter === family ? null : family)}
                      />
                    );
                  })}
                </ScrollShadow>
              </Tabs.Panel>

              <Tabs.Panel id="access">
                <ScrollShadow className="max-h-[320px] px-1">
                  {accessModels.map((access) => {
                    const meta = ACCESS_META[access] ?? ACCESS_META.Open;
                    const Icon = meta.icon;
                    return (
                      <FacetRow
                        key={access}
                        on={accessFilter === access}
                        mark={
                          <span
                            className={cn('grid size-5 shrink-0 place-items-center rounded-md', meta.tint)}
                          >
                            <Icon className="size-3.5" aria-hidden />
                          </span>
                        }
                        label={access}
                        onPress={() => setAccessFilter(accessFilter === access ? null : access)}
                      />
                    );
                  })}
                </ScrollShadow>
              </Tabs.Panel>

              <Tabs.Panel id="state">
                <ScrollShadow className="max-h-[320px] px-1">
                  {states.map((state) => (
                    <FacetRow
                      key={state}
                      on={stateFilter === state}
                      mark={<DatabaseStateMark state={state} />}
                      label={DATABASE_STATE[state].label}
                      onPress={() => setStateFilter(stateFilter === state ? null : state)}
                    />
                  ))}
                </ScrollShadow>
              </Tabs.Panel>
            </Tabs>

            <footer className="flex items-center gap-2 px-2 pb-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                isDisabled={activeCount === 0}
                onPress={() => {
                  setFamilyFilter(null);
                  setAccessFilter(null);
                  setStateFilter(null);
                }}
                className="gap-1.5"
              >
                <X className="size-3.5" />
                Clear all
              </Button>
              {activeCount > 0 && (
                <span className="ml-auto text-meta tabular-nums text-muted">{activeCount} selected</span>
              )}
            </footer>
          </Popover>

          <span className="ml-auto text-meta tabular-nums text-muted">
            {filtered.length} of {databases.length} databases
          </span>
        </div>

        {filtered.length === 0 && (
          <div className="grid place-items-center rounded-3xl bg-surface px-6 py-16 text-center">
            <div>
              <Search className="mx-auto size-5 text-muted" aria-hidden />
              <p className="mt-2 text-body text-muted">No database matches the current filter.</p>
            </div>
          </div>
        )}

        {groups.map((group) => {
          const representative = databases.find((database) => database.family === group.family);
          return (
            <section key={group.family} className="mt-2 first:mt-0">
              <header className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur">
                {representative && <DatabaseMark database={representative} />}
                <SectionLabel>{group.family}</SectionLabel>
                <span className="text-meta tabular-nums text-muted">{group.databases.length}</span>
              </header>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {group.databases.map((database, index) => (
                  <DatabaseCard key={database.id} database={database} index={index} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </ScrollShadow>
  );
}
