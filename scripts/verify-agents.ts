/**
 * Checks the multi-agent system.
 *
 * Run with: `bun scripts/verify-agents.ts`
 *
 * An agent is a way to lead the turn, and the bar's whole job is to answer "who answers next".
 * These checks pin the rules that make that safe: `main` cannot be removed, choosing an agent
 * moves the active flag, teams are the label agents share, and the chosen agent's instructions
 * and team reach the system prompt.
 */

import { buildSystemPrompt } from '../src/lib/agent/prompt';
import {
  activeAgent,
  addAgent,
  agentTeams,
  allAgents,
  findAgent,
  patchAgent,
  removeAgent,
  setActiveAgent,
  teammates,
} from '../src/components/agents/store';
import { BUILTIN_AGENTS, MAIN_AGENT_ID } from '../src/components/agents/data';

let failures = 0;

/** Assert equality and report the difference rather than throwing. */
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

function checkTruthy(label: string, value: unknown) {
  if (value) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}`);
}

console.log('\n— the built-in agent —');
{
  check(
    'main ships with the app',
    allAgents().some((agent) => agent.id === MAIN_AGENT_ID),
    true,
  );
  check('and starts active', activeAgent().id, MAIN_AGENT_ID);
  check('it cannot be removed', removeAgent(MAIN_AGENT_ID), false);
  check('and is still there', Boolean(findAgent(MAIN_AGENT_ID)), true);
  checkTruthy('it is marked built-in', findAgent(MAIN_AGENT_ID)?.builtIn);
}

console.log('\n— creating agents and teams —');
{
  const scout = addAgent({
    name: 'Literature scout',
    team: 'Lit review',
    summary: 'Finds and screens records.',
    instructions: 'Always cite the record id inline.',
  });
  check('creating an agent chooses it', activeAgent().id, scout.id);
  check('it is not built-in', scout.builtIn, false);
  check('its team is listed', agentTeams(), ['Lit review']);
  check(
    'the other agents are its teammates',
    teammates().map((agent) => agent.id),
    BUILTIN_AGENTS.map((agent) => agent.id),
  );

  const second = addAgent({ name: 'Analyst', team: 'Lit review', summary: 'Runs the numbers.' });
  check('a second agent joins the same team', teammates().length, allAgents().length - 1);

  setActiveAgent(MAIN_AGENT_ID);
  check('choosing main moves the active flag', activeAgent().id, MAIN_AGENT_ID);
  check('and the rest are teammates now', teammates().length, allAgents().length - 1);

  check('a user agent can be removed', removeAgent(second.id), true);
  check('and is gone', Boolean(findAgent(second.id)), false);
  check('removing the active one falls back to main', activeAgent().id, MAIN_AGENT_ID);

  // Editing and duplicating, which the bar's row menu offers.
  const editable = addAgent({ name: 'Editable', summary: 'Before' });
  patchAgent(editable.id, { name: 'Renamed', summary: 'After', instructions: 'Always cite.' });
  const edited = findAgent(editable.id);
  check('an agent can be edited in place', [edited?.name, edited?.summary, edited?.instructions], [
    'Renamed',
    'After',
    'Always cite.',
  ]);
  check('and keeps its id', edited?.id, editable.id);
  check('and its user status', edited?.builtIn, false);

  const main = findAgent(MAIN_AGENT_ID)!;
  const copy = addAgent({ ...main, name: 'Main (copy)' });
  check('a built-in can be duplicated', copy.builtIn, false);
  check('the copy has its own id', copy.id === MAIN_AGENT_ID, false);
  check('and carries the source instructions', copy.instructions, main.instructions);
  check('and the avatar colour', copy.avatarColor, main.avatarColor);
  check('the copy can be removed', removeAgent(copy.id), true);
  check('a built-in still cannot', removeAgent(MAIN_AGENT_ID), false);
}

console.log('\n— the prompt —');
{
  const surface = { toolIds: ['read_file'] as const, mcpIds: [] as const, skillIds: [] as const };
  const base = buildSystemPrompt({ mode: 'agent', workspace: '/tmp/lab', surface });
  checkTruthy('the base prompt is the workbench itself', base.includes('You are openlab'));

  const withAgent = buildSystemPrompt({
    mode: 'agent',
    workspace: '/tmp/lab',
    surface,
    agent: {
      id: 'agent-x',
      name: 'Literature scout',
      instructions: 'Always cite the record id inline.',
      teammates: ['Main (main)'],
    },
  });
  checkTruthy('the agent names itself', withAgent.includes('You are Literature scout'));
  checkTruthy(
    'its instructions are appended',
    withAgent.includes('Agent instructions:\nAlways cite the record id inline.'),
  );
  checkTruthy('and its team is named for delegation', withAgent.includes('Main (main)'));

  const noAgent = buildSystemPrompt({
    mode: 'agent',
    workspace: '/tmp/lab',
    surface,
    agent: { id: 'main', name: 'Main', instructions: '' },
  });
  checkTruthy('the built-in agent adds no instructions block', !noAgent.includes('Agent instructions:'));
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: agents are created, grouped and lead the turn, and main cannot be removed');
