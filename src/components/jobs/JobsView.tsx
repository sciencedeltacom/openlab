/**
 * The job ledger, rebuilt as a dense list and a board.
 *
 * A table of fourteen rows hid the two facts that matter in a queue — what is live and what
 * broke. Here the ledger groups by state, carries a thin progress line under every running
 * row, and puts a failed run's reason on the row rather than behind a click. The same rows
 * are switchable to a board so a reader can watch the queue drain.
 *
 * The header keeps the one chart that belongs here: compute hours per day. Everything else a
 * reader might want is a filter or a record page.
 */

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Ban,
  Copy,
  ExternalLink,
  Filter,
  LayoutList,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import {
  Button,
  Chip,
  Dialog,
  Input,
  Label,
  Popover,
  ProgressBar,
  ScrollShadow,
  NumberInput,
  SectionLabel,
  Select,
  Tabs,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
} from '@/components/ui';
import { RenameModal, RowMenu, type RowAction } from '@/components/common/RowMenu';
import { LineChart } from '@/components/screens/charts';
import { useFacetFilter, type FacetDef } from '@/hooks/useFacetFilter';
import { useJobRunner, useJobs } from '@/hooks/useCompute';
import { usePolled } from '@/hooks/usePolled';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import { paths } from '@/app/routes';
import { MOTION } from '@/theme/tokens';
import { FacetRow } from '../compute/Facets';
import { JobStateMark, TargetKindMark } from '../compute/Marks';
import {
  HOURS_BY_DAY,
  JOB_STATE_META,
  JOB_STATES,
  elapsedLabel,
  hoursLabel,
  type Job,
} from '../compute/data';

/* ================================================================================================
 * Header
 * ============================================================================================== */

/** One headline number, the stat shape the record pages already use. */
function Stat({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'default' | 'accent' | 'success' | 'danger';
}) {
  const colour =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'success'
        ? 'text-success'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-foreground';
  return (
    <div className="rounded-2xl bg-surface p-3">
      <div className="text-meta text-muted">{label}</div>
      <div className={cn('text-title tabular-nums', colour)}>{value}</div>
      {note && <div className="text-meta text-muted">{note}</div>}
    </div>
  );
}

/* ================================================================================================
 * Rows
 * ============================================================================================== */

/** The hours line a row carries: GPU where a card ran, CPU otherwise, a dash when neither. */
function hoursOf(job: Job): string {
  if (job.gpuHours !== null) return `${hoursLabel(job.gpuHours)} GPU-h`;
  if (job.cpuHours !== null) return `${hoursLabel(job.cpuHours)} CPU-h`;
  return '—';
}

/** How long a run has been going: live for a running job, settled otherwise. */
function durationOf(job: Job, now: number, mountedAt: number): string {
  if (job.state === 'running' && job.startedMinutesAgo !== null) {
    return elapsedLabel(job.startedMinutesAgo + (now - mountedAt) / 60_000);
  }
  return job.duration;
}

