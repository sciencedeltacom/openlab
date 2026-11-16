/**
 * The tab strip.
 *
 * The window's navigation, in one component and two directions: a strip across the top, or
 * the same strip in a column down the side (`vertical`). Everything else is identical — the
 * pinned pages, the open tabs, `+`, the wave, search and the appearance switch —
 * because the two are one system seen from two directions, and a second implementation would
 * be a second thing to keep in step.
 *
 * A record opens its own tab, which is what makes the system worth having: a task, the review
 * it came from and the figure it produced sit side by side, each one click away, instead of
 * replacing one another in a single pane. A tab is named after its record rather than its
 * kind — three tabs reading “Task” would be three tabs nobody can tell apart.
 *
 * Several tabs on one page fold into one group entry that opens where it stands, because the
 * thing the reader is choosing between is the files, not the fact that they are files.
 */

import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, Pencil, Plus, X, type LucideIcon } from 'lucide-react';

import { FIXED_PAGES, iconOf, isFile, titleOf } from '@/app/pages';
import { pageFor, type PageEntry } from '@/app/routes';
import { paths } from '@/app/routes';
import { groupTabs, type TabGroup } from '@/app/tabs';
import { Button, Chip, IconButton, ScrollShadow } from '@/components/ui';
import { DRAG_REGION } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { invokeCommand } from '@/lib/ipc';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import { currentWave, inboxUnread, waveDaysLeft } from '@/store/research';
import { MOTION } from '@/theme/tokens';
import { useTabTitles } from './useTabTitles';
import { OpenWithMenu } from '@/components/files/OpenWithMenu';
import { NewTabPopover } from './NewTabPopover';
import { SearchButton } from './SearchButton';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/**
 * One tab.
 *
 * A pinned tab cannot be closed; a record's can. A *file's* tab carries the file's own two
 * actions as well — open it elsewhere, rename it — because the page it opens is the editor
 * and nothing else: a header holding a name and two buttons costs a row of the document.
 *
 * Every control is a sibling of the label rather than a child: a button inside a button is
 * invalid, and the browser stops delivering its clicks. They are absolutely placed and
 * appear on hover, so a tab never shifts the ones beside it.
 */
function Tab({
  path,
  label,
  icon: Icon,
  badge,
  closable,
  vertical,
}: {
  path: string;
  label: string;
  icon: LucideIcon;
  badge?: ReactNode;
  closable?: boolean;
  vertical?: boolean;
}) {
  const { state, dispatch } = useApp();
  const active = state.route === path;
  const file = isFile(path);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label);
  const [error, setError] = useState<string | null>(null);

  /** The name is the file's own; renaming moves it and the tab follows. */
  const rename = async () => {
    const next = draft.trim();
    const root = activeProject(state)?.path ?? null;
    setRenaming(false);
    if (!root || !next || next === label || next.includes('/') || next.includes('\\')) {
      setDraft(label);
      setError(
        next && next !== label && (next.includes('/') || next.includes('\\'))
          ? 'No folders in a name.'
          : null,
      );
      return;
    }
    const folder = path.split('/').slice(0, -1).join('/');
    const to = folder ? `${folder}/${next}` : next;
    const result = await invokeCommand('rename_file', { from: path, to, root });
    if (!result.ok) {
      setError(result.error.message);
      setDraft(label);
      return;
    }
    dispatch({ type: 'tab/open', path: paths.file(to) });
    dispatch({ type: 'tab/close', path });
  };

  // A file's tab reserves room for three controls; every other tab only for its close.
  const trailing = file ? 'pe-14' : closable ? 'pe-4' : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={MOTION.spring}
      className={cn('group/tab relative flex items-center', vertical ? 'w-full' : 'shrink-0')}
    >
      {renaming ? (
        <input
          autoFocus
          value={draft}
          aria-label={`New name for ${label}`}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void rename();
            }
            if (event.key === 'Escape') {
              setDraft(label);
              setRenaming(false);
            }
          }}
          className={cn(
            'rounded-lg border border-border bg-surface px-2 text-body text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
            vertical ? 'h-8 w-full' : 'h-7 w-[160px]',
          )}
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          title={error ?? label}
          onMouseDown={(event) => {
            if (event.button === 1 && closable) {
              event.preventDefault();
              dispatch({ type: 'tab/close', path });
            }
          }}
          onClick={() => dispatch({ type: 'route/go', route: path })}
          className={cn(
            'relative flex items-center gap-1.5 rounded-lg border px-2 text-start',
            vertical ? 'h-8 w-full' : 'h-7 max-w-[200px]',
            active
              ? cn(
                  'border-transparent text-foreground',
                  vertical ? 'bg-surface-secondary' : 'border-border bg-surface',
                )
              : 'border-transparent text-muted hover:bg-surface-secondary hover:text-foreground',
          )}
        >
          {active && vertical && (
            <span className="absolute inset-y-2 start-0 w-[2px] rounded-full bg-accent" aria-hidden />
          )}
          <Icon className={cn('size-3.5 shrink-0', active && 'text-accent')} aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate text-body', trailing, active && 'font-medium')}>
            {label}
          </span>
          {badge}
        </button>
      )}

      {file && !renaming && (
        <>
          <span className="absolute end-9 opacity-0 transition-opacity group-hover/tab:opacity-100 focus-within:opacity-100">
            <OpenWithMenu path={path} />
          </span>
          <button
            type="button"
            aria-label={`Rename ${label}`}
            onClick={() => {
              setDraft(label);
              setRenaming(true);
            }}
            className="absolute end-5 grid size-4 place-items-center rounded text-muted opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-surface-tertiary hover:text-foreground focus-visible:opacity-100"
          >
            <Pencil className="size-3" aria-hidden />
          </button>
        </>
      )}

      {closable && !renaming && (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={() => dispatch({ type: 'tab/close', path })}
          className="absolute end-1 grid size-4 place-items-center rounded text-muted opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-surface-tertiary hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </motion.div>
  );
}

