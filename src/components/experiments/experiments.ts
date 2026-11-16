/**
 * The experiment ledger — its data model, and the domains that shape it.
 *
 * An experiment is a question with a criterion fixed before it ran: the design, the checks that
 * were planned, what would count as success, the trials that happened, the evidence the outcome
 * rests on, and the lesson. A **domain** is not an enum: it is a row the user defines, carrying
 * the design fields, trial fields and metric names that fit their work — genomics, ML, wet lab,
 * chemistry, anything. The values live in `designSpec` and each trial's `params`, so a new domain
 * never changes the schema.
 */

import type { Preregistration } from './preregistration';

import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Pencil,
  ScanSearch,
  SquareCheck,
  TestTube,
  type LucideIcon,
} from 'lucide-react';

/* ================================================================================================
 * Outcome and stage
 * ============================================================================================== */

/** How an experiment ended. */
export type ExperimentOutcome = 'running' | 'supported' | 'refuted' | 'inconclusive';

/** Where the experiment is in its life: drafted, pre-registered, running, settled. */
export type ExperimentStage = 'draft' | 'registered' | 'running' | 'settled';

/** How each outcome reads: its label, mark and tint, shared by the list and the record. */
export const OUTCOME_META: Record<ExperimentOutcome, { label: string; icon: LucideIcon; chip: string }> = {
  running: { label: 'Running', icon: CircleDashed, chip: 'bg-accent/15 text-accent' },
  supported: { label: 'Supported', icon: CircleCheck, chip: 'bg-success/15 text-success' },
  refuted: { label: 'Refuted', icon: CircleX, chip: 'bg-danger/15 text-danger' },
  inconclusive: { label: 'Inconclusive', icon: CircleHelp, chip: 'bg-warning/15 text-warning' },
};

/** The order outcomes are grouped in, from live to settled. */
export const OUTCOMES: ExperimentOutcome[] = ['running', 'supported', 'refuted', 'inconclusive'];

/** How each stage reads. */
export const STAGE_META: Record<ExperimentStage, { label: string; icon: LucideIcon }> = {
  draft: { label: 'Draft', icon: Pencil },
  registered: { label: 'Pre-registered', icon: SquareCheck },
  running: { label: 'Running', icon: CircleDashed },
  settled: { label: 'Settled', icon: CircleCheck },
};

/** The stages, in order. */
export const STAGES: ExperimentStage[] = ['draft', 'registered', 'running', 'settled'];

/* ================================================================================================
 * The record
 * ============================================================================================== */

/** How a planned run went. */
export type TrialStatus = 'planned' | 'running' | 'done' | 'failed' | 'excluded';

/** One measured value inside a trial. */
export interface TrialMetric {
  name: string;
  value: string;
  unit?: string;
  uncertainty?: string;
}

/** One run inside an experiment. */
export interface Trial {
  /** The run label, e.g. `T3`. */
  run: string;
  /** What was varied for this run. */
  condition: string;
  /** What was measured. */
  metric: string;
  /** What came back. */
  result: string;
  status?: TrialStatus;
  /** Domain-specific run parameters. */
  params?: Record<string, unknown>;
  /** Structured measurements, beyond the free-text result. */
  metrics?: TrialMetric[];
  /** Files or code the run produced. */
  artifacts?: { label: string; path: string }[];
  startedAt?: number | null;
  endedAt?: number | null;
  /** The compute job that produced it, when one did. */
  jobId?: string | null;
  taskId?: string | null;
  note?: string;
}

/** One number the outcome rests on. */
export interface EvidenceFact {
  label: string;
  value: string;
  unit?: string;
  /** `±0.03`, `95% CI 0.72–0.85`, and the like. */
  uncertainty?: string;
  sourceKind?: string;
  sourceId?: string;
  note?: string;
}

/** A cross-reference to another record. */
export interface ExperimentLink {
  kind: string;
  refId: string;
  label: string;
}

/** One change to the criterion, kept so a pre-registration cannot be quietly rewritten. */
export interface CriterionChange {
  at: number;
  field: string;
  from: string;
  to: string;
  reason: string;
}

/** The success criterion, fixed before the experiment ran. */
export interface Criterion {
  metric: string;
  comparator: '>=' | '>' | '<=' | '<' | '=' | 'in range';
  threshold: number | [number, number];
  unit?: string;
  /** Where it is judged, e.g. `frozen holdout v3`. */
  evaluatedOn?: string;
  /** When it was frozen (pre-registered); null while still a draft. */
  frozenAt: number | null;
  frozenBy: 'user' | 'agent';
  /** Every later edit, with its reason. */
  changes: CriterionChange[];
}

/** A kept or reverted trial with its declared criterion. */
export interface Experiment {
  id: string;
  /** The user's domain, or undefined for an experiment with no particular one. */
  domainId?: string;
  objective: string;
  hypothesis: string;
  design: string;
  /** The design facet, e.g. `Model comparison` or `Amplicon validation`. */
  designKind: string;
  stage: ExperimentStage;
  criterion?: Criterion;
  /** The plan locked before analysis, with its signature and deviations. */
  preregistration?: Preregistration;
  /** The checks planned before it ran. */
  checks: string[];
  /** Domain-specific design values, keyed by the domain's field keys. */
  designSpec: Record<string, unknown>;
  outcome: ExperimentOutcome;
  outcomeSummary: string;
  lesson: string;
  trials: Trial[];
  evidence: EvidenceFact[];
  links: ExperimentLink[];
  createdAt: number;
  updatedAt: number;
}

