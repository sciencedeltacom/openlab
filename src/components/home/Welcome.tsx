/**
 * The welcome.
 *
 * What openlab shows when no workspace is open: the way in, and the workspaces already on the
 * machine. It reads like a first-run screen should — a brand line, a short column of things
 * you can do, the folders you have opened before, and a handful of walkthroughs on the right
 * rather than a wall of charts. A chart of nothing is not a welcome.
 */

import { useState } from 'react';
import {
  BookMarked,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';

import { Button, IconButton, Input, ScrollShadow } from '@/components/ui';
import { HexMark, LabLogo } from '@/components/brand/Marks';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useApp } from '@/store/app';
import type { Project } from '@/store/types';
import { RemoveWorkspaceDialog } from '@/components/shell/RemoveWorkspaceDialog';

/** How many recent workspaces show before "More…". */
const RECENT_LIMIT = 6;

/** One row in the Start column. */
function StartRow({
  icon: Icon,
  label,
  hint,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-start transition-colors hover:bg-surface-secondary"
    >
      <Icon className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-body text-foreground">{label}</span>
        {hint && <span className="block truncate text-meta text-muted">{hint}</span>}
      </span>
    </button>
  );
}

/** One walkthrough card. */
function Walkthrough({
  icon: Icon,
  title,
  body,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="group flex items-start gap-3 rounded-2xl bg-surface p-3 text-start transition-colors hover:bg-surface-secondary"
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-foreground">{title}</span>
        <span className="block text-meta text-muted">{body}</span>
      </span>
    </button>
  );
}

export function Welcome() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [removing, setRemoving] = useState<Project | null>(null);

  const go = (route: string) => dispatch({ type: 'route/go', route });

  const recent = [...state.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? recent.filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(needle))
    : recent;
  const shown = expanded || needle ? matched : matched.slice(0, RECENT_LIMIT);

  const starts: { icon: LucideIcon; label: string; hint?: string; onPress: () => void }[] = [
    {
      icon: Plus,
      label: 'Create workspace…',
      hint: 'Give a new project a home',
      onPress: () => go('workspace/new'),
    },
    {
      icon: Settings,
      label: 'Settings',
      hint: 'Providers and the workbench',
      onPress: () => go('settings/providers'),
    },
  ];

  const walkthroughs: { icon: LucideIcon; title: string; body: string; route: string }[] = [
    {
      icon: Sparkles,
      title: 'Get started with openlab',
      body: 'Create a workspace, open a session, and ask your first question.',
      route: 'workspace/new',
    },
    {
      icon: Plug,
      title: 'Connect your models',
      body: 'Add a provider key and choose the model the agent runs on.',
      route: 'settings/providers',
    },
    {
      icon: Wand2,
      title: 'Make it yours',
      body: 'Appearance, shortcuts, and the controls you reach for.',
      route: 'settings/appearance',
    },
    {
      icon: BookMarked,
      title: 'The workbench, explained',
      body: 'What a workspace holds, and how the agent records its steps.',
      route: 'settings/help',
    },
  ];

  return (
    <>
      <ScrollShadow className="h-full">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-12 px-10 pb-20 pt-16">
          <header className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2.5 text-foreground">
              <LabLogo size={26} />
              <span className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em]">openlab</span>
            </span>
            <p className="text-body text-muted">Research, evolved.</p>
          </header>

          <div className="grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="flex min-w-0 flex-col gap-12">
              <section className="flex flex-col gap-3">
                <h2 className="text-title text-foreground">Start</h2>
                <div className="flex flex-col gap-0.5">
                  {starts.map((action) => (
                    <StartRow key={action.label} {...action} />
                  ))}
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-title text-foreground">Recent</h2>
                  {recent.length > 0 && (
                    <span className="text-meta tabular-nums text-muted">{recent.length}</span>
                  )}
                  {recent.length > RECENT_LIMIT && (
                    <div className="relative ml-auto flex min-w-0 items-center">
                      <Search
                        className="pointer-events-none absolute left-2.5 size-3.5 text-muted"
                        aria-hidden
                      />
                      <Input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery((event.target as HTMLInputElement).value)}
                        placeholder="Search workspaces"
                        aria-label="Search recent workspaces"
                        className="h-7 w-[180px] pl-8 text-meta"
                      />
                    </div>
                  )}
                </div>

                {shown.length === 0 ? (
                  <p className="rounded-2xl bg-surface px-4 py-6 text-center text-body text-muted">
                    {needle ? 'No workspace matches.' : 'No workspace yet. Create one to begin.'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {shown.map((project) => (
                      <div
                        key={project.id}
                        className="group flex items-center gap-1 rounded-xl transition-colors hover:bg-surface-secondary"
                      >
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'project/select', id: project.id })}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-start"
                        >
                          <HexMark size={16} className="shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body text-foreground">{project.name}</span>
                            <span className="block truncate font-mono text-meta text-muted">
                              {project.path}
                            </span>
                          </span>
                          <span className="shrink-0 text-meta tabular-nums text-muted">
                            {relativeTime(project.lastOpenedAt)}
                          </span>
                        </button>
                        <IconButton
                          aria-label={`Remove ${project.name}`}
                          className={cn('mr-1 opacity-0 transition-opacity group-hover:opacity-100')}
                          onPress={() => setRemoving(project)}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    ))}
                    {!needle && recent.length > RECENT_LIMIT && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 self-start text-link"
                        onPress={() => setExpanded((value) => !value)}
                      >
                        {expanded ? 'Less' : 'More…'}
                      </Button>
                    )}
                  </div>
                )}
              </section>
            </div>

            <section className="flex min-w-0 flex-col gap-3">
              <h2 className="text-title text-foreground">Walkthroughs</h2>
              <div className="flex flex-col gap-2">
                {walkthroughs.map((walkthrough) => (
                  <Walkthrough
                    key={walkthrough.title}
                    icon={walkthrough.icon}
                    title={walkthrough.title}
                    body={walkthrough.body}
                    onPress={() => go(walkthrough.route)}
                  />
                ))}
              </div>
            </section>
          </div>
        </div>
      </ScrollShadow>

      <RemoveWorkspaceDialog project={removing} onClose={() => setRemoving(null)} />
    </>
  );
}
