/**
 * One experiment, in full.
 *
 * The record the Experiments page draws: the pre-registered criterion and every change made to
 * it, the checks, the trials with their measurements, the evidence the outcome rests on, and the
 * lesson. JSON is the record itself, so a pipe gets everything the page would show.
 */

import { Args } from '@oclif/core';

import type { Criterion, EvidenceFact, Trial } from '@/components/experiments/experiments';
import { domainById, experimentById } from '@/components/experiments/store';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** Epoch ms as `YYYY-MM-DD HH:MM`. */
function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

/** The criterion as one line, with its frozen state. */
function criterionLine(criterion: Criterion): string {
  const threshold = Array.isArray(criterion.threshold)
    ? criterion.threshold.join('–')
    : String(criterion.threshold);
  const unit = criterion.unit ? ` ${criterion.unit}` : '';
  const where = criterion.evaluatedOn ? ` on ${criterion.evaluatedOn}` : '';
  const frozen = criterion.frozenAt ? ` · frozen ${stamp(criterion.frozenAt)}` : ' · not frozen';
  return `${criterion.metric} ${criterion.comparator} ${threshold}${unit}${where}${frozen}`;
}

/** One trial and its measurements, as a few lines. */
function trialLines(trial: Trial): string[] {
  const head = [trial.run || '—', trial.condition, trial.status].filter(Boolean).join(' · ');
  const measured = trial.metric || trial.result ? `${trial.metric} = ${trial.result}`.trim() : '';
  const lines = [measured ? `${head}: ${measured}` : head];
  for (const metric of trial.metrics ?? []) {
    const unit = metric.unit ? ` ${metric.unit}` : '';
    const uncertainty = metric.uncertainty ? ` ± ${metric.uncertainty}` : '';
    lines.push(`  ${metric.name} = ${metric.value}${unit}${uncertainty}`);
  }
  const when = [
    trial.startedAt ? `started ${stamp(trial.startedAt)}` : '',
    trial.endedAt ? `ended ${stamp(trial.endedAt)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  if (when) lines.push(`  ${when}`);
  if (trial.note) lines.push(`  ${trial.note}`);
  return lines;
}

/** One number the outcome rests on. */
function evidenceLine(fact: EvidenceFact): string {
  const unit = fact.unit ? ` ${fact.unit}` : '';
  const uncertainty = fact.uncertainty ? ` ± ${fact.uncertainty}` : '';
  const source = fact.sourceKind ? ` [${fact.sourceKind}${fact.sourceId ? `:${fact.sourceId}` : ''}]` : '';
  return `${fact.label} = ${fact.value}${unit}${uncertainty}${source}`;
}

export default class ExperimentShow extends LabCommand {
  static description = 'Show one experiment in full: criterion, checks, trials, evidence and lesson';

  static args = {
    id: Args.string({ required: true, description: 'The experiment id, e.g. EXP-1A2B' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ExperimentShow);
    await this.lab();
    const experiment = experimentById(args.id);
    if (!experiment) {
      this.fail(`No experiment ${args.id}. See \`openlab analyze experiments list\`.`);
    }

    this.emit(experiment, (record) => {
      const lines = [
        `${out.c.bold(record.id)}  ${out.c.grey(record.objective)}`,
        out.keyValues([
          ['domain', domainById(record.domainId)?.name],
          ['stage', record.stage],
          ['outcome', record.outcome],
          ['design', record.designKind],
          ['created', stamp(record.createdAt)],
        ]),
      ];
      if (record.hypothesis) lines.push('', out.heading('Hypothesis'), record.hypothesis);
      if (record.design) lines.push('', out.heading('Design'), record.design);
      if (record.criterion) {
        lines.push('', out.heading('Criterion'), criterionLine(record.criterion));
        if (record.criterion.changes.length > 0) {
          lines.push(
            out.bullets(
              record.criterion.changes.map(
                (change) =>
                  `${stamp(change.at)} ${change.field}: ${change.from} → ${change.to} (${change.reason})`,
              ),
            ),
          );
        }
      }
      if (record.checks.length > 0) lines.push('', out.heading('Checks'), out.bullets(record.checks));
      if (record.trials.length > 0) {
        lines.push('', out.heading('Trials'), out.bullets(record.trials.flatMap(trialLines)));
      }
      if (record.evidence.length > 0) {
        lines.push('', out.heading('Evidence'), out.bullets(record.evidence.map(evidenceLine)));
      }
      if (record.links.length > 0) {
        lines.push(
          '',
          out.heading('Links'),
          out.bullets(record.links.map((link) => `${link.label} (${link.kind} ${link.refId})`)),
        );
      }
      if (record.outcomeSummary) lines.push('', out.heading('Outcome'), record.outcomeSummary);
      if (record.lesson) lines.push('', out.heading('Lesson'), record.lesson);
      return lines.join('\n');
    });
  }
}