/* ================================================================================================
 * Domains — fields as data
 * ============================================================================================== */

/** The kind of control a field gets. */
export type FieldKind = 'text' | 'number' | 'select' | 'tags';

/** One field a domain declares. */
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  unit?: string;
  help?: string;
}

/** The fields a domain carries for each form. */
export interface DomainFields {
  design: FieldDef[];
  trial: FieldDef[];
  metrics: FieldDef[];
}

/** A domain the user defined: its own fields, no enum required. */
export interface ExperimentDomain {
  id: string;
  name: string;
  summary: string;
  mark: string;
  fields: DomainFields;
  /** A shipped example — editable and removable like any other. */
  builtIn: boolean;
}

/** The mark a domain wears, from its key. */
export const DOMAIN_MARKS: Record<string, { icon: LucideIcon }> = {
  code: { icon: Pencil },
  omics: { icon: ScanSearch },
  flask: { icon: TestTube },
  check: { icon: SquareCheck },
};

/** The domains a fresh workbench starts from. All are editable and removable. */
export const SEED_DOMAINS: ExperimentDomain[] = [
  {
    id: 'domain-computational',
    name: 'Computational',
    summary: 'A model, a benchmark, a metric, judged on a held-out split.',
    mark: 'code',
    builtIn: true,
    fields: {
      design: [
        { key: 'dataset', label: 'Dataset', kind: 'text' },
        { key: 'datasetVersion', label: 'Dataset version', kind: 'text' },
        { key: 'split', label: 'Split', kind: 'text' },
        { key: 'seeds', label: 'Seeds', kind: 'tags' },
        { key: 'environment', label: 'Environment', kind: 'text' },
      ],
      trial: [
        { key: 'seed', label: 'Seed', kind: 'number' },
        { key: 'learningRate', label: 'Learning rate', kind: 'number' },
        { key: 'batchSize', label: 'Batch size', kind: 'number' },
      ],
      metrics: [
        { key: 'auroc', label: 'AUROC', kind: 'number' },
        { key: 'loss', label: 'Loss', kind: 'number' },
      ],
    },
  },
  {
    id: 'domain-omics',
    name: 'Omics',
    summary: 'A cohort, a pipeline and a reference build.',
    mark: 'omics',
    builtIn: true,
    fields: {
      design: [
        { key: 'cohort', label: 'Cohort', kind: 'text' },
        {
          key: 'referenceBuild',
          label: 'Reference build',
          kind: 'select',
          options: ['GRCh38', 'GRCh37', 'mm10', 'other'],
        },
        { key: 'pipeline', label: 'Pipeline', kind: 'text' },
        { key: 'qc', label: 'QC thresholds', kind: 'text' },
      ],
      trial: [
        { key: 'batch', label: 'Batch', kind: 'text' },
        { key: 'depth', label: 'Minimum depth', kind: 'number' },
      ],
      metrics: [
        { key: 'peaks', label: 'Peaks called', kind: 'number' },
        { key: 'friP', label: 'FRiP', kind: 'number' },
      ],
    },
  },
  {
    id: 'domain-wet-lab',
    name: 'Wet lab',
    summary: 'A protocol, replicates and controls.',
    mark: 'flask',
    builtIn: true,
    fields: {
      design: [
        { key: 'protocol', label: 'Protocol', kind: 'text' },
        { key: 'replicates', label: 'Replicates', kind: 'number' },
        { key: 'controls', label: 'Controls', kind: 'text' },
        { key: 'instrument', label: 'Instrument', kind: 'text' },
      ],
      trial: [
        { key: 'plate', label: 'Plate', kind: 'text' },
        { key: 'timepoint', label: 'Timepoint', kind: 'text' },
      ],
      metrics: [
        { key: 'rate', label: 'Rate', kind: 'number', unit: '%' },
        { key: 'cv', label: 'CV', kind: 'number', unit: '%' },
      ],
    },
  },
  {
    id: 'domain-chemistry',
    name: 'Chemistry',
    summary: 'A target, a preparation and the engines that were tried.',
    mark: 'flask',
    builtIn: true,
    fields: {
      design: [
        { key: 'target', label: 'Target', kind: 'text' },
        { key: 'preparation', label: 'Receptor preparation', kind: 'text' },
        { key: 'engines', label: 'Engines', kind: 'tags' },
      ],
      trial: [
        { key: 'engine', label: 'Engine', kind: 'text' },
        { key: 'pose', label: 'Pose', kind: 'text' },
      ],
      metrics: [
        { key: 'score', label: 'Score', kind: 'number', unit: 'kcal/mol' },
        { key: 'rmsd', label: 'RMSD', kind: 'number', unit: 'Å' },
      ],
    },
  },
];
