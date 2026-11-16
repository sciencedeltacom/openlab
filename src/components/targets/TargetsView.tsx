/**
 * The target list, rebuilt as readiness-grouped cards.
 *
 * A target is not a row of settings; it is a machine with a capacity, an allocation and a
 * list of what it still needs. The card carries all four at a glance and groups by whether
 * the target can take a job right now, so "why can I not run this" is answered before the
 * page is opened.
 */

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CircleAlert,
  ExternalLink,
  Filter,
  Pencil,
  PlugZap,
  Plus,
  Power,
  PowerOff,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';

import { Button, Chip, Input, Meter, Popover, ScrollShadow, SectionLabel, Tabs } from '@/components/ui';
import { RenameModal, RowMenu, type RowAction } from '@/components/common/RowMenu';
import { useFacetFilter, type FacetDef } from '@/hooks/useFacetFilter';
import { useTargetCheck, useTargets } from '@/hooks/useCompute';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import { paths } from '@/app/routes';
import { MOTION } from '@/theme/tokens';
import { FacetRow } from '../compute/Facets';
import { ReadinessMark, TargetKindMark } from '../compute/Marks';
import {
  READINESS_META,
  READINESS_ORDER,
  TARGET_KIND_META,
  type Readiness,
  type Target,
  type TargetKind,
} from '../compute/data';

/** The meter's tone by how full the allocation is. */
function usageTone(used: number, total: number): 'accent' | 'warning' | 'danger' {
  const ratio = total > 0 ? used / total : 0;
  if (ratio >= 0.9) return 'danger';
  if (ratio >= 0.75) return 'warning';
  return 'accent';
}

/** The capacity line, as chips a reader can scan. */
function capacityChips(target: Target): string[] {
  const chips = [`${target.cores} cores`, `${target.memoryGb} GB`];
  if (target.gpus) chips.push(target.gpus);
  return chips;
}

/** One target card. Clicking opens the target's own page. */
function TargetCard({ target, index, actions }: { target: Target; index: number; actions: RowAction[] }) {
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
      className="group relative"
    >
      <button
        type="button"
        onClick={() => dispatch({ type: 'route/go', route: paths.target(target.id) })}
        className="flex h-full w-full flex-col gap-3 rounded-2xl bg-surface p-4 pr-10 text-left transition-colors hover:bg-surface-tertiary"
      >
        <div className="flex items-start gap-3">
          <TargetKindMark kind={target.kind} className="size-9 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body text-foreground">{target.name}</span>
            <span className="truncate text-meta text-muted">
              {TARGET_KIND_META[target.kind].label} · {target.host}
            </span>
          </div>
          <Chip
            size="sm"
            variant="soft"
            color={
              target.readiness === 'ready'
                ? 'success'
                : target.readiness === 'needs-setup'
                  ? 'warning'
                  : 'default'
            }
          >
            {READINESS_META[target.readiness].label}
          </Chip>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {capacityChips(target).map((chip) => (
            <Chip key={chip} size="sm" variant="soft" color="default">
              {chip}
            </Chip>
          ))}
        </div>

        {target.allocation ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-meta">
              <span className="text-muted">Allocation in use</span>
              <span className="tabular-nums text-foreground">
                {target.allocation.used.toLocaleString('en-US')} /{' '}
                {target.allocation.total.toLocaleString('en-US')} {target.allocation.unit}
              </span>
            </div>
            <Meter
              value={target.allocation.used}
              maxValue={target.allocation.total}
              color={usageTone(target.allocation.used, target.allocation.total)}
              size="sm"
              aria-label={`${target.name} allocation in use`}
              className="w-full"
            >
              <Meter.Track>
                <Meter.Fill />
              </Meter.Track>
            </Meter>
          </div>
        ) : (
          <p className="text-meta text-muted">No fixed allocation; billed per run.</p>
        )}

        <div className="mt-auto flex items-center gap-2 text-meta text-muted">
          {target.needs.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5 text-warning">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{target.needs[0]}</span>
              {target.needs.length > 1 && <span className="shrink-0">+{target.needs.length - 1}</span>}
            </span>
          ) : (
            <span className="truncate text-success">Ready to run</span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
            <Server className="size-3" aria-hidden />
            {target.recentJobs.length} jobs
          </span>
        </div>
      </button>
      <div className="absolute right-2 top-2 z-10">
        <RowMenu label={`Actions for ${target.name}`} actions={actions} />
      </div>
    </motion.div>
  );
}

const FACETS = ['kind', 'readiness'] as const;
type Facet = (typeof FACETS)[number];

const FACET_LABEL: Record<Facet, string> = { kind: 'Kind', readiness: 'Readiness' };

/** The facets the list narrows by, defined once so the filter state is stable across renders. */
const TARGET_FACETS: FacetDef<Target>[] = [
  { id: 'kind', valuesOf: (target) => [target.kind] },
  { id: 'readiness', valuesOf: (target) => [target.readiness] },
];

/** The text a target search matches. */
function searchText(target: Target): string {
  return [target.name, target.host, target.summary, ...target.credentials].join(' ');
}

/** The kinds a target can be, in the order the meta declares them. */
const KINDS = Object.keys(TARGET_KIND_META) as TargetKind[];

