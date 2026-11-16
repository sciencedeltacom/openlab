/**
 * Checks the pre-registration gate.
 *
 * Run with: `bun scripts/verify-preregistration.ts`
 *
 * The gate is only worth having if it holds under pressure: a hypothesis that cannot be
 * rewritten after the lock, a plan whose signature detects an edit, a test that departs from
 * the plan only with a recorded reason, and an outcome that cannot be recorded without a plan.
 * Each of those is a check here, through the same store and executors the app uses.
 */

import {
  createExperiment,
  experimentById,
  lockPreregistration,
  patchExperiment,
  recordDeviation,
  verifyExperiment,
} from '../src/components/experiments/store';
import {
  hashPlan,
  preregistrationReport,
  verifyPreregistration,
  type PreregistrationPlan,
} from '../src/components/experiments/preregistration';
import { executeToolCall, type ToolContext, type ToolHost } from '../src/lib/agent/registry';
import type { ToolCall } from '../src/lib/agent/transcript';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
}

function checkTruthy(label: string, actual: unknown) {
  if (actual) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label} — got ${JSON.stringify(actual)}`);
}

const host: ToolHost = {
  readFile: async () => '',
  writeFile: async () => undefined,
  listDir: async () => [],
  glob: async () => [],
  grep: async () => '',
  runCommand: async () => ({ output: '', exitCode: 0 }),
  fetchUrl: async () => '',
};

const context: ToolContext = {
  workspace: '/tmp/lab',
  signal: new AbortController().signal,
  host,
  domain: { setOutcome: () => true } as unknown as ToolContext['domain'],
};

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `c-${Math.random().toString(16).slice(2, 8)}`,
  name,
  arguments: JSON.stringify(args),
});

const plan: PreregistrationPlan = {
  hypothesis: 'The treatment raises the primary metric.',
  primaryOutcome: 'difference in means',
  test: 'welch-t-test',
  alpha: 0.05,
  alternative: 'two-sided',
  exclusions: 'runs that failed QC',
  stoppingRule: 'stop at 40 runs',
  analysisNotes: 'no covariates',
};

const experiment = createExperiment({
  id: 'EXP-PREREG',
  objective: 'Test the plan gate',
  hypothesis: plan.hypothesis,
});
checkTruthy('an experiment exists', Boolean(experimentById(experiment.id)));

const locked = await lockPreregistration(experiment.id, plan, 'tester');
checkTruthy('the plan locks', Boolean(locked?.preregistration));
check('and moves a draft to registered', locked?.stage, 'registered');
checkTruthy('the signature is a sha-256 digest', (locked?.preregistration?.hash ?? '').length === 64);
check('the signature is stable', await hashPlan(plan, locked!.preregistration!.lockedAt, 'tester'), locked!.preregistration!.hash);
check('the stored plan verifies', await verifyExperiment(experiment.id), 'intact');

// A hypothesis that moves after the lock is the exact failure this gate exists to stop.
patchExperiment(experiment.id, { hypothesis: 'The treatment lowers the primary metric.' });
check(
  'the hypothesis cannot be rewritten',
  experimentById(experiment.id)?.hypothesis,
  plan.hypothesis,
);
patchExperiment(experiment.id, { stage: 'draft' });
check('the stage cannot move back to draft', experimentById(experiment.id)?.stage, 'registered');

// Editing the record outside the store is detectable: the digest no longer matches.
const tampered = { ...locked!.preregistration!, alpha: 0.5 };
check('a changed plan fails its signature', await verifyPreregistration(tampered), false);

// A deviation is recorded with when it was made.
checkTruthy(
  'a deviation is recorded',
  recordDeviation(experiment.id, {
    decision: 'excluded two runs',
    reason: 'the assay failed QC after unblinding',
    phase: 'after-results',
    by: 'tester',
  }),
);
check('and it is in the plan', experimentById(experiment.id)?.preregistration?.deviations.length, 1);

// ── The analysis gate ───────────────────────────────────────────────────────────────────────

const planned = await executeToolCall(
  call('statistics', {
    test: 'welch-t-test',
    a: [5.1, 4.9, 6.2, 5.8, 6.4],
    b: [4.2, 4.4, 3.9, 4.8, 4.1],
    experiment: experiment.id,
  }),
  context,
);
check('the planned test runs', planned.isError, false);
check(
  'and records no new deviation',
  experimentById(experiment.id)?.preregistration?.deviations.length,
  1,
);

const deviating = await executeToolCall(
  call('statistics', {
    test: 'one-way-anova',
    groups: [[5.1, 4.9], [4.2, 4.4]],
    experiment: experiment.id,
  }),
  context,
);
check('a different test is refused without a reason', deviating.isError, true);
checkTruthy('and the refusal names the plan', deviating.content.includes('departs from the locked plan'));

const explained = await executeToolCall(
  call('statistics', {
    test: 'one-way-anova',
    groups: [[5.1, 4.9], [4.2, 4.4]],
    experiment: experiment.id,
    deviation_reason: 'the design has three arms, not two',
  }),
  context,
);
check('with a reason it runs', explained.isError, false);
check('and the deviation is recorded', experimentById(experiment.id)?.preregistration?.deviations.length, 2);
check(
  'the deviation carries its decision',
  experimentById(experiment.id)?.preregistration?.deviations.at(-1)?.decision,
  'test: welch-t-test → one-way-anova',
);
check(
  'and its phase',
  experimentById(experiment.id)?.preregistration?.deviations.at(-1)?.phase,
  'after-results',
);

// The report is the artefact the gate produces: plan, signature and every departure.
const report = preregistrationReport(
  experiment.id,
  plan.hypothesis,
  experimentById(experiment.id)!.preregistration!,
  'intact',
);
checkTruthy('the report names the procedure', report.includes('welch-t-test'));
checkTruthy('the report lists the deviation', report.includes('one-way-anova'));
checkTruthy('the report carries the signature', report.includes(locked!.preregistration!.hash));
checkTruthy('the report states the phase', report.includes('[after results]'));

// ── The outcome gate ───────────────────────────────────────────────────────────────────────

const unregistered = createExperiment({ objective: 'No plan yet', hypothesis: 'Something' });
const refused = await executeToolCall(
  call('experiment_set_outcome', { experiment: unregistered.id, outcome: 'supported' }),
  context,
);
check('an outcome without a plan is refused', refused.isError, true);
checkTruthy('and says why', refused.content.includes('no locked pre-registration'));

const registered = await executeToolCall(
  call('experiment_set_outcome', { experiment: experiment.id, outcome: 'supported', summary: 'planned test' }),
  context,
);
check('an outcome with a plan is accepted', registered.isError, false);

// ── The tools lock and record directly ─────────────────────────────────────────────────────

const viaTool = createExperiment({ objective: 'Locked by the agent', hypothesis: 'The tool can lock' });
const lockedByTool = await executeToolCall(
  call('experiment_preregister', {
    experiment: viaTool.id,
    hypothesis: 'The tool can lock',
    primary_outcome: 'accuracy',
    test: 'welch-t-test',
    alpha: 0.01,
  }),
  context,
);
check('the agent can lock a plan', lockedByTool.isError, false);
check('and the plan carries the alpha', experimentById(viaTool.id)?.preregistration?.alpha, 0.01);
const deviatedByTool = await executeToolCall(
  call('experiment_deviation', {
    experiment: viaTool.id,
    decision: 'dropped the outlier rule',
    reason: 'the rule was undefined for ties',
    phase: 'before-results',
  }),
  context,
);
check('the agent can record a deviation', deviatedByTool.isError, false);
check(
  'with the phase it was given',
  experimentById(viaTool.id)?.preregistration?.deviations.at(-1)?.phase,
  'before-results',
);

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: plans lock, the signature holds, deviations are recorded, and outcomes need a plan');
