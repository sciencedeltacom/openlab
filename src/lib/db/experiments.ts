/**
 * The experiment ledger, in and out of SQLite.
 *
 * Two tables: the domains the user defined, and the experiments themselves. Trials, evidence,
 * links and the design values travel as JSON columns on the experiment — they are read and
 * written whole with it, and a JSON column keeps a new domain from ever being a schema change.
 */

import type { Experiment, ExperimentDomain } from '../../components/experiments/experiments';

import type { Db } from './client';
import * as t from './schema';
import { TableSyncer } from './sync';

const domainSyncer = new TableSyncer<ExperimentDomain>(t.experimentDomains, (domain, position) => ({
  id: domain.id,
  position,
  name: domain.name,
  summary: domain.summary,
  mark: domain.mark,
  fields: domain.fields,
  builtIn: domain.builtIn,
}));

/** Every domain the user defined, in order. */
export async function loadDomains(db: Db): Promise<ExperimentDomain[]> {
  const rows = await db.select().from(t.experimentDomains).orderBy(t.experimentDomains.position);
  return rows.map(({ position: _position, ...domain }) => domain);
}

/** Write the domain list. */
export async function saveDomains(db: Db, items: readonly ExperimentDomain[]): Promise<void> {
  await domainSyncer.sync(db, items);
}

const experimentSyncer = new TableSyncer<Experiment>(t.experiments, (experiment, position) => ({
  id: experiment.id,
  position,
  domainId: experiment.domainId ?? null,
  objective: experiment.objective,
  hypothesis: experiment.hypothesis,
  design: experiment.design,
  designKind: experiment.designKind,
  stage: experiment.stage,
  criterion: experiment.criterion ?? null,
  preregistration: experiment.preregistration ?? null,
  checks: experiment.checks,
  designSpec: experiment.designSpec,
  outcome: experiment.outcome,
  outcomeSummary: experiment.outcomeSummary,
  lesson: experiment.lesson,
  trials: experiment.trials,
  evidence: experiment.evidence,
  links: experiment.links,
  createdAt: experiment.createdAt,
  updatedAt: experiment.updatedAt,
}));

/** Every experiment in the ledger, in order. */
export async function loadExperiments(db: Db): Promise<Experiment[]> {
  const rows = await db.select().from(t.experiments).orderBy(t.experiments.position);
  return rows.map(({ position: _position, domainId, criterion, preregistration, ...experiment }) => ({
    ...experiment,
    domainId: domainId ?? undefined,
    criterion: criterion ?? undefined,
    preregistration: preregistration ?? undefined,
  }));
}

/** Write the experiment ledger. */
export async function saveExperiments(db: Db, items: readonly Experiment[]): Promise<void> {
  await experimentSyncer.sync(db, items);
}

/** Drop the write memories, so the next save rewrites everything. */
export function resetExperimentSyncers(): void {
  domainSyncer.reset();
  experimentSyncer.reset();
}

/** Adopt the ledger already in the database, so a fresh process still deletes what it drops. */
export async function primeExperimentSyncers(db: Db): Promise<void> {
  await domainSyncer.primeFromDb(db);
  await experimentSyncer.primeFromDb(db);
}
