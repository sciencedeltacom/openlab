/**
 * Usage.
 *
 * What the workbench has spent, told per workspace. The numbers are the provider's own
 * accounting — every model call writes its token counts into the transcript — so this page
 * needs no server and no telemetry: it reads the same SQLite file the sessions live in.
 *
 * Two questions, in this order: what has *this* workspace used, and how do the workspaces on
 * this machine compare. A spend figure is deliberately absent: openlab does not hold provider
 * pricing, and a guessed cost is worse than none.
 */

import { useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';

import { LineTooltip } from '@/components/charts/tooltips';

import { SectionLabel, Table } from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { useChartPalette, useChartTheme, xAxis, yAxis } from '@/components/research/chartTheme';
import { useApp } from '@/store/app';
import { activeProject, type Message, type WorkspaceData } from '@/store/types';
import { snapshotWorkspace } from '@/store/workspace';

interface Run {
  at: number;
  modelRef: string;
  input: number;
  output: number;
  cached: number;
}

/** Every model call a workspace recorded, with its token accounting. */
function runsOf(workspace: WorkspaceData): Run[] {
  const runs: Run[] = [];
  for (const messages of Object.values(workspace.transcripts) as Message[][]) {
    for (const message of messages) {
      for (const block of message.blocks) {
        if (block.kind === 'run' && (block.tokensIn || block.tokensOut)) {
          runs.push({
            at: message.createdAt,
            modelRef: block.modelRef,
            input: block.tokensIn ?? 0,
            output: block.tokensOut ?? 0,
            cached: block.cachedTokens ?? 0,
          });
        }
      }
    }
  }
  return runs.sort((a, b) => a.at - b.at);
}

const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);
const total = (runs: readonly Run[]) => runs.reduce((sum, run) => sum + run.input + run.output, 0);
const cached = (runs: readonly Run[]) => runs.reduce((sum, run) => sum + run.cached, 0);
const calls = (runs: readonly Run[]) => runs.length;

/** Zero-filled days, so the chart draws even before anything has run. */
function dailySeries(runs: readonly Run[], days: number): { x: string; y: number }[] {
  const series: { x: string; y: number }[] = [];
  const index = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    index.set(dayKey(date.getTime()).slice(5), series.length);
    series.push({ x: dayKey(date.getTime()).slice(5), y: 0 });
  }
  for (const run of runs) {
    const at = index.get(dayKey(run.at).slice(5));
    if (at !== undefined) series[at]!.y += run.input + run.output;
  }
  return series;
}

/** One headline number. */
function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SectionLabel>{label}</SectionLabel>
      <span className="text-[1.4rem] leading-none font-semibold tabular-nums text-foreground">{value}</span>
      {hint && <span className="truncate text-meta text-muted">{hint}</span>}
    </div>
  );
}

