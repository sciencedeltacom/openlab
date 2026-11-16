/**
 * Checks the session plan.
 *
 * Run with: `bun scripts/verify-session-plan.ts`
 *
 * The plan is only useful if three things agree: the agent has a tool that writes it, the
 * prompt tells the agent when to reach for it, and the reader's panel reads the same record.
 * This pins the first two and the shape the third consumes; the round-trip through SQLite is
 * covered by `verify:storage`.
 */

import { buildSystemPrompt } from '../src/lib/agent/prompt';
import { CORE_TOOL_IDS } from '../src/lib/agent/tools';
import { specFor } from '../src/lib/agent/spec';
import { executeToolCall, type ToolContext, type ToolHost } from '../src/lib/agent/registry';
import type { DomainHost } from '../src/lib/agent/domain';
import type { SessionPlan } from '../src/store/types';

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

const written: SessionPlan[] = [];
const context: ToolContext = {
  workspace: '/tmp/lab',
  signal: new AbortController().signal,
  host,
  domain: { setSessionPlan: (plan: SessionPlan) => written.push(plan) } as unknown as DomainHost,
};

const call = (steps: unknown, goal?: string) => ({
  id: 'c-1',
  name: 'plan_update',
  arguments: JSON.stringify(goal ? { goal, steps } : { steps }),
});

// ── The tool ────────────────────────────────────────────────────────────────────────────────

checkTruthy('plan_update is a core tool', CORE_TOOL_IDS.includes('plan_update'));
const spec = specFor('plan_update');
const params = spec.parameters as { properties?: { steps?: { type?: string } } };
check('the spec describes the steps', params.properties?.steps?.type, 'array');

const result = await executeToolCall(
  call(
    [
      { title: 'Read the assay table', status: 'active' },
      { title: 'Fit the model' },
      { title: 'Write the result', status: 'done' },
    ],
    'Ship the reanalysis',
  ),
  context,
);
check('the plan is written', result.isError, false);
check('with the goal', written[0]?.goal, 'Ship the reanalysis');
check('and every step', written[0]?.steps.map((step) => step.title), [
  'Read the assay table',
  'Fit the model',
  'Write the result',
]);
check('a status is kept', written[0]?.steps[0]?.status, 'active');
check('a missing status is pending', written[0]?.steps[1]?.status, 'pending');
check('a step without a title is dropped', written[0]?.steps.length, 3);

const empty = await executeToolCall(call([{ status: 'done' }]), context);
check('an empty plan is refused', empty.isError, true);
checkTruthy('and says why', empty.content.includes('at least one step'));

const unknownStatus = await executeToolCall(call([{ title: 'One', status: 'sideways' }]), context);
check('an unknown status is pending, not a crash', unknownStatus.isError, false);
check('and reads as pending', written[1]?.steps[0]?.status, 'pending');

// ── The prompt ──────────────────────────────────────────────────────────────────────────────

const prompt = buildSystemPrompt({
  mode: 'agent',
  workspace: '/tmp/lab',
  surface: { toolIds: [...CORE_TOOL_IDS], mcpIds: [], skillIds: [] },
});
checkTruthy('the prompt tells the agent to plan', prompt.includes('plan_update'));
checkTruthy('and says where the reader sees it', prompt.includes('above the composer'));

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: the agent writes a plan, the prompt asks for it, and the reader has one record');
