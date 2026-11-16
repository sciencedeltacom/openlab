/**
 * The compute ledger and the targets it runs on.
 *
 * Jobs and targets are two views of one fact — a run happened somewhere — so they share a
 * module. The list screens read the ledger for rows and the target table for the machine a
 * row names; the record screens read the same two tables for everything else. One source,
 * so a job's target cannot disagree with the target's own page.
 *
 * The numbers here are the seed data the workbench ships with; a real workspace replaces
 * them at runtime.
 */

import {
  Ban,
  Boxes,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Cloud,
  CloudCog,
  Cloudy,
  Cpu,
  Laptop,
  Loader,
  Network,
  Server,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

/* ================================================================================================
 * Targets
 * ============================================================================================== */

// The target and job records are domain, not presentation; they live with the store and are
// re-exported here so the screens keep one import path.
import type { JobState, Readiness, TargetKind } from '@/store/compute';
export type { Allocation, Readiness, Target, TargetKind } from '@/store/compute';

/** A kind's label, icon and tint. The icon says where a job runs before the name is read. */
export const TARGET_KIND_META: Record<TargetKind, { label: string; icon: LucideIcon; chip: string }> = {
  local: { label: 'Local', icon: Laptop, chip: 'bg-surface-tertiary text-foreground' },
  ssh: { label: 'SSH', icon: Server, chip: 'bg-accent/15 text-accent' },
  modal: { label: 'Modal', icon: Boxes, chip: 'bg-accent/15 text-accent' },
  kaggle: { label: 'Kaggle', icon: Trophy, chip: 'bg-accent/15 text-accent' },
  slurm: { label: 'SLURM', icon: Network, chip: 'bg-success/15 text-success' },
  aws: { label: 'AWS Batch', icon: Cloud, chip: 'bg-warning/15 text-warning' },
  gcp: { label: 'GCP Batch', icon: Cloudy, chip: 'bg-warning/15 text-warning' },
  azure: { label: 'Azure Batch', icon: CloudCog, chip: 'bg-warning/15 text-warning' },
  hpc: { label: 'HPC login', icon: Cpu, chip: 'bg-surface-tertiary text-muted' },
};

/** Readiness as a section heading and a chip: one vocabulary for the list and the page. */
export const READINESS_META: Record<
  Readiness,
  { label: string; chip: string; icon: LucideIcon; heading: string }
> = {
  ready: { label: 'Connected', chip: 'bg-success/15 text-success', icon: CircleCheck, heading: 'Ready' },
  'needs-setup': {
    label: 'Needs setup',
    chip: 'bg-warning/15 text-warning',
    icon: CircleAlert,
    heading: 'Needs setup',
  },
  offline: { label: 'Offline', chip: 'bg-surface-tertiary text-muted', icon: Ban, heading: 'Offline' },
};

/** The order readiness groups render in. Ready first, because it is what a reader wants. */
export const READINESS_ORDER: Readiness[] = ['ready', 'needs-setup', 'offline'];

/* ================================================================================================
 * Jobs
 * ============================================================================================== */

export type { Artifact, Job, JobEvent, JobState } from '@/store/compute';

/** A state's label, icon and tint. One definition shared by the row, board, filter and page. */
export const JOB_STATE_META: Record<JobState, { label: string; icon: LucideIcon; chip: string }> = {
  queued: { label: 'Queued', icon: CircleDashed, chip: 'bg-warning/15 text-warning' },
  running: { label: 'Running', icon: Loader, chip: 'bg-accent/15 text-accent' },
  succeeded: { label: 'Succeeded', icon: CircleCheck, chip: 'bg-success/15 text-success' },
  failed: { label: 'Failed', icon: CircleAlert, chip: 'bg-danger/15 text-danger' },
  cancelled: { label: 'Cancelled', icon: Ban, chip: 'bg-surface-tertiary text-muted' },
};

/** The order states render in: live work first, then the settled runs. */
export const JOB_STATES: JobState[] = ['running', 'queued', 'succeeded', 'failed', 'cancelled'];

/** One day's average utilisation, as the utilisation chart plots it. */
export interface HourlyLoad {
  day: string;
  cpu: number;
  gpu: number;
}

/** Utilisation per weekday. Empty until runs are recorded. */
export const HOURS_BY_DAY: HourlyLoad[] = [];

/**
 * A span of minutes as a reader says it: `48 m`, `2 h 11 m`, `1 d 4 h`.
 *
 * Deliberately not `formatDuration`, which works in milliseconds and carries seconds the
 * ledger never shows.
 */
export function elapsedLabel(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)} m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours < 24) return mins ? `${hours} h ${String(mins).padStart(2, '0')} m` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** A number of hours as the ledger shows it: one decimal, thinned of a trailing `.0`. */
export function hoursLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