/** One ledger row. Clicking opens the job's own page. */
function JobRow({
  job,
  now,
  mountedAt,
  actions,
}: {
  job: Job;
  now: number;
  mountedAt: number;
  actions: RowAction[];
}) {
  const { state, dispatch } = useApp();
  const target = state.targets.find((candidate) => candidate.id === job.targetId);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => dispatch({ type: 'route/go', route: paths.job(job.id) })}
        className="flex w-full flex-col gap-1.5 rounded-xl px-2.5 py-1.5 pr-9 text-left transition-colors hover:bg-surface"
      >
        <div className="flex items-center gap-2.5">
          <JobStateMark state={job.state} />
          <span className="w-[68px] shrink-0 text-meta tabular-nums text-muted">{job.id}</span>
          <span className="min-w-0 flex-1 truncate text-body text-foreground">{job.name}</span>
          {job.state === 'failed' && job.error && (
            <span className="hidden min-w-0 max-w-[40%] shrink-0 truncate text-meta text-danger lg:block">
              {job.error}
            </span>
          )}
          <span className="hidden w-[140px] shrink-0 items-center gap-1.5 text-meta text-muted md:flex">
            {target && <TargetKindMark kind={target.kind} className="size-4 rounded" />}
            <span className="truncate">{target?.name ?? job.targetId}</span>
          </span>
          <span className="hidden w-[80px] shrink-0 justify-end text-meta tabular-nums text-muted sm:flex">
            {durationOf(job, now, mountedAt)}
          </span>
          <span className="hidden w-[88px] shrink-0 justify-end text-meta tabular-nums text-foreground lg:flex">
            {hoursOf(job)}
          </span>
          <span className="w-[60px] shrink-0 text-right text-meta tabular-nums text-muted">{job.cost}</span>
        </div>

        {job.state === 'running' && job.progress !== null && (
          <div className="flex items-center gap-2 pl-[30px] pr-1">
            <ProgressBar
              value={Math.round(job.progress * 100)}
              size="sm"
              color="accent"
              aria-label={`${job.name} progress`}
              className="flex-1"
            >
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
            <span className="w-8 text-right text-meta tabular-nums text-muted">
              {Math.round(job.progress * 100)}%
            </span>
          </div>
        )}
      </button>
      <div className="absolute right-1.5 top-1.5 z-10">
        <RowMenu label={`Actions for ${job.id}`} actions={actions} />
      </div>
    </div>
  );
}

/** One board card: the same facts as a row, stacked so a column reads as a queue. */
function BoardCard({ job, actions }: { job: Job; actions: RowAction[] }) {
  const { state, dispatch } = useApp();
  const target = state.targets.find((candidate) => candidate.id === job.targetId);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => dispatch({ type: 'route/go', route: paths.job(job.id) })}
        className="w-full rounded-2xl bg-surface p-3 pr-9 text-left transition-colors hover:bg-surface-tertiary"
      >
        <div className="flex items-center gap-2">
          <span className="text-meta tabular-nums text-muted">{job.id}</span>
          <span className="ml-auto flex items-center gap-1.5 text-meta text-muted">
            {target && <TargetKindMark kind={target.kind} className="size-4 rounded" />}
            <span className="truncate">{target?.name ?? job.targetId}</span>
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-body text-foreground">{job.name}</p>
        {job.state === 'failed' && job.error && (
          <p className="mt-1 line-clamp-2 text-meta text-danger">{job.error}</p>
        )}
        {job.state === 'running' && job.progress !== null && (
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar
              value={Math.round(job.progress * 100)}
              size="sm"
              color="accent"
              aria-label={`${job.name} progress`}
              className="flex-1"
            >
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
            <span className="text-meta tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
          </div>
        )}
        <div className="mt-2.5 flex items-center gap-3 text-meta tabular-nums text-muted">
          <span>{job.duration}</span>
          <span className="text-foreground">{hoursOf(job)}</span>
          <span className="ml-auto">{job.cost}</span>
        </div>
      </button>
      <div className="absolute right-1.5 top-1.5 z-10">
        <RowMenu label={`Actions for ${job.id}`} actions={actions} />
      </div>
    </div>
  );
}

/* ================================================================================================
 * Filters
 * ============================================================================================== */

const FACETS = ['state', 'target'] as const;
type Facet = (typeof FACETS)[number];

const FACET_LABEL: Record<Facet, string> = {
  state: 'State',
  target: 'Target',
};

/** The facets the list narrows by, defined once so the filter state is stable across renders. */
const JOB_FACETS: FacetDef<Job>[] = [
  { id: 'state', valuesOf: (job) => [job.state] },
  { id: 'target', valuesOf: (job) => [job.targetId] },
];

/** The text a job search matches. */
function searchText(job: Job): string {
  return [job.id, job.name].join(' ');
}

/** A tick that only re-renders the list so running jobs' elapsed times move. */
function noop(): void {}

/* ================================================================================================
 * Creation
 * ============================================================================================== */

