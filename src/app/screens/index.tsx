/**
 * The screen registry.
 *
 * One place that answers "what does this path show". It resolves the path to a pattern, its
 * parameters and its section's tabs, then renders:
 *
 *   a tab strip (when the section has more than one page),
 *   the page itself — a spec through an archetype, a record through `RecordScreen`, or one
 *   of the few screens that are neither.
 *
 * Anything unresolved renders a visible notice rather than a blank page, so a missing surface
 * is obvious instead of silent.
 */

import { useEffect, lazy, Suspense } from 'react';
import { Compass, Star } from 'lucide-react';

import { Button, Chip, ScrollShadow, SectionLabel, Skeleton } from '@/components/ui';
import { CatalogScreen, RecordScreen, ScreenSpecView } from '@/components/screens/archetypes';
import type { CatalogScreenSpec, ScreenSpec } from '@/components/screens/spec';
import {
  AnalyticsView,
  InboxView,
  IntakeView,
  MyWorkView,
  TaskBoard,
  TaskDetail,
  TaskList,
  TaskTimeline,
  WaveCreate,
  WaveDetail,
  WaveList,
} from '@/components/research';
import { ExperimentDetail } from '@/components/experiments/ExperimentDetail';
import { ExperimentsView } from '@/components/experiments/ExperimentsView';
import { ExperimentCreate } from '@/components/experiments/ExperimentCreate';
import { AgentCreate } from '@/components/agents/AgentCreate';
import { DETAILS, matchRoute, recordPatternFor, type RouteId } from '@/app/routes';
import { Workbench } from '@/components/layout/Workbench';
import { Dashboard } from '@/components/home/Dashboard';
import { HomeScreen } from '@/components/home/HomeScreen';
import { ResearchToolbar } from '@/components/shell/ResearchToolbar';
import { ErrorBoundary } from '@/components/shell/ErrorBoundary';
import { useApp } from '@/store/app';
import { newView, type SavedView, type TaskFilter } from '@/store/research';
import { ProvidersScreen } from './providers';
import { SandboxScreen } from './sandbox';
import { ContainerScreen } from './container';
import { PermissionsScreen } from './permissions';
import { InstructionsScreen } from './instructions';
import { AssistantHome, resultsSpec } from './assistant';
import { computeScreens } from './compute';
import { COMPUTE_PATTERNS, ComputeHost } from './compute-pages';
import { libraryScreens } from './library';
import { ReviewCreate, ReviewView, ReviewsIndex } from './literature';

/**
 * The heavy screens, loaded on navigation rather than with the shell.
 *
 * The figures studio carries mermaid and KaTeX, the statistics page carries Nivo, the codebase
 * page carries xterm, the knowledge graph carries a force simulation, and a file preview
 * carries CodeMirror and Tiptap — megabytes that a reader who never opens those pages should
 * not download to see the workspace start.
 */
const FiguresView = lazy(() =>
  import('@/components/figures/FiguresView').then((m) => ({ default: m.FiguresView })),
);
const FigureStudio = lazy(() =>
  import('@/components/figures/FigureStudio').then((m) => ({ default: m.FigureStudio })),
);
const StatisticsWorkbench = lazy(() =>
  import('@/components/stats/StatisticsWorkbench').then((m) => ({ default: m.StatisticsWorkbench })),
);
const KnowledgeScreen = lazy(() =>
  import('@/components/knowledge/KnowledgeScreen').then((m) => ({ default: m.KnowledgeScreen })),
);
const JobCodebase = lazy(() =>
  import('@/components/jobs/JobCodebase').then((m) => ({ default: m.JobCodebase })),
);
const FileBrowser = lazy(() =>
  import('@/components/files/FileBrowser').then((m) => ({ default: m.FileBrowser })),
);
const FilePreview = lazy(() =>
  import('@/components/files/FilePreview').then((m) => ({ default: m.FilePreview })),
);
import { DatabaseCatalogue, DatabaseCreate, DatabaseDetail } from './databases';
import { ConnectionsScreen } from '@/components/connections/ConnectionsScreen';
import { AutoresearchView } from '@/components/autoresearch/AutoresearchView';
import { ExtensionsScreen } from '@/components/extensions/ExtensionsScreen';
import { CommandsScreen } from '@/components/settings/CommandsScreen';
import { UsageScreen } from '@/components/settings/UsageScreen';
import { BackupScreen } from '@/components/settings/BackupScreen';
import { ServersScreen } from '@/components/settings/ServersScreen';
import { DiagnosticsScreen } from '@/components/settings/DiagnosticsScreen';
import { ScanEngineScreen } from '@/components/settings/ScanEngineScreen';
import { SourcesCatalogue } from '@/components/sources/SourcesCatalogue';
import { SourceDetail } from '@/components/sources/SourceDetail';
import { SourceCreate } from '@/components/sources/SourceCreate';
import { PACK_PATTERNS, PackHost } from './pack-page';
import { packScreens } from './packs';
import { settingsScreens } from './settings';
import { skillScreens } from './skills';
import { toolCatalogScreens, toolScreens } from './tools';
import { useExtensions } from '@/lib/extensions/registry';