/**
 * A group of tabs on one page, as an accordion.
 *
 * Clicking it opens its tabs where they are — in the strip, or in the column — rather than
 * throwing a floating list over the work. A group is a fact about the tabs, so it is shown
 * next to them; a popover would be a second surface to read the same thing.
 *
 * The header is a row of siblings rather than one button: the count, the way to close the
 * whole group and the way to open it are three targets, and a button inside a button stops
 * delivering its own clicks. `Files (3)` is written as text because it is a name with a
 * number in it, not a value to be read off a chip.
 */
function GroupTab({
  group,
  vertical,
  labels,
}: {
  group: TabGroup;
  vertical?: boolean;
  labels: Map<string, string>;
}) {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const page = pageFor(group.parent);
  const Icon = iconOf(group.parent);
  const active = group.tabs.includes(state.route);
  const name = page?.label ?? titleOf(group.parent, labels);
  const title = `${name} (${group.tabs.length})`;
  const toggle = () => setOpen((current) => !current);

  return (
    <div className={cn('group/tab flex gap-1', vertical ? 'w-full flex-col' : 'shrink-0 items-center')}>
      <div
        className={cn(
          'flex items-center gap-1 rounded-lg border ps-2 pe-1',
          vertical ? 'h-8 w-full' : 'h-7 max-w-[200px]',
          active
            ? 'border-border bg-surface text-foreground'
            : 'border-transparent text-muted hover:bg-surface-secondary hover:text-foreground',
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${title}, expand`}
          title={title}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-body">{title}</span>
        </button>

        <button
          type="button"
          aria-label={`Close all ${group.tabs.length}`}
          onClick={() => dispatch({ type: 'tab/closeGroup', parent: group.parent })}
          className="grid size-4 shrink-0 place-items-center rounded text-muted opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-surface-tertiary hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" aria-hidden />
        </button>

        <button
          type="button"
          aria-label={open ? `${title}, collapse` : `${title}, expand`}
          onClick={toggle}
          className="grid size-4 shrink-0 place-items-center text-muted"
        >
          <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </div>

      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={MOTION.spring}
          className={cn('flex gap-1', vertical ? 'flex-col ps-3' : 'items-center')}
        >
          {group.tabs.map((path) => (
            <Tab
              key={path}
              path={path}
              label={titleOf(path, labels)}
              icon={iconOf(path)}
              vertical={vertical}
              closable
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}

/** The window's tabs, across the top or down the side. */
export function TabStrip({ vertical }: { vertical?: boolean } = {}) {
  const { state, dispatch } = useApp();
  const titles = useTabTitles();
  const [pickerOpen, setPickerOpen] = useState(false);

  const wave = currentWave(state.waves);
  const unread = inboxUnread(state.inbox);
  const runs = Object.keys(state.runs).length;

  /** What an open tab is called: the record's name, or the page's own while it is open. */
  const labelOf = (path: string) =>
    path === state.route && state.pageTitle ? state.pageTitle : titleOf(path, titles);

  const tabBadge = (page: PageEntry) => {
    const count = page.badge === 'inbox' ? unread : page.badge === 'runs' ? runs : 0;
    return count > 0 ? (
      <Chip color="accent" className="text-meta tabular-nums">
        {count}
      </Chip>
    ) : undefined;
  };

  /**
   * Arrow keys move between tabs, the way a tablist is expected to behave. Home and End jump
   * to the ends; the browser's default scroll is disabled so the page does not move instead.
   */
  const onTablistKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const order = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!order.includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    if (tabs.length === 0) return;
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    event.preventDefault();
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (forward ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.click();
  };

  const waveChip = wave && (
    <span
      title={`${wave.name}: ${wave.goal}`}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg bg-accent/10 px-2 py-1 text-meta',
        vertical && 'w-full justify-center',
      )}
    >
      <span className="tabular-nums text-accent">W{wave.number}</span>
      <span className="tabular-nums text-muted">
        {waveDaysLeft(wave) >= 0 ? `${waveDaysLeft(wave)} d` : `${-waveDaysLeft(wave)} d over`}
      </span>
    </span>
  );

  const tabs = (
    <>
      {FIXED_PAGES.map((page: PageEntry) => (
        <Tab
          key={page.path}
          path={page.path}
          label={page.label}
          icon={page.icon}
          badge={tabBadge(page)}
          vertical={vertical}
        />
      ))}

      {groupTabs(state.tabs).map((entry) =>
        entry.kind === 'group' ? (
          <GroupTab
            key={`group:${entry.group.parent}`}
            group={entry.group}
            vertical={vertical}
            labels={titles}
          />
        ) : (
          <Tab
            key={entry.path}
            path={entry.path}
            label={labelOf(entry.path)}
            icon={iconOf(entry.path)}
            vertical={vertical}
            closable
          />
        ),
      )}
    </>
  );

  const picker = <NewTabPopover open={pickerOpen} onOpenChange={setPickerOpen} vertical={vertical} />;

  if (vertical) {
    return (
      <aside
        {...DRAG_REGION}
        className="flex h-full w-[240px] shrink-0 flex-col bg-background"
        style={{ paddingTop: 'var(--titlebar-h)' }}
      >
        <header className="flex h-14 shrink-0 items-center px-2">
          <WorkspaceSwitcher />
        </header>

        <ScrollShadow className="min-h-0 flex-1 px-2 pb-2">
          <div
            role="tablist"
            aria-label="Open pages"
            className="flex flex-col gap-1"
            onKeyDown={onTablistKeyDown}
          >
            {tabs}
            {picker}
          </div>
        </ScrollShadow>

        <footer className="flex shrink-0 flex-col gap-2 p-2">
          {waveChip}
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <SearchButton full />
            </div>
            <div className="size-12 shrink-0 rounded-2xl bg-surface">
              <ThemeToggle fill />
            </div>
          </div>
        </footer>
      </aside>
    );
  }

  return (
    <div {...DRAG_REGION} className="flex h-11 shrink-0 items-center gap-1.5 bg-background ps-3 pe-3">
      <WorkspaceSwitcher compact />
      <div className="h-4 w-px shrink-0 bg-separator" aria-hidden />

      <ScrollShadow orientation="horizontal" className="min-w-0 flex-1">
        <div
          role="tablist"
          aria-label="Open pages"
          className="flex items-center gap-1"
          onKeyDown={onTablistKeyDown}
        >
          {tabs}
        </div>
      </ScrollShadow>

      {/* Outside the scroll, so the way to open another page never scrolls out of reach. */}
      {picker}

      <div className="flex shrink-0 items-center gap-2">
        {waveChip}
        <SearchButton />
        <ThemeToggle />
      </div>
    </div>
  );
}
