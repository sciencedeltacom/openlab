/**
 * The experiment ledger, live.
 *
 * A small external store, the way databases and reviews are kept, so the ledger screens and the
 * agent's tools read and write one list without threading a slice through the app store. Domains
 * and experiments are written to the app's SQLite file; on a fresh machine the shipped domains
 * are seeded and then belong to the user.
 */

import { useSyncExternalStore } from 'react';

import { getDb, serialized } from '@/lib/db/client';
import { loadDomains, loadExperiments, saveDomains, saveExperiments } from '@/lib/db/experiments';
import {
  hashPlan,
  planOf,
  verifyPreregistration,
  type Deviation,
  type Preregistration,
  type PreregistrationPlan,
} from './preregistration';
import {
  SEED_DOMAINS,
  type Experiment,
  type ExperimentDomain,
  type ExperimentOutcome,
  type ExperimentStage,
  type Trial,
} from './experiments';

let domains: ExperimentDomain[] = [];
let experiments: Experiment[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Fill the ledger from the database. Called once, by `bootStorage`. */
export async function hydrateExperiments(): Promise<void> {
  const db = getDb();
  if (!db) {
    domains = [...SEED_DOMAINS];
    experiments = [];
    emit();
    return;
  }
  domains = await loadDomains(db);
  if (domains.length === 0) {
    domains = [...SEED_DOMAINS];
    void serialized(() => saveDomains(db, domains));
  }
  experiments = await loadExperiments(db);
  emit();
}

function persistDomains(): void {
  const db = getDb();
  if (!db) {
    return;
  }
  void serialized(() => saveDomains(db, domains)).catch((error) => {
    console.error('openlab could not write the experiment domains', error);
  });
}

function persistExperiments(): void {
  const db = getDb();
  if (!db) {
    return;
  }
  void serialized(() => saveExperiments(db, experiments)).catch((error) => {
    console.error('openlab could not write the experiments', error);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The domains, live. */
export function useDomains(): ExperimentDomain[] {
  return useSyncExternalStore(subscribe, () => domains);
}

/** The experiments, live. */
export function useExperiments(): Experiment[] {
  return useSyncExternalStore(subscribe, () => experiments);
}

/** A domain by id. */
export function domainById(id: string | undefined): ExperimentDomain | undefined {
  return id ? domains.find((domain) => domain.id === id) : undefined;
}

/** An experiment by id. */
export function experimentById(id: string): Experiment | undefined {
  return experiments.find((experiment) => experiment.id === id);
}

/** The experiments, for readers that are not components — the agent's tools. */
export function allExperiments(): Experiment[] {
  return experiments;
}

/** The domains, for readers that are not components — the agent's tools. */
export function allDomains(): ExperimentDomain[] {
  return domains;
}

/** Build an experiment, add it, and return it — the create the agent calls. */
export function createExperiment(input: Partial<Experiment>): Experiment {
  const experiment = newExperiment(input);
  addExperiment(experiment);
  return experiment;
}

/* ================================================================================================
 * Domains
 * ============================================================================================== */

/** Add a domain, in front of the list. */
export function addDomain(domain: ExperimentDomain): void {
  domains = [domain, ...domains];
  persistDomains();
  emit();
}

/* ================================================================================================
 * Experiments
 * ============================================================================================== */

/** The shape a new experiment starts from, before any field is filled. */
export function newExperiment(input: Partial<Experiment> = {}): Experiment {
  const now = Date.now();
  return {
    id: input.id ?? `EXP-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    domainId: input.domainId,
    objective: input.objective ?? '',
    hypothesis: input.hypothesis ?? '',
    design: input.design ?? '',
    designKind: input.designKind ?? '',
    stage: input.stage ?? 'draft',
    criterion: input.criterion,
    checks: input.checks ?? [],
    designSpec: input.designSpec ?? {},
    outcome: input.outcome ?? 'running',
    outcomeSummary: input.outcomeSummary ?? '',
    lesson: input.lesson ?? '',
    trials: input.trials ?? [],
    evidence: input.evidence ?? [],
    links: input.links ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

/** Add an experiment to the front of the ledger. */
export function addExperiment(experiment: Experiment): void {
  experiments = [experiment, ...experiments];
  persistExperiments();
  emit();
}

/** Write without the pre-registration guard; only the lock and a deviation use it. */
function writeExperiment(id: string, patch: Partial<Experiment>): void {
  experiments = experiments.map((experiment) =>
    experiment.id === id ? { ...experiment, ...patch, id, updatedAt: Date.now() } : experiment,
  );
  persistExperiments();
  emit();
}

/**
 * Change an experiment in place, touching `updatedAt`.
 *
 * A locked pre-registration is immutable: the hypothesis cannot be rewritten and the plan
 * cannot be dropped or replaced through a generic patch. That is the gate — a conclusion
 * cannot be made to fit a hypothesis that moved after the results arrived.
 */
export function patchExperiment(id: string, changes: Partial<Experiment>): void {
  const current = experimentById(id);
  if (!current) {
    return;
  }
  const patch = { ...changes };
  if (current.preregistration) {
    delete patch.preregistration;
    if (patch.hypothesis !== undefined && patch.hypothesis !== current.preregistration.hypothesis) {
      delete patch.hypothesis;
    }
    if (patch.stage === 'draft') {
      delete patch.stage;
    }
  }
  writeExperiment(id, patch);
}

/** Lock a plan. Returns the updated experiment, or undefined when there is none or one is locked. */
export async function lockPreregistration(
  id: string,
  plan: PreregistrationPlan,
  by: string,
): Promise<Experiment | undefined> {
  const experiment = experimentById(id);
  if (!experiment || experiment.preregistration) {
    return undefined;
  }
  const lockedAt = Date.now();
  const hash = await hashPlan(plan, lockedAt, by);
  const preregistration: Preregistration = {
    ...plan,
    lockedAt,
    lockedBy: by,
    hash,
    deviations: [],
  };
  writeExperiment(id, {
    preregistration,
    hypothesis: plan.hypothesis,
    stage: experiment.stage === 'draft' ? 'registered' : experiment.stage,
  });
  return experimentById(id);
}

/** Record a decision that departed from the plan. */
export function recordDeviation(id: string, deviation: Omit<Deviation, 'id' | 'at'>): boolean {
  const experiment = experimentById(id);
  if (!experiment?.preregistration) {
    return false;
  }
  const next: Preregistration = {
    ...experiment.preregistration,
    deviations: [
      ...experiment.preregistration.deviations,
      {
        ...deviation,
        id: `d-${crypto.randomUUID().slice(0, 8)}`,
        at: Date.now(),
      },
    ],
  };
  writeExperiment(id, { preregistration: next });
  return true;
}

/** Whether the plan still matches its signature. */
export async function verifyExperiment(id: string): Promise<'none' | 'intact' | 'changed'> {
  const preregistration = experimentById(id)?.preregistration;
  if (!preregistration) {
    return 'none';
  }
  return (await verifyPreregistration(preregistration)) ? 'intact' : 'changed';
}

/** Remove an experiment. */
export function removeExperiment(id: string): void {
  experiments = experiments.filter((experiment) => experiment.id !== id);
  persistExperiments();
  emit();
}

/** Copy an experiment, so a run can be repeated from the same protocol. */
export function duplicateExperiment(id: string): Experiment | undefined {
  const source = experimentById(id);
  if (!source) {
    return undefined;
  }
  const copy = newExperiment({
    ...source,
    id: `EXP-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    objective: `${source.objective} (copy)`.trim(),
    stage: 'draft',
    criterion: source.criterion ? { ...source.criterion, frozenAt: null, changes: [] } : undefined,
    trials: [],
    evidence: [],
    outcome: 'running',
    outcomeSummary: '',
    lesson: '',
  });
  addExperiment(copy);
  return copy;
}

/** Append one trial, and mark the experiment running. Returns false when the id is unknown. */
export function logTrial(id: string, trial: Trial): boolean {
  const experiment = experimentById(id);
  if (!experiment) {
    return false;
  }
  patchExperiment(id, {
    trials: [...experiment.trials, trial],
    stage: experiment.stage === 'draft' ? experiment.stage : 'running',
    outcome: 'running',
  });
  return true;
}

/** Record the outcome and its summary. Returns false when the id is unknown. */
export function setOutcome(id: string, outcome: ExperimentOutcome, summary?: string): boolean {
  const experiment = experimentById(id);
  if (!experiment) {
    return false;
  }
  patchExperiment(id, {
    outcome,
    ...(summary !== undefined ? { outcomeSummary: summary } : {}),
    ...(experiment.stage === 'running' ? { stage: 'settled' as ExperimentStage } : {}),
  });
  return true;
}