/** Every spec-backed screen, merged and keyed by path pattern. */
const SPECS: Partial<Record<RouteId, ScreenSpec>> = {
  ...libraryScreens,
  ...computeScreens,
  ...packScreens,
  ...toolScreens,
  ...skillScreens,
  ...settingsScreens,
};

/**
 * Saved views, as a catalogue spec.
 *
 * Shared by the list and by each view's own page. The applier is passed in because the list
 * needs to dispatch and a record page only needs to describe.
 */
function viewsSpec(options: {
  views: readonly SavedView[];
  activeViewId: string | null;
  apply: (viewId: string, filter: TaskFilter, layout: 'list' | 'board' | 'timeline') => void;
  create?: () => void;
  remove?: (id: string) => void;
}): CatalogScreenSpec {
  const { views, activeViewId, apply, create, remove } = options;
  return {
    kind: 'catalog',
    facetLabel: 'Layout',
    columns: 2,
    records: { noun: 'View' },
    actions: create ? (
      <Button size="sm" variant="secondary" className="gap-1.5" onPress={create}>
        New view
      </Button>
    ) : undefined,
    entries: views.map((view) => ({
      id: view.id,
      name: view.name,
      summary: describeFilter(view.filters),
      group: view.layout,
      status: activeViewId === view.id ? { label: 'applied', tone: 'ok' as const } : undefined,
      meta: view.ownerId ? ['personal'] : ['shared with the lab'],
      detail: [
        { label: 'Layout', value: view.layout },
        { label: 'Owner', value: view.ownerId ? 'Personal' : 'Shared with the lab' },
        { label: 'Starred', value: view.starred ? 'Yes' : 'No' },
      ],
      footer: (
        <div className="mt-2 flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onPress={() => apply(view.id, view.filters, view.layout)}>
            {activeViewId === view.id ? 'Clear' : 'Apply'}
          </Button>
          {view.starred && (
            <Chip size="sm" className="bg-surface text-meta text-muted">
              <Star className="size-3" />
              starred
            </Chip>
          )}
          {remove && (
            <Button size="sm" variant="ghost" className="text-danger" onPress={() => remove(view.id)}>
              Remove
            </Button>
          )}
        </div>
      ),
    })),
    empty: 'No saved views yet.',
  };
}

/** The saved views, as a catalogue you can apply. */
function ViewsScreen() {
  const { state, dispatch } = useApp();

  return (
    <CatalogScreen
      spec={viewsSpec({
        views: state.views,
        activeViewId: state.activeViewId,
        apply: (viewId, filter, layout) => {
          if (state.activeViewId === viewId) {
            dispatch({ type: 'view/apply', viewId: null, filter: {} });
          } else {
            dispatch({ type: 'view/apply', viewId, filter, layout });
          }
        },
        create: () => {
          const view = newView(state.taskFilter, state.taskLayout);
          dispatch({ type: 'view/create', view });
        },
        remove: (id) => dispatch({ type: 'view/remove', id }),
      })}
    />
  );
}

/** Turn a filter into a sentence a reader can check. */
function describeFilter(filter: TaskFilter): string {
  const parts: string[] = [];
  if (filter.status?.length) parts.push(`status ${filter.status.join(' or ')}`);
  if (filter.assigneeId?.length) parts.push('assigned to one person');
  if (filter.waveId?.length) parts.push('in one wave');
  if (filter.label?.length) parts.push('carrying a label');
  if (filter.overdue) parts.push('past its due date');
  return parts.length ? `Shows tasks ${parts.join(', ')}.` : 'Shows everything.';
}

