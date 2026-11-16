/**
 * The domain-pack catalogue, grouped by family.
 *
 * A pack is judged by what it adds and what it brings. Every card reads its state from the
 * store — installed and open are separate facts — and its counts from the pack's own runtime
 * definition, so a card cannot advertise a tool the pack does not grant. The header shows the
 * live surface: how many packs are open and how many tools that actually exposes.
 */

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ExternalLink, PackagePlus, Power, PowerOff, Search, Trash2, Wrench } from 'lucide-react';

import { Chip, Input, ScrollShadow } from '@/components/ui';
import { RowMenu, type RowAction } from '@/components/common/RowMenu';
import { cn } from '@/lib/cn';
import { pathFor } from '@/app/routes';
import { useApp } from '@/store/app';
import { MOTION } from '@/theme/tokens';
import { packCatalog } from '@/app/screens/packs';
import { isPackId, resolveWorkbenchSurface, type PackId } from '@/lib/agent/packs';
import type { CatalogEntry, EntryTone } from '@/components/screens/spec';
import { PACK_BRING_ICON, PACK_FAMILY_META, PACK_ICON, PACK_SKILLS, PACK_TOOLS, toneColor } from './meta';

/** One pack card. Clicking opens the pack's own page. */
function PackCard({ entry, index, actions }: { entry: CatalogEntry; index: number; actions: RowAction[] }) {
  const { state, dispatch } = useApp();
  const family = PACK_FAMILY_META[entry.group];
  const FamilyIcon = family?.icon;
  const PackIcon = PACK_ICON[entry.id] ?? FamilyIcon ?? Wrench;
  const tools = PACK_TOOLS[entry.id]?.length ?? 0;
  const skills = PACK_SKILLS[entry.id]?.length ?? 0;
  const ToolsIcon = PACK_BRING_ICON.tools;
  const SkillsIcon = PACK_BRING_ICON.skills;
  const installed = isPackId(entry.id) && state.installedPacks.includes(entry.id);
  const enabled = isPackId(entry.id) && state.enabledPacks.includes(entry.id);
  const chipLabel = enabled ? 'Enabled' : installed ? 'Installed' : 'Not installed';
  const chipTone: EntryTone = enabled ? 'ok' : installed ? 'warn' : 'muted';

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
        onClick={() => dispatch({ type: 'route/go', route: pathFor('packs/:packId', { packId: entry.id }) })}
        className="flex h-full w-full flex-col gap-3 rounded-2xl bg-surface p-4 pr-10 text-left transition-colors hover:bg-surface-tertiary"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-xl',
              family?.chip ?? 'bg-surface-tertiary text-foreground',
            )}
          >
            <PackIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body text-foreground">{entry.name}</span>
            <span className="truncate text-meta text-muted">{entry.group}</span>
          </div>
          <Chip size="sm" variant="soft" color={toneColor(chipTone)}>
            {chipLabel}
          </Chip>
        </div>

        <p className="line-clamp-3 text-meta text-muted">{entry.summary}</p>

        <div className="mt-auto flex items-center gap-3 text-meta text-muted">
          <span className="flex items-center gap-1.5 tabular-nums">
            <ToolsIcon className="size-3.5 shrink-0" aria-hidden />
            {tools} tools
          </span>
          <span className="flex items-center gap-1.5 tabular-nums">
            <SkillsIcon className="size-3.5 shrink-0" aria-hidden />
            {skills} skills
          </span>
        </div>
      </button>
      <div className="absolute right-2 top-2 z-10">
        <RowMenu label={`Actions for ${entry.name}`} actions={actions} />
      </div>
    </motion.div>
  );
}

/** The pack catalogue, grouped by domain family. */
export function PacksView() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const surface = useMemo(
    () => resolveWorkbenchSurface({ enabledPacks: state.enabledPacks }),
    [state.enabledPacks],
  );

  /** The actions a pack card offers, driven by the store rather than a status label. */
  const actionsFor = (entry: CatalogEntry): RowAction[] => {
    const known = isPackId(entry.id);
    const id = known ? (entry.id as PackId) : null;
    const installed = id ? state.installedPacks.includes(id) : false;
    const enabled = id ? state.enabledPacks.includes(id) : false;
    const actions: RowAction[] = [
      {
        id: 'open',
        label: 'Open page',
        icon: ExternalLink,
        onSelect: () => dispatch({ type: 'route/go', route: pathFor('packs/:packId', { packId: entry.id }) }),
      },
    ];
    if (!id) {
      return actions;
    }
    if (installed) {
      actions.push({
        id: 'toggle',
        label: enabled ? 'Close' : 'Open to agent',
        icon: enabled ? PowerOff : Power,
        onSelect: () => dispatch({ type: 'pack/toggle', id }),
      });
      actions.push({
        id: 'uninstall',
        label: 'Uninstall',
        icon: Trash2,
        danger: true,
        onSelect: () => dispatch({ type: 'pack/uninstall', id }),
      });
    } else {
      actions.push({
        id: 'install',
        label: 'Install',
        icon: PackagePlus,
        onSelect: () => dispatch({ type: 'pack/install', id }),
      });
    }
    return actions;
  };

  const filtered = useMemo(
    () =>
      packCatalog.entries.filter((entry) => {
        if (!needle) return true;
        return [entry.name, entry.summary, entry.group, ...(entry.tags ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      }),
    [needle],
  );

  const families = useMemo(() => {
    const order = Array.from(new Set(packCatalog.entries.map((entry) => entry.group)));
    return order
      .map((group) => ({ group, entries: filtered.filter((entry) => entry.group === group) }))
      .filter((family) => family.entries.length > 0);
  }, [filtered]);

  return (
    <ScrollShadow className="h-full min-h-0">
      <div className="mx-auto flex w-full flex-col gap-4 px-6 py-6">
        <p className="text-meta text-muted">
          <span className="text-foreground">{state.enabledPacks.length}</span> packs open ·{' '}
          <span className="text-foreground">{surface.toolIds.length}</span> tools ·{' '}
          <span className="text-foreground">{surface.mcpIds.length}</span> MCP servers allowed
        </p>

        <div className="relative flex min-w-0 items-center sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search packs, tools, tags…"
            aria-label="Search domain packs"
            className="w-full pl-9"
          />
        </div>

        {filtered.length === 0 && (
          <div className="grid place-items-center rounded-3xl bg-surface px-6 py-16 text-center">
            <div>
              <Search className="mx-auto size-5 text-muted" aria-hidden />
              <p className="mt-2 text-body text-muted">No pack matches that search.</p>
            </div>
          </div>
        )}

        {families.map((family) => {
          const meta = PACK_FAMILY_META[family.group];
          const Icon = meta?.icon;
          return (
            <section key={family.group} className="mt-2 first:mt-0">
              <header className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur">
                <span
                  className={cn('flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label', meta?.chip)}
                >
                  {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
                  {family.group}
                </span>
                <span className="text-meta tabular-nums text-muted">{family.entries.length}</span>
              </header>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {family.entries.map((entry, index) => (
                  <PackCard key={entry.id} entry={entry} index={index} actions={actionsFor(entry)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </ScrollShadow>
  );
}
