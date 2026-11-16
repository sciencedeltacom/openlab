/**
 * Compute screens.
 *
 * Where a job runs is an operational choice, not a scientific one. The job spec is written
 * once, tested locally, and then sent to whichever target is cheapest, closest to the data,
 * or the only one with the hardware the run needs.
 *
 * The ledger and the target list have moved to their own components (`components/jobs` and
 * `components/targets`): they are grouped, filterable surfaces, not tables a spec can hold.
 * What stays here is the overview and the autoresearch guide.
 */

import { BarChart, ItemList, LineChart } from '@/components/screens/charts';
import { HOURS_BY_DAY } from '@/components/compute/data';
import type { RouteId } from '@/app/routes';
import type { ScreenSpec } from '@/components/screens/spec';

/** What compute is doing right now, as numbers rather than as a description of it. */
const overview: ScreenSpec = {
  kind: 'overview',
  stats: [
    { label: 'Running', value: '2', note: 'now', tone: 'accent' },
    { label: 'Queued', value: '1', note: 'waiting on 3 downloads' },
    { label: 'Succeeded', value: '9', note: 'last 7 days', tone: 'success' },
    { label: 'Failure rate', value: '7%', note: '1 of 14 jobs', tone: 'danger' },
  ],
  cards: [
    {
      id: 'status',
      title: 'Jobs by status',
      value: '14',
      note: 'Every run in the last seven days.',
      body: (
        <BarChart
          data={[
            { label: 'Succeeded', value: 9, tone: 'success' },
            { label: 'Running', value: 2, tone: 'accent' },
            { label: 'Queued', value: 1, tone: 'warning' },
            { label: 'Failed', value: 1, tone: 'danger' },
            { label: 'Cancelled', value: 1, tone: 'muted' },
          ]}
        />
      ),
    },
    {
      id: 'hours',
      title: 'Compute hours per day',
      value: '542 CPU-h',
      note: 'Last 14 days; the current wave began on Sep 29.',
      body: (
        <LineChart
          series={[
            { id: 'CPU', data: HOURS_BY_DAY.map((entry) => ({ x: entry.day, y: entry.cpu })) },
            {
              id: 'GPU',
              tone: 'success',
              data: HOURS_BY_DAY.map((entry) => ({ x: entry.day, y: entry.gpu })),
            },
          ]}
        />
      ),
    },
    {
      id: 'targets',
      title: 'Targets',
      value: '6 of 9',
      note: 'Connected; the rest need credentials or are staging only.',
      body: (
        <ItemList
          items={[
            {
              label: 'SLURM cluster',
              detail: 'Connected · 40k core-h allocation',
              value: '268 CPU-h',
              tone: 'accent',
            },
            { label: 'Lab server (SSH)', detail: 'Connected · lab-node-2', value: '200 CPU-h' },
            { label: 'AWS Batch', detail: 'Connected · us-east-1', value: '52 CPU-h' },
            { label: 'GPU workstation', detail: 'Connected · gpu-ws-01', value: '11.1 GPU-h' },
            { label: 'Modal', detail: 'Connected · serverless GPU', value: '5.6 GPU-h' },
            { label: 'GCP Batch', detail: 'Needs credentials', value: 'not runnable', tone: 'warning' },
          ]}
        />
      ),
    },
  ],
  next: [
    { label: 'Jobs', to: 'compute/jobs', hint: 'The full ledger with target, hours and output.' },
    { label: 'Targets', to: 'compute/targets', hint: 'What is connected, and what each one still needs.' },
    {
      label: 'Autoresearch',
      to: 'compute/autoresearch',
      hint: 'Questions the workbench researches against databases and agents.',
    },
  ],
};

/** Compute routes. The ledger and targets are built screens, handled by `ComputeHost`. */
export const computeScreens: Partial<Record<RouteId, ScreenSpec>> = {
  compute: overview,
};
