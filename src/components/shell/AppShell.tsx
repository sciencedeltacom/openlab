/**
 * The application shell.
 *
 * Creating a workspace is its own full-window stepper. Without a workspace the shell is a
 * single centred surface with no chrome at all — the welcome is the whole window, and its one
 * action is to start the create flow. With a workspace open there is one tab system, drawn
 * across the top or down the side (Settings → Appearance), and the screen fills everything
 * else: no bar between them, because every control that used to live in one belongs to a page.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui';
import { applyTitlebarInset } from '@/lib/platform';
import { useWindowState } from '@/lib/window-state';
import { loadWorkspaceExtensions } from '@/lib/extensions/registry';
import { loadWorkspacePlan } from '@/lib/plan/sync';
import { loadWorkspaceFigures } from '@/components/figures/store';
import { loadCatalogProviders } from '@/lib/models-dev';
import { notify } from '@/lib/toast';
import { useKeyboard } from '@/hooks/useKeyboard';
import { ScreenHost, Unbuilt } from '@/app/screens';
import { WorkspaceCreate } from '@/app/screens/workspace-create';
import { HOME, matchRoute } from '@/app/routes';
import { Welcome } from '@/components/home/Welcome';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import { CitationIsland } from '@/components/chat/CitationIsland';
import { FileIsland } from '@/components/files/FileIsland';
import { CommandPalette } from './CommandPalette';
import { TabStrip } from './TabStrip';

/** Root layout. */
export function AppShell() {
  const { state, dispatch } = useApp();
  // The window reopens where it was left; the bounds are this display's, not the lab's.
  useWindowState();

  // Before the first paint, so the window controls never land on the sidebar even for a frame.
  useLayoutEffect(() => {
    applyTitlebarInset();
  }, []);

  // The models.dev catalog, once. A failure is silent: the built-ins and the user's own
  // providers still work, so there is nothing to interrupt them for.
  useEffect(() => {
    let alive = true;
    loadCatalogProviders()
      .then((providers) => alive && dispatch({ type: 'catalog/set', providers }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [dispatch]);

  // The workspace's own extensions, read when a folder opens. `.openlab/extensions/` belongs
  // to the project, so its tools travel with the work that uses them.
  const workspacePath = activeProject(state)?.path;
  useEffect(() => {
    if (workspacePath) void loadWorkspaceExtensions(workspacePath);
  }, [workspacePath]);

  // The figures are the workspace's documents, kept in `.openlab/figures/`, so they travel
  // with the folder instead of with the app.
  useEffect(() => {
    if (workspacePath) void loadWorkspaceFigures(workspacePath);
  }, [workspacePath]);

  // The plan travels the same way, through `.openlab/plan/`: read on open, so a wave or a
  // task somebody else changed is picked up before anything is written back over it.
  const planRef = useRef(state);
  planRef.current = state;
  useEffect(() => {
    if (!workspacePath) return;
    void loadWorkspacePlan(workspacePath, {
      source: () => {
        const live = planRef.current;
        return { waves: live.waves, tasks: live.tasks, members: live.members, jobs: live.jobs };
      },
      createWave: (wave) => dispatch({ type: 'wave/create', wave }),
      patchWave: (id, patch) => dispatch({ type: 'wave/patch', id, patch }),
      patchTask: (id, patch) => dispatch({ type: 'task/patch', id, patch }),
      report: (message, tone) => notify(message, { tone }),
    });
  }, [workspacePath, dispatch]);

  // One shortcut, the one every tool of this shape has. Cmd on Apple hardware, Ctrl elsewhere.
  useKeyboard('mod+k', (event) => {
    event.preventDefault();
    dispatch({ type: 'palette/set', open: !state.paletteOpen });
  });

  // Walking the tabs. Ctrl rather than Cmd, because Cmd+Tab belongs to the operating system,
  // and the shell owns it because both chromes are the same tab system.
  useKeyboard('ctrl+tab', (event) => {
    event.preventDefault();
    dispatch({ type: 'tab/cycle', delta: 1 });
  });
  useKeyboard('ctrl+shift+tab', (event) => {
    event.preventDefault();
    dispatch({ type: 'tab/cycle', delta: -1 });
  });

  // Creating a workspace is its own full-window flow, outside the sidebar and independent of
  // whether a workspace is already open.
  if (state.route === 'workspace/new') {
    return <WorkspaceCreate />;
  }

  const hasWorkspace = activeProject(state) !== undefined;

  // No folder: a layout of its own, with no chrome. Settings still render, because model
  // configuration is app-level, not workspace-level.
  if (!hasWorkspace) {
    const match = matchRoute(state.route);
    if (!match.found) {
      return <Unbuilt pattern={state.route} />;
    }
    const appLevel = match.pattern.startsWith('settings');
    return (
      <div
        className="flex h-dvh w-screen flex-col overflow-hidden bg-background text-foreground"
        style={{ paddingTop: 'var(--titlebar-h)' }}
      >
        {appLevel ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* App-level screens open from the welcome and have no other chrome, so they
                carry the one way back. A workspace's own settings sit in the tab strip. */}
            <div className="px-4 pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onPress={() => dispatch({ type: 'route/go', route: HOME })}
              >
                <ArrowLeft className="size-3.5" />
                Workspaces
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <ScreenHost />
            </div>
          </div>
        ) : (
          <Welcome />
        )}
        <CitationIsland />
        <FileIsland />
        <CommandPalette
          open={state.paletteOpen}
          onClose={() => dispatch({ type: 'palette/set', open: false })}
        />
      </div>
    );
  }

  const vertical = state.navMode === 'vertical';

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background text-foreground">
      {/*
        One tab system, two directions. Vertically it is the column on the left, with the
        window controls landing on its own top; horizontally it is the strip above the work,
        with the inset above that.
      */}
      {vertical ? (
        <TabStrip vertical />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div style={{ paddingTop: 'var(--titlebar-h)' }}>
            <TabStrip />
          </div>
          <main className="min-h-0 flex-1 overflow-hidden">
            <ScreenHost />
          </main>
        </div>
      )}
      {vertical && (
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ScreenHost />
        </main>
      )}
      <CitationIsland />
      <FileIsland />
      <CommandPalette
        open={state.paletteOpen}
        onClose={() => dispatch({ type: 'palette/set', open: false })}
      />
    </div>
  );
}
