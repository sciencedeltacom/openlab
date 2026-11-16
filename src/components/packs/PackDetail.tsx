/**
 * A domain pack's record page.
 *
 * Everything shown is read from the pack's own runtime definition and the store: what it
 * unlocks, whether its environment is installed here, and whether it is currently open to the
 * agent. Nothing is a catalogue claim about a pack — the page cannot say a pack brings a tool
 * that the runtime does not grant. The long-form guide, when a pack has one, is the same
 * `DocScreen` every document screen uses.
 */

import { type ReactNode } from 'react';
import {
  BookMarked,
  ChevronRight,
  Layers,
  PackagePlus,
  Plug,
  Tag,
  Trash2,
  Wand2,
  Wrench,
} from 'lucide-react';

import { Button, Chip, SectionLabel, SwitchRow } from '@/components/ui';
import { DocScreen } from '@/components/screens/archetypes';
import { Fact, FactGroup, RecordLink, RecordMissing, RecordPage } from '@/components/research/PageShell';
import { pathFor } from '@/app/routes';
import { cn } from '@/lib/cn';
import { useApp, usePageTitle } from '@/store/app';
import { findPack, isPackId, packToolIds, type PackId } from '@/lib/agent/packs';
import { findMcpServer } from '@/lib/agent/mcp';
import { findTool } from '@/lib/agent/tools';
import { packCatalog, packGuides } from '@/app/screens/packs';
import type { CatalogEntry, EntryTone } from '@/components/screens/spec';
import {
  PACK_FAMILY_META,
  PACK_ICON,
  PACK_SKILLS,
  PACK_TOOLS,
  hasSkillEntry,
  hasToolEntry,
  skillName,
  toneColor,
  toolName,
} from './meta';

/** Install, open and uninstall, driven entirely by the store. */
function InstallControl({ entry }: { entry: CatalogEntry }) {
  const { state, dispatch } = useApp();
  if (!isPackId(entry.id)) {
    return null;
  }
  const id = entry.id as PackId;
  const installed = state.installedPacks.includes(id);
  const enabled = state.enabledPacks.includes(id);

  if (!installed) {
    return (
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-body text-foreground">Install this pack</div>
          <div className="text-meta text-muted">
            Marks its environment as provisioned on this machine. You provide the tooling.
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          className="gap-1.5"
          onPress={() => dispatch({ type: 'pack/install', id })}
        >
          <PackagePlus className="size-3.5" />
          Install
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SwitchRow
        label="Open to the agent"
        hint="Its tools, MCP servers and procedures are available to the agent."
        checked={enabled}
        onChange={() => dispatch({ type: 'pack/toggle', id })}
      />
      <Button
        size="sm"
        variant="danger-soft"
        className="gap-1.5 self-start"
        onPress={() => dispatch({ type: 'pack/uninstall', id })}
      >
        <Trash2 className="size-3.5" />
        Uninstall
      </Button>
    </div>
  );
}

/** A linked row for one tool or skill the pack adds. */
function BringRow({ route, icon, label }: { route?: string; icon: ReactNode; label: string }) {
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{label}</span>
      {route && (
        <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
      )}
    </>
  );
  if (!route) {
    // A pack names tooling it expects in the environment; unless the tool has a page in the
    // agent catalogue, the row is a label rather than a link to nothing.
    return <div className="flex w-full items-center gap-2.5 rounded-xl bg-surface px-3 py-2">{body}</div>;
  }
  return (
    <RecordLink
      route={route}
      className="group flex w-full items-center gap-2.5 rounded-xl bg-surface px-3 py-2 transition-colors hover:bg-surface-tertiary"
    >
      {body}
    </RecordLink>
  );
}