/** The targets list, grouped by readiness. */
export function TargetsView() {
  const { dispatch } = useApp();
  const edits = useTargets();
  const targets = edits.items;
  const [facet, setFacet] = useState<Facet>('kind');
  const [renameTarget, setRenameTarget] = useState<Target | null>(null);

  /** The connection check, run for real through the adapter's own command. */
  const checker = useTargetCheck();

  /** The actions a target card offers. */
  const actionsFor = (target: Target): RowAction[] => {
    const ready = target.readiness === 'ready';
    return [
      {
        id: 'open',
        label: 'View details',
        icon: ExternalLink,
        onSelect: () => dispatch({ type: 'route/go', route: paths.target(target.id) }),
      },
      { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setRenameTarget(target) },
      {
        id: 'toggle',
        label: ready ? 'Disable' : 'Enable',
        icon: ready ? PowerOff : Power,
        onSelect: () =>
          edits.patch(
            target.id,
            {
              readiness: ready ? 'needs-setup' : 'ready',
              needs: ready ? ['A successful connection check'] : [],
            },
            `${ready ? 'Disabled' : 'Enabled'} “${target.name}”`,
          ),
      },
      {
        id: 'test',
        label: checker.busyId === target.id ? 'Testing…' : 'Test connection',
        icon: PlugZap,
        onSelect: () => void checker.check(target),
      },
      {
        id: 'remove',
        label: 'Remove',
        icon: Trash2,
        danger: true,
        onSelect: () => edits.remove(target.id, target.name),
      },
    ];
  };

  const filter = useFacetFilter(targets, { facets: TARGET_FACETS, searchOf: searchText });
  const filtered = filter.rows;
  const activeCount = filter.activeCount;

  const groups = useMemo(
    () =>
      READINESS_ORDER.map((readiness) => ({
        readiness,
        targets: filtered.filter((target) => target.readiness === readiness),
      })).filter((group) => group.targets.length > 0),
    [filtered],
  );

  return (
    <ScrollShadow className="h-full min-h-0">
      <div className="mx-auto flex w-full flex-col gap-4 px-6 py-6">
        <p className="text-body text-muted">
          {targets.length} targets, one job spec. A target is available when it answers with the tool at the
          declared version.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted" />
            <Input
              type="search"
              value={filter.query}
              onChange={(event) => filter.setQuery(event.target.value)}
              placeholder="Search targets, hosts, credentials…"
              aria-label="Search targets"
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
                <Tabs.List aria-label="Filter targets by">
                  {FACETS.map((id) => (
                    <Tabs.Tab key={id} id={id}>
                      {FACET_LABEL[id]}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>

              <Tabs.Panel id="kind">
                <ScrollShadow className="max-h-[320px] px-1">
                  {KINDS.map((kind) => (
                    <FacetRow
                      key={kind}
                      on={filter.isOn('kind', kind)}
                      mark={<TargetKindMark kind={kind} />}
                      label={TARGET_KIND_META[kind].label}
                      onPress={() => filter.setOnly('kind', filter.isOn('kind', kind) ? null : kind)}
                    />
                  ))}
                </ScrollShadow>
              </Tabs.Panel>

              <Tabs.Panel id="readiness">
                <ScrollShadow className="max-h-[320px] px-1">
                  {READINESS_ORDER.map((readiness) => (
                    <FacetRow
                      key={readiness}
                      on={filter.isOn('readiness', readiness)}
                      mark={<ReadinessMark readiness={readiness} />}
                      label={READINESS_META[readiness].heading}
                      onPress={() =>
                        filter.setOnly('readiness', filter.isOn('readiness', readiness) ? null : readiness)
                      }
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
                onPress={filter.clear}
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

          <div className="ml-auto">
            <Button
              size="sm"
              variant="primary"
              className="gap-1.5"
              onPress={() => dispatch({ type: 'route/go', route: 'compute/targets/new' })}
            >
              <Plus className="size-3.5" />
              Add target
            </Button>
          </div>
        </div>

        <RenameModal
          open={renameTarget !== null}
          title="Rename target"
          value={renameTarget?.name ?? ''}
          onClose={() => setRenameTarget(null)}
          onSubmit={(name) => {
            if (renameTarget) edits.rename(renameTarget.id, name, renameTarget.name);
          }}
        />

        {filtered.length === 0 && (
          <div className="grid place-items-center rounded-3xl bg-surface px-6 py-16 text-center">
            <div>
              <Search className="mx-auto size-5 text-muted" aria-hidden />
              <p className="mt-2 text-body text-muted">No target matches the current filter.</p>
            </div>
          </div>
        )}

        {groups.map((group) => {
          const meta = READINESS_META[group.readiness];
          const Icon = meta.icon;
          return (
            <section key={group.readiness} className="mt-2 first:mt-0">
              <header className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur">
                <span
                  className={cn('flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label', meta.chip)}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {meta.heading}
                </span>
                <span className="text-meta tabular-nums text-muted">{group.targets.length}</span>
              </header>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {group.targets.map((target, index) => (
                  <TargetCard key={target.id} target={target} index={index} actions={actionsFor(target)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </ScrollShadow>
  );
}
