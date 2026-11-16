/**
 * The tracker's controls, in the application's top bar.
 *
 * They used to be a strip inside the page, which meant the page had two headers stacked on
 * top of each other and the controls moved every time you changed section. Here they sit
 * where a toolbar belongs, next to the search field, and they are the same four controls on
 * every tracker page.
 *
 * The filter and view menus were flat lists, and the filter list had grown to twenty-six
 * bare rows. Each is now a popover with tabs: one facet per tab, five to seven rows each,
 * so the list can be read instead of scrolled past. A long facet offers to expand in place;
 * it is not paginated, because a picker wants calm, not chrome.
 */

import { Fragment, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  Filter,
  LayoutList,
  Plus,
  Rows3,
  Settings2,
  X,
  Zap,
} from 'lucide-react';

import {
  Button,
  Chip,
  IconButton,
  Popover,
  ScrollShadow,
  Tabs,
  Tip,
  ToggleButton,
  ToggleButtonGroup,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { pathFor } from '@/app/routes';
import { useApp } from '@/store/app';
import {
  KIND_META,
  PRIORITY_META,
  STATUS_META,
  TASK_KINDS,
  WORK_STATUSES,
  memberById,
  newTask,
  type SavedView,
  type TaskFilter,
  type TaskKind,
  type WorkStatus,
} from '@/store/research';
import { MemberAvatar, PRIORITY_MARK, type GroupBy, type SortBy } from '@/components/research/shared';

const LAYOUTS = [
  { id: 'list', label: 'List', icon: LayoutList },
  { id: 'board', label: 'Board', icon: Rows3 },
  { id: 'timeline', label: 'Timeline', icon: Zap },
] as const;

/** The filter's facets, one tab each. */
const FACETS = ['status', 'kind', 'priority', 'person'] as const;
type Facet = (typeof FACETS)[number];

const FACET_LABEL: Record<Facet, string> = {
  status: 'Status',
  kind: 'Kind',
  priority: 'Priority',
  person: 'Person',
};

/** The views popover's panes. */
const VIEW_PANES = ['views', 'group', 'sort'] as const;
type ViewPane = (typeof VIEW_PANES)[number];

const VIEW_PANE_LABEL: Record<ViewPane, string> = {
  views: 'Views',
  group: 'Group',
  sort: 'Sort',
};

const GROUPINGS: readonly GroupBy[] = ['status', 'assignee', 'priority', 'kind', 'none'];
const SORTS: readonly SortBy[] = ['priority', 'updated', 'due', 'key'];
const PRIORITIES = [4, 3, 2, 1, 0] as const;

/** Rows a facet shows before it offers to expand. */
const FACET_PAGE = 8;

/* ================================================================================================
 * Rows
 * ============================================================================================== */

/** The checkbox-like mark that says whether a row is on. Tone, not a border. */
function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded',
        on ? 'bg-accent text-accent-foreground' : 'bg-surface-tertiary',
      )}
      aria-hidden
    >
      {on && <Check className="size-3" />}
    </span>
  );
}

/** One pressable pick in a facet: its own mark, a label, and whether it is on. */
function FacetRow({
  on,
  mark,
  label,
  onPress,
}: {
  on: boolean;
  mark?: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface',
        on && 'bg-surface',
      )}
    >
      {mark}
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{label}</span>
      <CheckMark on={on} />
    </button>
  );
}

/**
 * A facet's rows, capped so a long list stays scannable.
 *
 * Past {@link FACET_PAGE} rows the rest collapses into one "Show all" row that expands in
 * place. A pager would put chrome in a picker; an expanding row just reveals the rest.
 */
function FacetRows<T>({
  items,
  itemKey,
  render,
}: {
  items: readonly T[];
  itemKey: (item: T) => string;
  render: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, FACET_PAGE);
  return (
    <>
      {shown.map((item) => (
        <Fragment key={itemKey(item)}>{render(item)}</Fragment>
      ))}
      {!expanded && items.length > FACET_PAGE && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full rounded-lg px-2 py-1.5 text-left text-meta text-muted transition-colors hover:bg-surface"
        >
          Show all {items.length}
        </button>
      )}
    </>
  );
}