/** The creation dialog for a job: target, command and the resource request. */
function NewJobModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (job: Job) => void;
}) {
  const { state } = useApp();
  const [name, setName] = useState('');
  const [targetId, setTargetId] = useState(state.targets[0]?.id ?? '');
  const [command, setCommand] = useState('');
  const [cores, setCores] = useState('4');
  const [memory, setMemory] = useState('16');
  const [wallClock, setWallClock] = useState('no limit (local)');

  const target = state.targets.find((candidate) => candidate.id === targetId);
  const canSubmit =
    Boolean(name.trim() && command.trim() && target) && Number(cores) > 0 && Number(memory) > 0;

  const submit = () => {
    if (!target) return;
    onCreate({
      id: `job-${crypto.randomUUID().slice(0, 4)}`,
      name: name.trim(),
      state: 'queued',
      targetId: target.id,
      startedMinutesAgo: null,
      duration: '—',
      progress: null,
      cpuHours: null,
      gpuHours: null,
      cost: target.cost,
      command: command.trim(),
      inputs: [],
      outputs: [],
      resources: {
        cores: Number(cores),
        memoryGb: Number(memory),
        wallClock: wallClock.trim() || 'no limit',
      },
      logTail: ['queued; waiting on a free slot'],
      history: [{ at: 'queued', state: 'queued', note: 'submitted from the ledger' }],
      taskKeys: [],
      objective: name.trim(),
    });
    setName('');
    setCommand('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="New job"
      description="Queue a command against a target the project can already reach."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!canSubmit} onPress={submit}>
            Queue job
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label className="text-label">Name</Label>
        <Input
          variant="secondary"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="What the run is for"
          aria-label="Job name"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-label">Target</Label>
        <Select
          label="Target"
          value={targetId}
          options={state.targets.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          onChange={setTargetId}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-label">Command</Label>
        <TextArea
          variant="secondary"
          rows={2}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="openlab run …"
          aria-label="Command"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-label">Resource request</Label>
        <div className="flex items-center gap-2">
          <NumberInput
            label="Cores"
            min={1}
            value={cores ? Number(cores) : undefined}
            onChange={(next) => setCores(next === undefined ? '' : String(next))}
            className="flex-1"
          />
          <NumberInput
            label="Memory in gigabytes"
            min={1}
            value={memory ? Number(memory) : undefined}
            onChange={(next) => setMemory(next === undefined ? '' : String(next))}
            className="flex-1"
          />
          <Input
            variant="secondary"
            value={wallClock}
            onChange={(event) => setWallClock(event.target.value)}
            placeholder="Wall clock"
            aria-label="Wall clock limit"
            className="flex-1"
          />
        </div>
      </div>
    </Dialog>
  );
}

/** The job ledger: stats, one chart, a searchable list or board. */
export function JobsView() {
  const { state, dispatch } = useApp();
  const edits = useJobs();
  const runner = useJobRunner();
  const jobs = edits.items;
  const [layout, setLayout] = useState<'list' | 'board'>('list');
  const [facet, setFacet] = useState<Facet>('state');
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Job | null>(null);

  /** The actions a ledger row or board card offers. */
  const actionsFor = (job: Job): RowAction[] => [
    {
      id: 'open',
      label: 'View details',
      icon: ExternalLink,
      onSelect: () => dispatch({ type: 'route/go', route: paths.job(job.id) }),
    },
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setRenameTarget(job) },
    {
      id: 'cancel',
      label: 'Cancel job',
      icon: Ban,
      onSelect: () => edits.patch(job.id, { state: 'cancelled' }, `Cancelled “${job.name}”`),
    },
    {
      id: 'retry',
      label: 'Retry',
      icon: RefreshCw,
      onSelect: () => void runner.run(job),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      onSelect: () =>
        edits.add(
          { ...job, id: `${job.id}-copy`, name: `${job.name} (copy)`, state: 'queued' },
          `${job.name} (copy)`,
        ),
    },
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => edits.remove(job.id, job.name),
    },
  ];

  // Only live jobs need the clock; a ledger of settled runs ticks for nothing.
  const live = jobs.some((job) => job.state === 'queued' || job.state === 'running');
  const now = usePolled(noop, 1000, live);
  const mountedAt = useRef(now).current;

  const filter = useFacetFilter(jobs, { facets: JOB_FACETS, searchOf: searchText });
  const filtered = filter.rows;
  const activeCount = filter.activeCount;
  const clearAll = filter.clear;

  const groups = useMemo(
    () =>
      JOB_STATES.map((state) => ({ state, jobs: filtered.filter((job) => job.state === state) })).filter(
        (group) => group.jobs.length > 0,
      ),
    [filtered],
  );

  const running = jobs.filter((job) => job.state === 'running').length;
  const queued = jobs.filter((job) => job.state === 'queued').length;
  const cpuTotal = HOURS_BY_DAY.reduce((sum, day) => sum + day.cpu, 0);
  const gpuTotal = HOURS_BY_DAY.reduce((sum, day) => sum + day.gpu, 0);
  const estimatedCost = jobs.reduce((sum, job) => {
    const match = job.cost.match(/[0-9]+(?:\.[0-9]+)?/);
    return sum + (job.cost.startsWith('≈') && match ? Number(match[0]) : 0);
  }, 0);

  return (
    <ScrollShadow className="h-full min-h-0">
      <div className="mx-auto flex w-full flex-col gap-4 px-6 py-6">
        <p className="text-body text-muted">
          Every run with its target, its hours and its output. Cancelled and failed runs stay in the ledger.
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Running" value={String(running)} note="now" tone="accent" />
          <Stat label="Queued" value={String(queued)} note="waiting on downloads" />
          <Stat
            label="CPU / GPU hours"
            value={`${hoursLabel(Math.round(cpuTotal))} · ${hoursLabel(gpuTotal)}`}
            note="last 14 days"
          />
          <Stat label="Estimated cost" value={`≈$${estimatedCost.toFixed(2)}`} note="last 14 days" />
        </div>

        <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
          <div className="flex items-baseline gap-2">
            <SectionLabel>Compute hours per day</SectionLabel>
            <span className="ml-auto text-meta tabular-nums text-muted">last 14 days</span>
          </div>
          <LineChart
            series={[
              { id: 'CPU', data: HOURS_BY_DAY.map((day) => ({ x: day.day, y: day.cpu })) },
              {
                id: 'GPU',
                tone: 'success',
                data: HOURS_BY_DAY.map((day) => ({ x: day.day, y: day.gpu })),
              },
            ]}
          />
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted" />
            <Input
              type="search"
              value={filter.query}
              onChange={(event) => filter.setQuery(event.target.value)}
              placeholder="Search jobs, studies, targets…"
              aria-label="Search jobs"
              className="w-full pl-9"
            />
          </div>

          <ToggleButtonGroup
            aria-label="Job layout"
            selectionMode="single"
            selectedKeys={[layout]}
            onSelectionChange={(keys) => {
              const [next] = keys as Set<string>;
              if (next) setLayout(next as 'list' | 'board');
            }}
          >
            <ToggleButton id="list" aria-label="List">
              <LayoutList className="size-3.5" />
            </ToggleButton>
            <ToggleButton id="board" aria-label="Board">
              <Rows3 className="size-3.5" />
            </ToggleButton>
          </ToggleButtonGroup>

          <Popover
            trigger={
              <Button size="sm" variant={activeCount ? 'secondary' : 'ghost'} className="gap-1.5">
                <Filter className="size-3.5" />
                Filter
                {activeCount > 0 && <Chip size="sm">{activeCount}</Chip>}
              </Button>
            }
            className="w-[280px]"
          >
            <Tabs selectedKey={facet} onSelectionChange={(key) => setFacet(key as Facet)}>
              <Tabs.ListContainer className="mx-1 mt-1">
                <Tabs.List aria-label="Filter jobs by">
                  {FACETS.map((id) => (
                    <Tabs.Tab key={id} id={id}>
                      {FACET_LABEL[id]}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>

              <Tabs.Panel id="state">
                <ScrollShadow className="max-h-[320px] px-1">
                  {JOB_STATES.map((state) => (
                    <FacetRow
                      key={state}
                      on={filter.isOn('state', state)}
                      mark={<JobStateMark state={state} />}
                      label={JOB_STATE_META[state].label}
                      onPress={() => filter.setOnly('state', filter.isOn('state', state) ? null : state)}
                    />
                  ))}
                </ScrollShadow>
              </Tabs.Panel>

              <Tabs.Panel id="target">
                <ScrollShadow className="max-h-[320px] px-1">
                  {state.targets.map((target) => (
                    <FacetRow
                      key={target.id}
                      on={filter.isOn('target', target.id)}
                      mark={<TargetKindMark kind={target.kind} />}
                      label={target.name}
                      onPress={() =>
                        filter.setOnly('target', filter.isOn('target', target.id) ? null : target.id)
                      }
                    />
                  ))}
                </ScrollShadow>
              </Tabs.Panel>
            </Tabs>

            <footer className="flex items-center gap-2 px-2 pb-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                isDisabled={activeCount === 0}
                onPress={clearAll}
                className="gap-1.5"
              >
                <X className="size-3.5" />
                Clear all
              </Button>
              {activeCount > 0 && (
                <span className="ml-auto text-meta tabular-nums text-muted">{activeCount} selected</span>
              )}
            </footer>
          </Popover>

          <div className="ml-auto">
            <Button size="sm" variant="primary" className="gap-1.5" onPress={() => setCreateOpen(true)}>
              <Plus className="size-3.5" />
              New job
            </Button>
          </div>
        </div>

        <NewJobModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={(job) => {
            edits.add(job, job.name);
            // The ledger is a record of runs that happened, so queueing a job sends it.
            void runner.run(job);
          }}
        />

        <RenameModal
          open={renameTarget !== null}
          title="Rename job"
          value={renameTarget?.name ?? ''}
          onClose={() => setRenameTarget(null)}
          onSubmit={(name) => {
            if (renameTarget) edits.rename(renameTarget.id, name, renameTarget.name);
          }}
        />

        {filtered.length === 0 && (
          <div className="grid place-items-center rounded-3xl bg-surface px-6 py-16 text-center">
            <div>
              <Search className="mx-auto size-5 text-muted" aria-hidden />
              <p className="mt-2 text-body text-muted">No job matches the current filter.</p>
            </div>
          </div>
        )}

        {layout === 'list' && filtered.length > 0 && (
          <div className="flex flex-col">
            {groups.map((group) => (
              <section key={group.state} className="mt-4 first:mt-0">
                <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label',
                      JOB_STATE_META[group.state].chip,
                    )}
                  >
                    <JobStateMark state={group.state} className="size-4 rounded" />
                    {JOB_STATE_META[group.state].label}
                  </span>
                  <span className="text-meta tabular-nums text-muted">{group.jobs.length}</span>
                </header>
                <div className="flex flex-col gap-0.5">
                  {group.jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      now={now}
                      mountedAt={mountedAt}
                      actions={actionsFor(job)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {layout === 'board' && filtered.length > 0 && (
          <div className="flex min-h-0 gap-3 overflow-x-auto pb-3">
            {groups.map((group) => (
              <section key={group.state} className="flex w-[300px] shrink-0 flex-col gap-1.5">
                <header className="flex items-center gap-2 px-1.5 py-1">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label',
                      JOB_STATE_META[group.state].chip,
                    )}
                  >
                    <JobStateMark state={group.state} className="size-4 rounded" />
                    {JOB_STATE_META[group.state].label}
                  </span>
                  <span className="text-meta tabular-nums text-muted">{group.jobs.length}</span>
                </header>
                <AnimatePresence initial={false}>
                  {group.jobs.map((job) => (
                    <motion.div
                      key={job.id}
                      layout
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: MOTION.duration.micro, ease: MOTION.micro }}
                    >
                      <BoardCard job={job} actions={actionsFor(job)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </section>
            ))}
          </div>
        )}
      </div>
    </ScrollShadow>
  );
}
