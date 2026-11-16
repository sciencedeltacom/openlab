/**
 * The page picker behind `+`.
 *
 * One flat list of every page, filtered as you type and scrollable without typing. It is the
 * replacement for the sidebar: the surfaces that used to be filed under a group are here,
 * with no group — you search for the name you want instead of remembering where it lived.
 *
 * A picker rather than an autocomplete: HeroUI's autocomplete owns its own list and its own
 * selection, and this list is a set of destinations with icons, a scroll of its own and rows
 * that stay readable while the query narrows them. The pieces are the same ones the command
 * palette uses, so the two surfaces behave alike.
 */

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import { PICKER_PAGES } from '@/app/pages';
import { FIXED_TABS } from '@/app/pages';
import { Button, IconButton, Popover, ScrollShadow, SearchField } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import type { PageEntry } from '@/app/routes';

/** How a page scores against what has been typed. Higher is better; 0 is no match. */
function score(page: PageEntry, needle: string): number {
  const label = page.label.toLowerCase();
  if (label === needle) return 100;
  if (label.startsWith(needle)) return 90;
  if (label.includes(needle)) return 70;
  if (page.path.toLowerCase().includes(needle)) return 40;
  return 0;
}

/** The `+` in the tab strip, and the list it opens. */
export function NewTabPopover({
  open,
  onOpenChange,
  vertical,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vertical?: boolean;
}) {
  const { dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);

  const needle = query.trim().toLowerCase();

  const pages = useMemo<PageEntry[]>(() => {
    if (!needle) {
      return [...PICKER_PAGES];
    }
    return PICKER_PAGES.map((page) => ({ page, value: score(page, needle) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value || a.page.label.localeCompare(b.page.label))
      .map((entry) => entry.page);
  }, [needle]);

  const openPage = (page: PageEntry) => {
    dispatch({ type: 'tab/open', path: page.path });
    setQuery('');
    onOpenChange(false);
  };

  return (
    <Popover
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
      placement="bottom start"
      className="w-[340px] p-1.5"
      trigger={
        // The same control in both directions: an icon in the strip, a row in the column.
        vertical ? (
          <Button variant="ghost" fullWidth className="justify-start gap-2.5 px-2">
            <Plus className="size-4 shrink-0" />
            <span className="text-body text-muted">New tab</span>
          </Button>
        ) : (
          <IconButton aria-label="New tab">
            <Plus />
          </IconButton>
        )
      }
    >
      <div className="p-1">
        <SearchField
          aria-label="Open a page"
          variant="secondary"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setAt(0);
          }}
          className="rounded-full"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              placeholder="Open a page…"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setAt((current) => Math.min(current + 1, pages.length - 1));
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setAt((current) => Math.max(current - 1, 0));
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const page = pages[at] ?? pages[0];
                  if (page) openPage(page);
                }
              }}
            />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      <ScrollShadow className="mt-1 max-h-[320px]">
        {pages.length === 0 ? (
          <p className="px-3 py-6 text-center text-body text-muted">Nothing matches “{query}”.</p>
        ) : (
          pages.map((page, index) => {
            const Icon = page.icon;
            return (
              <button
                key={page.path}
                type="button"
                onClick={() => openPage(page)}
                onMouseEnter={() => setAt(index)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start',
                  index === at ? 'bg-surface-secondary' : 'hover:bg-surface-secondary',
                )}
              >
                <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body text-foreground">{page.label}</span>
                {FIXED_TABS.includes(page.path) && (
                  <span className="shrink-0 text-meta text-muted">pinned</span>
                )}
              </button>
            );
          })
        )}
      </ScrollShadow>
    </Popover>
  );
}
