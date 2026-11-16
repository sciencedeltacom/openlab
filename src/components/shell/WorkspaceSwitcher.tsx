/**
 * The workspace switcher.
 *
 * A research tool is used across several pieces of work, so "which one am I in" is a question
 * worth answering where it is always visible — the top of the sidebar, or the start of the
 * tab strip, the way a browser puts the window's own identity before its tabs. The popover is
 * the list, and the only way to leave the folder you are in.
 *
 * One component, two widths: the column has room for the folder's path, the strip does not.
 */

import { useState } from 'react';
import { ChevronRight, MoreHorizontal, Plus, Trash2 } from 'lucide-react';

import { Button, IconButton, Menu, MenuItem, Popover, Separator } from '@/components/ui';
import { cn } from '@/lib/cn';
import { shortPath } from '@/lib/format';
import { projectIcon } from '@/lib/project-icons';
import { useApp } from '@/store/app';
import { activeProject, type Project } from '@/store/types';
import { RemoveWorkspaceDialog } from '@/components/shell/RemoveWorkspaceDialog';

/** One workspace in the switcher: open it, or remove it from the menu. */
function WorkspaceRow({
  project,
  active,
  onSelect,
  onRemove,
}: {
  project: Project;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const Icon = projectIcon(project.icon);

  return (
    <div className="group/ws flex items-center gap-1 rounded-xl pe-1 hover:bg-surface">
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-start"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-secondary text-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-body', active ? 'text-foreground' : 'text-muted')}>
            {project.name}
          </span>
          <span className="block truncate text-meta text-muted">{project.path}</span>
        </span>
      </button>

      <div className="opacity-0 transition-opacity group-hover/ws:opacity-100 focus-within:opacity-100">
        <Menu
          label="Workspace actions"
          trigger={
            <IconButton aria-label="Workspace actions">
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          }
          onAction={(key) => {
            if (key === 'remove') {
              onRemove();
            }
          }}
        >
          <MenuItem id="remove" danger icon={<Trash2 className="size-4 shrink-0" />}>
            Remove workspace
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}

/** Which folder the window is in, and how to change it. */
export function WorkspaceSwitcher({ compact }: { compact?: boolean } = {}) {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<Project | null>(null);
  const project = activeProject(state);
  const Active = projectIcon(project?.icon);

  return (
    <>
      <Popover
        isOpen={open}
        onOpenChange={setOpen}
        placement="bottom start"
        className="w-[320px] p-1.5"
        trigger={
          <Button
            variant="ghost"
            shape="field"
            aria-label="Workspace"
            className={cn(
              'h-auto text-start',
              compact
                ? 'h-7 max-w-[180px] gap-1.5 rounded-lg px-1.5'
                : 'w-full gap-2.5 rounded-2xl bg-surface px-2.5 py-2 hover:bg-surface-secondary',
            )}
          >
            <span
              className={cn(
                'grid shrink-0 place-items-center',
                compact
                  ? 'size-5 rounded-md bg-surface-secondary text-muted'
                  : 'size-9 rounded-xl bg-accent-soft text-accent',
              )}
            >
              <Active className={compact ? 'size-3.5' : 'size-4'} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-body text-foreground', !compact && 'font-semibold')}>
                {project?.name ?? 'No workspace'}
              </span>
              {!compact && (
                <span className="block truncate font-mono text-meta text-muted" title={project?.path}>
                  {project ? shortPath(project.path, 1) : 'Open a folder to begin'}
                </span>
              )}
            </span>
            <ChevronRight
              className={cn('shrink-0 text-muted', compact ? 'size-3' : 'size-3.5')}
              aria-hidden
            />
          </Button>
        }
      >
        <div className="flex flex-col gap-0.5">
          {state.projects.length === 0 && (
            <p className="px-2 py-1.5 text-meta text-muted">No workspace yet.</p>
          )}
          {state.projects.map((candidate) => (
            <WorkspaceRow
              key={candidate.id}
              project={candidate}
              active={candidate.id === state.activeProjectId}
              onSelect={() => {
                dispatch({ type: 'project/select', id: candidate.id });
                setOpen(false);
              }}
              onRemove={() => {
                setOpen(false);
                setRemoving(candidate);
              }}
            />
          ))}
        </div>

        <Separator className="my-1.5" />

        <Button
          variant="secondary"
          fullWidth
          className="justify-center gap-2"
          onPress={() => {
            setOpen(false);
            dispatch({ type: 'route/go', route: 'workspace/new' });
          }}
        >
          <Plus className="size-3.5" />
          Create workspace
        </Button>
      </Popover>

      <RemoveWorkspaceDialog project={removing} onClose={() => setRemoving(null)} />
    </>
  );
}