/** A table of rows, in the shape the rest of the settings surface uses. */
function UsageTable({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    // The ledger is the point of the page, so it gets a surface of its own and room to breathe:
    // a table crowded into a paragraph's width is a table nobody reads.
    <div className="overflow-hidden rounded-3xl bg-surface p-2 [&_td]:py-3 [&_th]:py-3 [&_td]:text-body">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={label}>
            <Table.Header>
              {columns.map((column, index) => (
                <Table.Column
                  key={column}
                  isRowHeader={index === 0}
                  className={index === 0 ? undefined : 'text-end'}
                >
                  {column}
                </Table.Column>
              ))}
            </Table.Header>
            <Table.Body>
              {rows.map((row, index) => (
                <Table.Row key={String(row[0]) + index} id={String(row[0]) + index}>
                  {row.map((cell, cellIndex) => (
                    <Table.Cell
                      key={cellIndex}
                      className={cellIndex === 0 ? undefined : 'text-end tabular-nums'}
                    >
                      {typeof cell === 'number' ? cell.toLocaleString('en-US') : cell}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

export function UsageScreen() {
  const { state } = useApp();
  const palette = useChartPalette();
  const theme = useChartTheme();

  const project = activeProject(state);

  /** Every workspace on this machine, with the open one's live data folded in. */
  const workspaces = useMemo(
    () =>
      state.projects.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        path: candidate.path,
        active: candidate.id === project?.id,
        data: candidate.id === project?.id ? snapshotWorkspace(state) : candidate.workspace,
      })),
    [state, project?.id],
  );

  const now = new Date();
  const inMonth = (run: Run) => {
    const at = new Date(run.at);
    return at.getMonth() === now.getMonth() && at.getFullYear() === now.getFullYear();
  };

  const current = workspaces.find((workspace) => workspace.active);
  const currentRuns = current ? runsOf(current.data) : [];
  const monthRuns = currentRuns.filter(inMonth);

  const byModel = useMemo(() => {
    const totals = new Map<string, Run[]>();
    for (const run of currentRuns) {
      totals.set(run.modelRef, [...(totals.get(run.modelRef) ?? []), run]);
    }
    return [...totals.entries()]
      .map(([modelRef, runs]) => ({
        modelRef,
        calls: calls(runs),
        input: runs.reduce((sum, run) => sum + run.input, 0),
        output: runs.reduce((sum, run) => sum + run.output, 0),
        cached: cached(runs),
      }))
      .sort((a, b) => b.input + b.output - (a.input + a.output));
  }, [currentRuns]);

  const acrossWorkspaces = workspaces.map((workspace) => {
    const runs = runsOf(workspace.data);
    return {
      name: workspace.name,
      path: workspace.path,
      active: workspace.active,
      sessions: workspace.data.sessions.length,
      calls: calls(runs),
      tokens: total(runs),
      cached: cached(runs),
      last: runs.length > 0 ? new Date(runs[runs.length - 1]!.at).toISOString().slice(0, 10) : '—',
    };
  });

  const series = dailySeries(currentRuns, 14);

  return (
    <SettingsPage>
      <div className="flex w-full flex-col gap-8">
        <p className="text-body text-muted">
          Token counts come from the provider's reply and stay on this machine.
        </p>

        {current ? (
          <section className="flex flex-col gap-5 rounded-3xl bg-surface px-5 py-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <SectionLabel>{current.name}</SectionLabel>
              <span className="truncate font-mono text-meta text-muted">{current.path}</span>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-separator pt-5 lg:grid-cols-4">
              <Figure
                label="This month"
                value={total(monthRuns).toLocaleString('en-US')}
                hint={`${calls(monthRuns)} model call${calls(monthRuns) === 1 ? '' : 's'}`}
              />
              <Figure
                label="All time"
                value={total(currentRuns).toLocaleString('en-US')}
                hint={`${calls(currentRuns)} calls`}
              />
              <Figure
                label="Cached"
                value={cached(currentRuns).toLocaleString('en-US')}
                hint="served from the provider's cache"
              />
              <Figure
                label="Sessions"
                value={current.data.sessions.length.toLocaleString('en-US')}
                hint={`${current.data.tasks.length} task${current.data.tasks.length === 1 ? '' : 's'} tracked`}
              />
            </div>
          </section>
        ) : (
          <p className="rounded-3xl bg-surface px-5 py-6 text-body text-muted">
            No workspace is open. Open one to see what it has used.
          </p>
        )}

        {current && (
          <section className="flex flex-col gap-3">
            <header className="flex items-baseline gap-2">
              <SectionLabel>Tokens · 14 days</SectionLabel>
              <span className="ml-auto text-meta tabular-nums text-muted">
                {series.reduce((sum, day) => sum + day.y, 0).toLocaleString('en-US')} in this window
              </span>
            </header>
            <div className="h-[220px] rounded-3xl bg-surface p-4">
              <ResponsiveLine
                data={[{ id: 'tokens', color: palette.accent, data: series }]}
                theme={theme}
                margin={{ top: 10, right: 16, bottom: 44, left: 56 }}
                xScale={{ type: 'point' }}
                yScale={{ type: 'linear', min: 0, max: 'auto' }}
                curve="monotoneX"
                enableArea
                areaOpacity={0.12}
                colors={[palette.accent]}
                lineWidth={2}
                enablePoints={false}
                enableGridX={false}
                axisBottom={xAxis('Day')}
                axisLeft={yAxis('Tokens', (value) => `${Math.round(value / 1000)}k`)}
                enableSlices="x"
                sliceTooltip={({ slice }) => <LineTooltip slice={slice as never} />}
                animate={false}
              />
            </div>
          </section>
        )}

        {byModel.length > 0 && (
          <section className="flex flex-col gap-3">
            <SectionLabel>By model</SectionLabel>
            <UsageTable
              label="Usage by model"
              columns={['Model', 'Calls', 'Input', 'Output', 'Cached']}
              rows={byModel.map((model) => [
                model.modelRef,
                model.calls,
                model.input,
                model.output,
                model.cached,
              ])}
            />
          </section>
        )}

        <section className="flex flex-col gap-3">
          <header className="flex items-baseline gap-2">
            <SectionLabel>Workspaces</SectionLabel>
            <span className="ml-auto text-meta tabular-nums text-muted">
              {workspaces.length} on this machine
            </span>
          </header>
          {acrossWorkspaces.length === 0 ? (
            <p className="rounded-2xl bg-surface px-4 py-6 text-center text-body text-muted">
              No workspaces yet.
            </p>
          ) : (
            <UsageTable
              label="Usage by workspace"
              columns={['Workspace', 'Sessions', 'Calls', 'Tokens', 'Cached', 'Last call']}
              rows={acrossWorkspaces.map((workspace) => [
                workspace.active ? `${workspace.name} (open)` : workspace.name,
                workspace.sessions,
                workspace.calls,
                workspace.tokens,
                workspace.cached,
                workspace.last,
              ])}
            />
          )}
        </section>

        <p className="text-meta text-muted">
          No cost figure: openlab holds no provider pricing, and a guessed number would be worse than none.
        </p>
      </div>
    </SettingsPage>
  );
}