/** The tracker: its toolbar, its layout, and its record pages. */
function ResearchHost({ pattern, params }: { pattern: string; params: Record<string, string> }) {
  const { state, dispatch } = useApp();

  /** Apply or clear a view, the same decision the list makes. */
  const applyView = (viewId: string, filter: TaskFilter, layout: 'list' | 'board' | 'timeline') => {
    if (state.activeViewId === viewId) {
      dispatch({ type: 'view/apply', viewId: null, filter: {} });
    } else {
      dispatch({ type: 'view/apply', viewId, filter, layout });
    }
  };

  switch (pattern) {
    case 'research/tasks':
      // The tracker's own controls sit at the top of the tracker, which is where they belong
      // now that the application has no top bar.
      return (
        <div className="flex h-full min-h-0 flex-col">
          <ResearchToolbar />
          <div className="min-h-0 flex-1 overflow-hidden">
            {state.taskLayout === 'board' ? (
              <TaskBoard />
            ) : state.taskLayout === 'timeline' ? (
              <TaskTimeline />
            ) : (
              <TaskList />
            )}
          </div>
        </div>
      );
    case 'research/tasks/:taskId':
      return <TaskDetail taskId={params.taskId} />;
    case 'research/intake':
      return <IntakeView />;
    case 'research/views':
      return <ViewsScreen />;
    case 'research/views/:viewId':
      return (
        <RecordScreen
          spec={viewsSpec({ views: state.views, activeViewId: state.activeViewId, apply: applyView })}
          id={params.viewId}
          pattern={pattern}
          parent="research/views"
        />
      );
    case 'research/analytics':
      return <AnalyticsView />;
    case 'research/waves':
      return <WaveList />;
    case 'research/waves/:waveId':
      return <WaveDetail waveId={params.waveId} />;
    default:
      // Reached only when a record pattern has no page. Saying so is better than rendering
      // a different surface pretending to be this one.
      return <Unbuilt pattern={pattern} />;
  }
}

/**
 * A session's page *is* the transcript.
 *
 * There is no separate record to show, and a second rendering of the same conversation would
 * be a second thing to keep in step.
 */
function SessionRecord({ sessionId }: { sessionId: string }) {
  const { state, dispatch } = useApp();
  useEffect(() => {
    if (state.sessions.some((session) => session.id === sessionId) && state.activeSessionId !== sessionId) {
      dispatch({ type: 'session/select', id: sessionId });
    }
  }, [sessionId, state.sessions, state.activeSessionId, dispatch]);

  return <Workbench />;
}