/** The page body, keyed by id so it re-reads cleanly when another pack is opened. */
function PackDetailBody({ entry }: { entry: CatalogEntry }) {
  usePageTitle(entry.name);
  const { state } = useApp();
  const id = isPackId(entry.id) ? (entry.id as PackId) : null;
  const pack = id ? findPack(id) : undefined;
  const guide = packGuides[entry.id];
  const family = PACK_FAMILY_META[entry.group];
  const FamilyIcon = family?.icon;
  const PackIcon = PACK_ICON[entry.id] ?? FamilyIcon ?? Wrench;
  const tools = PACK_TOOLS[entry.id] ?? [];
  const skills = PACK_SKILLS[entry.id] ?? [];
  const installed = id ? state.installedPacks.includes(id) : false;
  const enabled = id ? state.enabledPacks.includes(id) : false;
  const agentTools = id ? packToolIds(id) : [];
  const mcps = pack?.mcps ?? [];
  const statusLabel = enabled ? 'Enabled' : installed ? 'Installed' : 'Not installed';
  const statusTone: EntryTone = enabled ? 'ok' : installed ? 'warn' : 'muted';

  return (
    <RecordPage
      eyebrow={<SectionLabel>Pack</SectionLabel>}
      title={
        <span className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-xl',
              family?.chip ?? 'bg-surface-tertiary text-foreground',
            )}
          >
            <PackIcon className="size-5" />
          </span>
          {entry.name}
        </span>
      }
      status={
        <Chip size="sm" variant="soft" color={toneColor(statusTone)}>
          {statusLabel}
        </Chip>
      }
      aside={
        <>
          <FactGroup>
            <Fact icon={FamilyIcon ?? Layers} label="Family">
              {entry.group}
            </Fact>
            <Fact icon={Plug} label="MCP servers">
              {mcps.length > 0 ? mcps.map((mcp) => findMcpServer(mcp)?.name ?? mcp).join(', ') : 'none'}
            </Fact>
            {entry.tags && entry.tags.length > 0 && (
              <Fact icon={Tag} label="Tags">
                <span className="flex flex-wrap gap-1.5">
                  {entry.tags.map((tag) => (
                    <Chip key={tag} size="sm" variant="soft" color="default">
                      {tag}
                    </Chip>
                  ))}
                </span>
              </Fact>
            )}
          </FactGroup>

          {guide?.aside?.map((group) => (
            <FactGroup key={group.title} title={group.title}>
              {group.items.map((item) => (
                <Fact key={item.label} label={item.label}>
                  {item.value}
                </Fact>
              ))}
            </FactGroup>
          ))}
        </>
      }
    >
      <section className="flex flex-col gap-2 rounded-3xl bg-surface p-4">
        <SectionLabel>Environment</SectionLabel>
        <InstallControl entry={entry} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Agent surface</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{agentTools.length + mcps.length}</span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {agentTools.map((toolId) => {
            const tool = findTool(toolId);
            if (!tool) {
              return null;
            }
            return (
              <li key={toolId} className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2">
                <Wrench className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="w-28 shrink-0 font-mono text-meta text-foreground">{tool.name}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-muted">{tool.summary}</span>
              </li>
            );
          })}
          {mcps.map((mcpId) => {
            const server = findMcpServer(mcpId);
            if (!server) {
              return null;
            }
            return (
              <li key={mcpId} className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2">
                <Plug className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="w-28 shrink-0 font-mono text-meta text-foreground">{server.name}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-muted">
                  {server.summary} (reference only)
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Tools</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{tools.length}</span>
        </div>
        <p className="text-meta text-muted">
          The environment this pack expects: installed on the machine or in a container.
        </p>
        <ul className="flex flex-col gap-1.5">
          {tools.map((toolId) => (
            <li key={toolId}>
              <BringRow
                route={hasToolEntry(toolId) ? pathFor('tools/catalog/:toolId', { toolId }) : undefined}
                icon={<Wrench className="size-4 shrink-0 text-muted" aria-hidden />}
                label={toolName(toolId)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Skills</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{skills.length}</span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {skills.map((skill) => (
            <li key={skill.id}>
              <BringRow
                route={
                  hasSkillEntry(skill.id)
                    ? skill.kind === 'recipe'
                      ? pathFor('skills/recipes/:recipeId', { recipeId: skill.id })
                      : pathFor('skills/:skillId', { skillId: skill.id })
                    : undefined
                }
                icon={
                  skill.kind === 'recipe' ? (
                    <Wand2 className="size-4 shrink-0 text-muted" aria-hidden />
                  ) : (
                    <BookMarked className="size-4 shrink-0 text-muted" aria-hidden />
                  )
                }
                label={skillName(skill.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      {guide && (
        <section className="flex flex-col gap-6">
          <SectionLabel>The guide</SectionLabel>
          <DocScreen spec={guide} embedded />
        </section>
      )}
    </RecordPage>
  );
}

/** A pack's page; an unknown id gets the shared not-found state. */
export function PackDetail({ packId }: { packId: string }) {
  const entry = packCatalog.entries.find((candidate) => candidate.id === packId);
  if (!entry) {
    return <RecordMissing what="pack" back="packs" backLabel="Domain packs" />;
  }
  return <PackDetailBody key={entry.id} entry={entry} />;
}
