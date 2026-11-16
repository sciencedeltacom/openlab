/**
 * A job's record page.
 *
 * The ledger row answers "did it run". This answers the four questions a reader opens a run
 * for: what it ran, where it ran, what it read and wrote, and what happened at the end. The
 * command is kept verbatim because a run without its command is an anecdote; the log tail
 * stays collapsed because it is only read when something went wrong.
 */

import { useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Cpu,
  FileOutput,
  FolderInput,
  FolderTree,
  ListChecks,
  Server,
  Timer,
} from 'lucide-react';

import { Button, Collapsible, SectionLabel } from '@/components/ui';
import { RecordLink, RecordMissing, RecordPage, Fact, FactGroup } from '@/components/research/PageShell';
import { TaskRow } from '@/components/research/shared';
import { paths } from '@/app/routes';
import { cn } from '@/lib/cn';
import { useCopy } from '@/hooks/useCopy';
import { useApp, usePageTitle } from '@/store/app';
import { JobStateMark, ReadinessMark, TargetKindMark } from '../compute/Marks';
import { JOB_STATE_META, elapsedLabel, hoursLabel, type Job } from '../compute/data';

/** The command block's copy control. Clipboard access is secure-context only. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCopy();

  const onCopy = () => {
    copy(command, 'command');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Button size="sm" variant="ghost" className="gap-1.5" onPress={onCopy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/** One resource number, in the stat shape the record pages share. */
function Resource({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface p-3">
      <div className="text-meta text-muted">{label}</div>
      <div className="text-title tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** The inputs (read) or outputs (written) column. */
function Artifacts({
  title,
  items,
  kind,
}: {
  title: string;
  items: Job['inputs'];
  kind: 'input' | 'output';
}) {
  const Icon = kind === 'input' ? FolderInput : FileOutput;
  const route = kind === 'input' ? 'library/sources' : 'library/files';
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <SectionLabel>{title}</SectionLabel>
        <span className="text-meta tabular-nums text-muted">{items.length}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.ref}>
            <RecordLink
              route={route}
              className="flex w-full items-center gap-2.5 rounded-xl bg-surface px-3 py-2 transition-colors hover:bg-surface-tertiary"
            >
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-foreground">{item.ref}</span>
                {item.note && <span className="block truncate text-meta text-muted">{item.note}</span>}
              </span>
            </RecordLink>
          </li>
        ))}
        {items.length === 0 && <li className="px-1 text-body text-muted">None.</li>}
      </ul>
    </section>
  );
}