/** What a path renders. */
export function ScreenHost() {
  const { state, dispatch } = useApp();
  // Subscribing here is what makes the tool catalogue live: installing or loading an extension
  // re-renders the screen whose entries are built from the registry.
  useExtensions();
  const liveSpecs = toolCatalogScreens();
  const match = matchRoute(state.route);

  const body = (() => {
    // A path with no match is a gap, and a gap is shown: landing on Home would hide it.
    if (!match.found) return <Unbuilt pattern={state.route} />;
    if (match.pattern === 'home') return <HomeScreen />;
    if (match.pattern === 'home/insights') return <Dashboard />;
    if (match.pattern === 'research/waves/new') return <WaveCreate />;

    if (match.pattern.startsWith('research/')) {
      return (
        <div className="min-h-0 h-full overflow-hidden">
          <ResearchHost pattern={match.pattern} params={match.params} />
        </div>
      );
    }

    if (match.pattern === 'inbox') return <InboxView />;
    if (match.pattern === 'my-work') return <MyWorkView />;
    if (match.pattern === 'knowledge') return <KnowledgeScreen />;
    if (match.pattern === 'connections') return <ConnectionsScreen />;
    if (match.pattern === 'settings/providers') {
      return (
        <ScrollShadow className="h-full">
          <ProvidersScreen />
        </ScrollShadow>
      );
    }
    // Where a command runs: two pages, because a sandbox and a container are configured by
    // different things and merging them would hide half of each.
    if (match.pattern === 'settings/sandbox') {
      return (
        <ScrollShadow className="h-full">
          <SandboxScreen />
        </ScrollShadow>
      );
    }
    if (match.pattern === 'settings/container') {
      return (
        <ScrollShadow className="h-full">
          <ContainerScreen />
        </ScrollShadow>
      );
    }
    // The workspace's own system-prompt words, with the real builder as the preview.
    if (match.pattern === 'settings/instructions') {
      return (
        <ScrollShadow className="h-full">
          <InstructionsScreen />
        </ScrollShadow>
      );
    }
    // The automatic review, live: posture, custom rules, and a tester that never executes.
    if (match.pattern === 'settings/permissions') {
      return (
        <ScrollShadow className="h-full">
          <PermissionsScreen />
        </ScrollShadow>
      );
    }
    // Commands is a surface of its own: the slash menu's registry, and where one is written.
    if (match.pattern === 'settings/slash-commands') {
      return (
        <ScrollShadow className="h-full">
          <CommandsScreen />
        </ScrollShadow>
      );
    }
    // Usage is a surface of its own: the numbers a workspace has actually spent.
    if (match.pattern === 'settings/usage') {
      return (
        <ScrollShadow className="h-full">
          <UsageScreen />
        </ScrollShadow>
      );
    }
    // Backups are the store itself: the one place a desktop reader can copy it and stage a
    // restore without a terminal.
    if (match.pattern === 'settings/backups') {
      return (
        <ScrollShadow className="h-full">
          <BackupScreen />
        </ScrollShadow>
      );
    }
    // Diagnostics is the log and the crash reports, so a bug report can quote something real.
    if (match.pattern === 'settings/diagnostics') {
      return (
        <ScrollShadow className="h-full">
          <DiagnosticsScreen />
        </ScrollShadow>
      );
    }
    // MCP servers are started deliberately: status, install, and the tools each advertises.
    if (match.pattern === 'settings/servers') {
      return (
        <ScrollShadow className="h-full">
          <ServersScreen />
        </ScrollShadow>
      );
    }
    // The scan engine is installed on demand rather than shipped, so it needs a surface: what the
    // pipeline attached, and the one button that fetches the pinned Python.
    if (match.pattern === 'settings/scan') {
      return (
        <ScrollShadow className="h-full">
          <ScanEngineScreen />
        </ScrollShadow>
      );
    }
    // Extensions is a surface of its own: what is installed, and the protocol for writing one.
    if (match.pattern === 'settings/extensions') {
      return (
        <ScrollShadow className="h-full">
          <ExtensionsScreen />
        </ScrollShadow>
      );
    }

    if (match.pattern === 'assistant') return <AssistantHome />;
    if (match.pattern === 'agents/new') return <AgentCreate />;
    // The transcript owns its whole surface: a tab strip above a conversation would be one
    // more thing between the reader and what they came for.
    if (match.pattern === 'assistant/:sessionId') return <SessionRecord sessionId={match.params.sessionId} />;
    if (match.pattern === 'assistant/results') {
      return (
        <ScrollShadow className="h-full">
          <CatalogScreen spec={resultsSpec(state.results)} recordPattern="assistant/results/:resultId" />
        </ScrollShadow>
      );
    }
    if (match.pattern === 'assistant/results/:resultId') {
      return (
        <ScrollShadow className="h-full">
          <RecordScreen
            spec={resultsSpec(state.results)}
            id={match.params.resultId}
            pattern={match.pattern}
            parent="assistant/results"
          />
        </ScrollShadow>
      );
    }

    // Reviews are their own surface: an index of questions, and one screening workspace per
    // review. The workspace is keyed by id so a different review reads a different table.
    if (match.pattern === 'literature-reviews/new') {
      return <ReviewCreate />;
    }
    if (match.pattern === 'literature-reviews') {
      return <ReviewsIndex />;
    }
    if (match.pattern === 'literature-reviews/:reviewId') {
      return <ReviewView reviewId={match.params.reviewId} />;
    }
    // The database catalogue groups by family; each database opens the page where its
    // connection is configured and a request is run.
    if (match.pattern === 'library/databases/new') {
      return <DatabaseCreate />;
    }
    if (match.pattern === 'library/databases' || match.pattern === 'library/databases/:databaseId') {
      return match.isDetail ? <DatabaseDetail databaseId={match.params.databaseId} /> : <DatabaseCatalogue />;
    }
    if (match.pattern === 'library/sources/:sourceId/edit') {
      return <SourceCreate sourceId={match.params.sourceId} />;
    }
    if (match.pattern === 'library/sources/new') {
      return <SourceCreate />;
    }
    if (match.pattern === 'library/sources') {
      return <SourcesCatalogue />;
    }
    if (match.pattern === 'library/sources/:sourceId') {
      return <SourceDetail sourceId={match.params.sourceId} />;
    }
    // A file is a record with a page of its own, so opening one from the list or from a
    // job's codebase lands somewhere you can read it, link to it and keep open.
    if (match.pattern === 'library/files' || match.pattern === 'library/files/:fileId') {
      return match.isDetail ? <FilePreview path={match.params.fileId} /> : <FileBrowser />;
    }

    // A job's codebase is its own page under the job record: files, a transcript and the
    // log. It is routed here rather than through the compute host because it is not one of
    // the ledger's own surfaces.
    if (match.pattern === 'compute/jobs/:jobId/codebase') {
      return <JobCodebase jobId={match.params.jobId} />;
    }

    // The autoresearch page is its own screen: topics, their databases and their agents.
    if (match.pattern === 'compute/autoresearch') {
      return <AutoresearchView />;
    }

    // The ledger, the target list and the pack catalogue are their own screens, not specs:
    // each groups its records and each record has a page of its own.
    if (COMPUTE_PATTERNS.has(match.pattern)) {
      return <ComputeHost pattern={match.pattern} params={match.params} />;
    }
    if (PACK_PATTERNS.has(match.pattern)) {
      return <PackHost pattern={match.pattern} params={match.params} />;
    }

    // The Analyze pages are bespoke: a procedure workbench, a ledger with record pages and
    // a figure gallery with a drawer. They are not spec-backed, so they render directly.
    if (match.pattern === 'analyze/statistics') return <StatisticsWorkbench />;
    if (match.pattern === 'analyze/experiments') return <ExperimentsView />;
    if (match.pattern === 'analyze/experiments/new') return <ExperimentCreate />;
    if (match.pattern === 'analyze/experiments/:experimentId') {
      return <ExperimentDetail experimentId={match.params.experimentId} />;
    }
    if (match.pattern === 'analyze/figures') return <FiguresView />;
    // A figure's page is the studio: the document is the record.
    if (match.pattern === 'analyze/figures/:figureId')
      return <FigureStudio figureId={match.params.figureId} />;

    // A record page is its section's spec viewed through one id. The parameter is read from
    // the match rather than named here, so a new record route needs no change.
    if (match.isDetail) {
      const parentSpec = liveSpecs[match.parent] ?? SPECS[match.parent];
      const id = Object.values(match.params)[0];
      if (
        parentSpec &&
        (parentSpec.kind === 'catalog' || parentSpec.kind === 'data') &&
        parentSpec.records &&
        id
      ) {
        return (
          <ScrollShadow className="h-full">
            <RecordScreen spec={parentSpec} id={id} pattern={match.pattern} parent={match.parent} />
          </ScrollShadow>
        );
      }
    }

    const spec = liveSpecs[match.pattern] ?? SPECS[match.pattern];
    if (spec) {
      const record = match.pattern ? recordPatternFor(match.pattern) : undefined;
      return (
        <ScrollShadow className="h-full">
          <ScreenSpecView spec={spec} recordPattern={record} />
        </ScrollShadow>
      );
    }

    return <Unbuilt pattern={match.pattern} />;
  })();

  return (
    <div className="h-full min-h-0">
      <ErrorBoundary
        label={`The ${match.label} surface could not be drawn`}
        onReset={() => dispatch({ type: 'route/go', route: match.parent })}
      >
        <Suspense fallback={<ScreenLoading />}>{body}</Suspense>
      </ErrorBoundary>
    </div>
  );
}

/** Shown while a lazily-loaded screen's chunk arrives. */
function ScreenLoading() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Skeleton className="h-24 w-full max-w-md rounded-3xl" />
    </div>
  );
}

/** The record pattern filed under a view, so the view's list links to its records. */

/** A path with no screen yet. Shown rather than hidden, so gaps are visible. */
export function Unbuilt({ pattern }: { pattern: string }) {
  const { dispatch } = useApp();
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <Compass className="mx-auto size-6 text-muted" />
        <SectionLabel className="mt-3 justify-center">{pattern}</SectionLabel>
        <p className="mt-2 text-body text-muted">Routed, not built yet.</p>
        <Button
          variant="secondary"
          className="mt-4"
          onPress={() => dispatch({ type: 'route/go', route: 'research/tasks' })}
        >
          Back to the tracker
        </Button>
      </div>
    </div>
  );
}