/** A row that goes somewhere rather than toggling: an icon and a label. */
function ActionRow({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-body text-foreground transition-colors hover:bg-surface"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/* ================================================================================================
 * Marks
 * ============================================================================================== */

/** A status's icon on its tint, as a facet row and a record control both draw it. */
function StatusMark({ status }: { status: WorkStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-md', meta.chip)}>
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/** A kind's icon in its tone, as a facet row draws it. */
function KindMark({ kind }: { kind: TaskKind }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <span className="grid size-5 shrink-0 place-items-center">
      <Icon className={cn('size-4', meta.tone)} aria-hidden />
    </span>
  );
}

/** A priority's icon on its tint, as a facet row draws it. */
function PriorityMark({ priority }: { priority: number }) {
  const mark = PRIORITY_MARK[priority] ?? PRIORITY_MARK[0];
  const Icon = mark.icon;
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-md', mark.chip)}>
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/** The layout a saved view carries, as a facet row mark. */
function LayoutMark({ layout }: { layout: SavedView['layout'] }) {
  const entry = LAYOUTS.find((candidate) => candidate.id === layout) ?? LAYOUTS[0];
  const Icon = entry.icon;
  return (
    <span className="grid size-5 shrink-0 place-items-center">
      <Icon className="size-4 text-muted" aria-hidden />
    </span>
  );
}

/** `none` and the bare enum names, capitalised for a row. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* ================================================================================================
 * The toolbar
 * ============================================================================================== */

/** Filter, grouping and sort for the tracker. */
export function ResearchToolbar() {
  const { state, dispatch } = useApp();
  const filter = state.taskFilter;
  const activeView = state.views.find((view) => view.id === state.activeViewId);
  const [facet, setFacet] = useState<Facet>('status');
  const [pane, setPane] = useState<ViewPane>('views');

  /** How many facets are narrowing the list, for the filter button's badge. */
  const activeCount =
    (filter.status?.length ?? 0) +
    (filter.kind?.length ?? 0) +
    (filter.priority?.length ?? 0) +
    (filter.assigneeId?.length ?? 0) +
    (filter.label?.length ?? 0) +
    (filter.waveId?.length ?? 0) +
    (filter.overdue ? 1 : 0);

  /** The same count, limited to what the filter popover can clear. */
  const facetCount =
    (filter.status?.length ?? 0) +
    (filter.kind?.length ?? 0) +
    (filter.priority?.length ?? 0) +
    (filter.assigneeId?.length ?? 0) +
    (filter.overdue ? 1 : 0);

  const toggleIn = <T extends string | number>(list: T[] | undefined, value: T): T[] | undefined => {
    const current = list ?? [];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    return next.length ? next : undefined;
  };

  const set = (patch: Partial<TaskFilter>) =>
    dispatch({ type: 'task/filter', filter: { ...filter, ...patch } });

  const clearAll = () => dispatch({ type: 'task/filter', filter: {} });

  const applyView = (view: SavedView) => {
    if (state.activeViewId === view.id) {
      dispatch({ type: 'view/apply', viewId: null, filter: {} });
    } else {
      dispatch({ type: 'view/apply', viewId: view.id, filter: view.filters, layout: view.layout });
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-4 pb-1 pt-3">
      <Button
        size="sm"
        variant="primary"
        className="gap-1.5"
        onPress={() => {
          const task = newTask(state.tasks);
          dispatch({ type: 'task/create', task });
          dispatch({ type: 'route/go', route: pathFor('research/tasks/:taskId', { taskId: task.id }) });
        }}
      >
        <Plus className="size-3.5" />
        New task
      </Button>

      <ToggleButtonGroup
        aria-label="Layout"
        selectionMode="single"
        selectedKeys={[state.taskLayout]}
        onSelectionChange={(keys) => {
          const [next] = keys as Set<string>;
          if (next) dispatch({ type: 'task/layout', layout: next as 'list' | 'board' | 'timeline' });
        }}
      >
        {LAYOUTS.map(({ id, label, icon: Icon }) => (
          <ToggleButton key={id} id={id} aria-label={label}>
            <Icon className="size-3.5" />
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

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
            <Tabs.List aria-label="Filter by">
              {FACETS.map((id) => (
                <Tabs.Tab key={id} id={id}>
                  {FACET_LABEL[id]}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="status">
            <ScrollShadow className="max-h-[320px] px-1">
              <FacetRows
                items={WORK_STATUSES}
                itemKey={(status) => status}
                render={(status) => (
                  <FacetRow
                    on={filter.status?.includes(status) ?? false}
                    mark={<StatusMark status={status} />}
                    label={STATUS_META[status].label}
                    onPress={() => set({ status: toggleIn(filter.status, status) })}
                  />
                )}
              />
              <FacetRow
                on={Boolean(filter.overdue)}
                mark={
                  <span className="grid size-5 shrink-0 place-items-center rounded-md bg-danger/15 text-danger">
                    <AlertTriangle className="size-3.5" aria-hidden />
                  </span>
                }
                label="Overdue only"
                onPress={() => set({ overdue: !filter.overdue })}
              />
            </ScrollShadow>
          </Tabs.Panel>

          <Tabs.Panel id="kind">
            <ScrollShadow className="max-h-[320px] px-1">
              <FacetRows
                items={TASK_KINDS}
                itemKey={(kind) => kind}
                render={(kind) => (
                  <FacetRow
                    on={filter.kind?.includes(kind) ?? false}
                    mark={<KindMark kind={kind} />}
                    label={KIND_META[kind].label}
                    onPress={() => set({ kind: toggleIn(filter.kind, kind) })}
                  />
                )}
              />
            </ScrollShadow>
          </Tabs.Panel>

          <Tabs.Panel id="priority">
            <ScrollShadow className="max-h-[320px] px-1">
              <FacetRows
                items={PRIORITIES}
                itemKey={(priority) => String(priority)}
                render={(priority) => (
                  <FacetRow
                    on={filter.priority?.includes(priority) ?? false}
                    mark={<PriorityMark priority={priority} />}
                    label={PRIORITY_META[priority].label}
                    onPress={() => set({ priority: toggleIn(filter.priority, priority) })}
                  />
                )}
              />
            </ScrollShadow>
          </Tabs.Panel>

          <Tabs.Panel id="person">
            <ScrollShadow className="max-h-[320px] px-1">
              <FacetRows
                items={state.members}
                itemKey={(member) => member.id}
                render={(member) => (
                  <FacetRow
                    on={filter.assigneeId?.includes(member.id) ?? false}
                    mark={<MemberAvatar id={member.id} />}
                    label={member.name}
                    onPress={() => set({ assigneeId: toggleIn(filter.assigneeId, member.id) })}
                  />
                )}
              />
            </ScrollShadow>
          </Tabs.Panel>
        </Tabs>

        <footer className="flex items-center gap-2 px-2 pb-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            isDisabled={facetCount === 0}
            onPress={clearAll}
            className="gap-1.5"
          >
            <X className="size-3.5" />
            Clear all
          </Button>
          {facetCount > 0 && (
            <span className="ml-auto text-meta tabular-nums text-muted">{facetCount} selected</span>
          )}
        </footer>
      </Popover>

      <Popover
        trigger={
          <Button size="sm" variant={activeView ? 'secondary' : 'ghost'} className="gap-1.5">
            <ArrowDownUp className="size-3.5" />
            {activeView ? activeView.name : 'Views'}
          </Button>
        }
        className="w-[280px]"
      >
        <Tabs selectedKey={pane} onSelectionChange={(key) => setPane(key as ViewPane)}>
          <Tabs.ListContainer className="mx-1 mt-1">
            <Tabs.List aria-label="Views, grouping and sort">
              {VIEW_PANES.map((id) => (
                <Tabs.Tab key={id} id={id}>
                  {VIEW_PANE_LABEL[id]}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="views">
            <ScrollShadow className="max-h-[320px] px-1">
              {state.views.map((view) => (
                <FacetRow
                  key={view.id}
                  on={state.activeViewId === view.id}
                  mark={<LayoutMark layout={view.layout} />}
                  label={view.name}
                  onPress={() => applyView(view)}
                />
              ))}
              <ActionRow
                icon={<Settings2 className="size-4 text-muted" aria-hidden />}
                label="Manage views"
                onPress={() => dispatch({ type: 'route/go', route: 'research/views' })}
              />
            </ScrollShadow>
          </Tabs.Panel>

          <Tabs.Panel id="group">
            <ScrollShadow className="max-h-[320px] px-1">
              {GROUPINGS.map((group) => (
                <FacetRow
                  key={group}
                  on={state.taskGroupBy === group}
                  label={group === 'none' ? 'None' : titleCase(group)}
                  onPress={() => dispatch({ type: 'task/group', groupBy: group })}
                />
              ))}
            </ScrollShadow>
          </Tabs.Panel>

          <Tabs.Panel id="sort">
            <ScrollShadow className="max-h-[320px] px-1">
              {SORTS.map((sort) => (
                <FacetRow
                  key={sort}
                  on={state.taskSort === sort}
                  label={titleCase(sort)}
                  onPress={() => dispatch({ type: 'task/sort', sort })}
                />
              ))}
            </ScrollShadow>
          </Tabs.Panel>
        </Tabs>
      </Popover>

      {activeCount > 0 && (
        <>
          {filter.assigneeId?.length === 1 && (
            <Chip size="sm" className="bg-surface text-meta text-muted">
              {memberById(state.members, filter.assigneeId[0])?.name}
            </Chip>
          )}
          <Tip content="Clear filters">
            <IconButton aria-label="Clear filters" onPress={clearAll}>
              <X />
            </IconButton>
          </Tip>
        </>
      )}
    </div>
  );
}