/** The page body, keyed by id so it re-reads cleanly when another job is opened. */
function JobDetailBody({ job }: { job: Job }) {
  usePageTitle(job.name);
  const { state } = useApp();
  const target = state.targets.find((candidate) => candidate.id === job.targetId);
  const tasks = state.tasks.filter((task) => job.taskKeys.includes(task.key));
  const started =
    job.startedMinutesAgo !== null ? `${elapsedLabel(job.startedMinutesAgo)} ago` : 'not started';

  return (
    <RecordPage
      eyebrow={
        <>
          <SectionLabel>Job</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{job.id}</span>
        </>
      }
      title={job.name}
      status={
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label',
            JOB_STATE_META[job.state].chip,
          )}
        >
          <JobStateMark state={job.state} className="size-4 rounded" />
          {JOB_STATE_META[job.state].label}
        </span>
      }
      lede={<p className="max-w-[70ch] text-body text-muted">{job.objective}</p>}
      aside={
        <FactGroup>
          <Fact icon={Server} label="Target">
            {target ? (
              <RecordLink
                route={paths.target(target.id)}
                className="flex w-full items-center gap-2 truncate text-link hover:underline"
              >
                <TargetKindMark kind={target.kind} className="size-4 rounded" />
                <span className="truncate">{target.name}</span>
              </RecordLink>
            ) : (
              <span className="text-muted">{job.targetId}</span>
            )}
          </Fact>
          <Fact icon={CalendarClock} label="Started">
            <span className="tabular-nums">{started}</span>
          </Fact>
          <Fact icon={Timer} label="Duration">
            <span className="tabular-nums">{job.duration}</span>
          </Fact>
          <Fact icon={Cpu} label="Hours">
            <span className="tabular-nums">
              {job.gpuHours !== null
                ? `${hoursLabel(job.gpuHours)} GPU-h`
                : job.cpuHours !== null
                  ? `${hoursLabel(job.cpuHours)} CPU-h`
                  : '—'}
            </span>
          </Fact>
          <Fact icon={CircleDollarSign} label="Cost">
            <span className="tabular-nums">{job.cost}</span>
          </Fact>
          <Fact icon={ListChecks} label="Tasks">
            <span className="tabular-nums">{tasks.length}</span>
          </Fact>
        </FactGroup>
      }
    >
      {job.error && (
        <section className="flex flex-col gap-1.5 rounded-3xl bg-danger/10 p-4">
          <SectionLabel>Why it failed</SectionLabel>
          <p className="text-body text-foreground">{job.error}</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SectionLabel>Command</SectionLabel>
          <div className="ml-auto">
            <CopyCommand command={job.command} />
          </div>
        </div>
        <pre className="overflow-x-auto rounded-2xl bg-surface p-4 text-meta text-foreground">
          {job.command}
        </pre>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Working directory</SectionLabel>
        <RecordLink
          route={paths.jobCodebase(job.id)}
          className="group flex w-full items-center gap-3 rounded-2xl bg-surface p-4 transition-colors hover:bg-surface-tertiary"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-secondary"
            aria-hidden
          >
            <FolderTree className="size-4 text-muted" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body text-foreground">Browse working directory</span>
            <span className="block truncate text-meta text-muted">
              Files, a read-only transcript of the run, and its log
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
        </RecordLink>
      </section>

      {target && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Where it ran</SectionLabel>
          <RecordLink
            route={paths.target(target.id)}
            className="group flex w-full items-center gap-3 rounded-2xl bg-surface p-4 transition-colors hover:bg-surface-tertiary"
          >
            <TargetKindMark kind={target.kind} className="size-9 rounded-xl" />
            <span className="min-w-0 flex-1">
              <span className="block text-body text-foreground">{target.name}</span>
              <span className="block truncate text-meta text-muted">
                {target.host} · {target.cores} cores · {target.memoryGb} GB
                {target.gpus ? ` · ${target.gpus}` : ''}
              </span>
            </span>
            <ReadinessMark readiness={target.readiness} className="hidden sm:flex" />
            <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
          </RecordLink>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Artifacts title="Inputs" items={job.inputs} kind="input" />
        <Artifacts title="Outputs" items={job.outputs} kind="output" />
      </div>

      <section className="flex flex-col gap-2">
        <SectionLabel>Resources</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Resource label="Cores" value={String(job.resources.cores)} />
          <Resource label="Memory" value={`${job.resources.memoryGb} GB`} />
          <Resource label="GPU" value={job.resources.gpus ?? 'none'} />
          <Resource label="Wall clock" value={job.resources.wallClock} />
        </div>
      </section>

      <Collapsible title="Log tail" count={job.logTail.length} defaultExpanded={false}>
        <pre className="overflow-x-auto rounded-2xl bg-surface p-3 text-meta text-muted">
          {job.logTail.join('\n')}
        </pre>
      </Collapsible>

      <section className="flex flex-col gap-2">
        <SectionLabel>State history</SectionLabel>
        <ol className="flex flex-col gap-2">
          {job.history.map((event, index) => (
            <li key={`${event.at}-${index}`} className="flex items-center gap-3">
              <JobStateMark state={event.state} />
              <span className="text-meta tabular-nums text-muted">{event.at}</span>
              <span className="text-body text-foreground">{JOB_STATE_META[event.state].label}</span>
              {event.note && <span className="min-w-0 truncate text-meta text-muted">{event.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Tasks</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{tasks.length}</span>
        </div>
        {tasks.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <p className="px-1 text-body text-muted">No tracker task is attached to this run.</p>
        )}
      </section>
    </RecordPage>
  );
}

/** A job's page; an unknown id gets the shared not-found state. */
export function JobDetail({ jobId }: { jobId: string }) {
  const { state } = useApp();
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    return <RecordMissing what="job" back="compute/jobs" backLabel="Jobs" />;
  }
  return <JobDetailBody key={job.id} job={job} />;
}
