/**
 * A target's record page.
 *
 * The card said whether the machine is ready. This says what it is, how it is reached, how
 * much of it is committed, what it costs, what it is waiting on, and which runs it has
 * carried recently. A reader lands here from a job row to answer "can this machine take the
 * next run, and what will it charge".
 */

import { useEffect, useState } from 'react';
import {
  Activity,
  Ban,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  Gauge,
  KeyRound,
  Network,
  PlugZap,
  Server,
} from 'lucide-react';

import { Button, Meter, SectionLabel } from '@/components/ui';
import { Fact, FactGroup, RecordLink, RecordMissing, RecordPage } from '@/components/research/PageShell';
import { paths } from '@/app/routes';
import { cn } from '@/lib/cn';
import { isDesktop } from '@/lib/ipc';
import { useApp, usePageTitle } from '@/store/app';
import { useTargetCheck } from '@/hooks/useCompute';
import { adapterFor } from '@/lib/compute/adapters';
import { storedSecretKeys } from '@/lib/compute/run';
import { JobStateMark, ReadinessMark } from '../compute/Marks';
import { READINESS_META, TARGET_KIND_META, elapsedLabel, hoursLabel, type Target } from '../compute/data';

/** The check's tone as an icon and a colour. */
const CHECK_TONE: Record<Target['check']['tone'], { icon: typeof CircleCheck; className: string }> = {
  success: { icon: CircleCheck, className: 'text-success' },
  warning: { icon: CircleAlert, className: 'text-warning' },
  danger: { icon: Ban, className: 'text-danger' },
};

/** One capacity number, in the stat shape the record pages share. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface p-3">
      <div className="text-meta text-muted">{label}</div>
      <div className="text-title tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** The page body, keyed by id so it re-reads cleanly when another target is opened. */
function TargetDetailBody({ target }: { target: Target }) {
  const { state } = useApp();
  usePageTitle(target.name);
  const meta = TARGET_KIND_META[target.kind];
  const check = CHECK_TONE[target.check.tone];
  const CheckIcon = check.icon;
  const adapter = adapterFor(target.kind);
  const checker = useTargetCheck();
  const [stored, setStored] = useState<string[] | null>(null);
  const jobs = state.jobs
    .filter((job) => job.targetId === target.id)
    .sort(
      (a, b) =>
        (a.startedMinutesAgo ?? Number.MAX_SAFE_INTEGER) - (b.startedMinutesAgo ?? Number.MAX_SAFE_INTEGER),
    );

  // Which credentials the keyring actually holds, rather than which were declared.
  useEffect(() => {
    let live = true;
    void storedSecretKeys(
      target.id,
      adapter.secrets.map((field) => field.key),
    ).then((keys) => {
      if (live) setStored(keys);
    });
    return () => {
      live = false;
    };
  }, [target.id, adapter]);

  return (
    <RecordPage
      eyebrow={<SectionLabel>Target</SectionLabel>}
      title={target.name}
      status={<ReadinessMark readiness={target.readiness} />}
      aside={
        <FactGroup>
          <Fact icon={Server} label="Kind">
            {meta.label}
          </Fact>
          <Fact icon={Network} label="Host">
            <span className="truncate">{target.host}</span>
          </Fact>
          <Fact icon={Activity} label="Status">
            {READINESS_META[target.readiness].label}
          </Fact>
          <Fact icon={Gauge} label="Concurrency">
            <span className="tabular-nums">
              {target.concurrency > 0 ? `${target.concurrency} jobs at once` : 'none'}
            </span>
          </Fact>
          <Fact icon={CircleDollarSign} label="Cost">
            <span className="tabular-nums">{target.cost}</span>
          </Fact>
          <Fact icon={KeyRound} label="Credentials">
            {adapter.secrets.length === 0 ? (
              <span className="text-muted">None</span>
            ) : (
              <span className="flex flex-col gap-1">
                {adapter.secrets.map((field) => {
                  const on = stored?.includes(field.key) ?? false;
                  return (
                    <span key={field.key} className="flex items-center gap-1.5">
                      <CircleCheck
                        className={cn('size-3.5 shrink-0', on ? 'text-success' : 'text-muted')}
                        aria-hidden
                      />
                      <span className="truncate">
                        {field.label}
                        {stored !== null && !on && <span className="text-muted"> · not set</span>}
                      </span>
                    </span>
                  );
                })}
              </span>
            )}
          </Fact>
        </FactGroup>
      }
    >
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Capacity</SectionLabel>
          {target.allocation && (
            <span className="ml-auto text-meta tabular-nums text-muted">
              {target.allocation.used.toLocaleString('en-US')} /{' '}
              {target.allocation.total.toLocaleString('en-US')} {target.allocation.unit}
            </span>
          )}
        </div>
        {target.allocation && (
          <Meter
            value={target.allocation.used}
            maxValue={target.allocation.total}
            color={
              target.allocation.total > 0 && target.allocation.used / target.allocation.total >= 0.9
                ? 'danger'
                : target.allocation.total > 0 && target.allocation.used / target.allocation.total >= 0.75
                  ? 'warning'
                  : 'accent'
            }
            size="sm"
            aria-label={`${target.name} allocation in use`}
            className="w-full"
          >
            <Meter.Track>
              <Meter.Fill />
            </Meter.Track>
          </Meter>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Cores" value={String(target.cores)} />
          <Stat label="Memory" value={`${target.memoryGb} GB`} />
          <Stat label="GPU" value={target.gpus ?? 'none'} />
          <Stat label="Concurrency" value={target.concurrency > 0 ? String(target.concurrency) : 'none'} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Configuration</SectionLabel>
        {adapter.config.length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-2xl bg-surface p-3 sm:grid-cols-2">
            {adapter.config.map((field) => (
              <div key={field.key} className="flex min-w-0 items-baseline gap-2">
                <dt className="shrink-0 text-meta text-muted">{field.label}</dt>
                <dd className="min-w-0 truncate text-body text-foreground">
                  {target.config?.[field.key] || <span className="text-muted">not set</span>}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-body text-muted">Nothing to configure for this kind.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div
          className={cn(
            'flex items-center gap-3 rounded-2xl p-3',
            target.check.tone === 'success'
              ? 'bg-success/10'
              : target.check.tone === 'warning'
                ? 'bg-warning/10'
                : 'bg-danger/10',
          )}
        >
          <CheckIcon className={cn('size-4 shrink-0', check.className)} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-body text-foreground">Connection check</span>
            <span className="block text-meta text-muted">{target.check.detail}</span>
          </span>
          <span className="shrink-0 text-meta tabular-nums text-muted">{target.check.at}</span>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 gap-1.5"
            isDisabled={checker.busyId === target.id || !isDesktop()}
            onPress={() => void checker.check(target)}
          >
            <PlugZap className="size-3.5" />
            {checker.busyId === target.id ? 'Checking…' : 'Check'}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>What it still needs</SectionLabel>
        {target.needs.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {target.needs.map((need) => (
              <li key={need} className="flex items-center gap-2.5 rounded-2xl bg-surface px-3 py-2">
                <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                <span className="text-body text-foreground">{need}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-2xl bg-success/10 px-3 py-2 text-body text-foreground">
            <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
            Ready to take a job.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Recent jobs</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{jobs.length}</span>
        </div>
        {jobs.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {jobs.map((job) => (
              <li key={job.id}>
                <RecordLink
                  route={paths.job(job.id)}
                  className="flex w-full items-center gap-2.5 rounded-xl bg-surface px-3 py-2 transition-colors hover:bg-surface-tertiary"
                >
                  <JobStateMark state={job.state} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-foreground">{job.name}</span>
                    <span className="block truncate text-meta text-muted">{job.id}</span>
                  </span>
                  <span className="shrink-0 text-meta tabular-nums text-muted">
                    {job.gpuHours !== null
                      ? `${hoursLabel(job.gpuHours)} GPU-h`
                      : job.cpuHours !== null
                        ? `${hoursLabel(job.cpuHours)} CPU-h`
                        : elapsedLabel(job.startedMinutesAgo ?? 0)}
                  </span>
                </RecordLink>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-1 text-body text-muted">
            <Server className="size-4 shrink-0" aria-hidden />
            No job has run here yet.
          </p>
        )}
      </section>
    </RecordPage>
  );
}

/** A target's page; an unknown id gets the shared not-found state. */
export function TargetDetail({ targetId }: { targetId: string }) {
  const { state } = useApp();
  const target = state.targets.find((candidate) => candidate.id === targetId);
  if (!target) {
    return <RecordMissing what="target" back="compute/targets" backLabel="Targets" />;
  }
  return <TargetDetailBody key={target.id} target={target} />;
}
