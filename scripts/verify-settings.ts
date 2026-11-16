/**
 * Checks the settings layer.
 *
 * Run with: `bun scripts/verify-settings.ts`
 *
 * The settings screens are data, and their values are only real when three things agree: a
 * stable key, a persisted value, and a consumer. This pins the keys and normalisation, and
 * then builds the system prompt with overrides and preferences to prove the runtime reads
 * them rather than the screen merely displaying them.
 */

import { buildSystemPrompt } from '../src/lib/agent/prompt';
import { DEFAULT_POLICY, agentPolicy, applyToolPolicy } from '../src/lib/agent/policy';
import {
  DEFAULT_PROMPTS,
  normalizePreferences,
  normalizePrompts,
  preferenceKey,
  preferenceLines,
  preferenceText,
  preferenceValue,
  crashReportEnabled,
  isLoopbackUrl,
  localOnlyEnabled,
  CRASH_REPORT_LABEL,
  LOCAL_ONLY_LABEL,
  type Preferences,
} from '../src/lib/settings';

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

function checkTruthy(label: string, value: unknown) {
  if (value) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected a truthy value\n     actual   ${JSON.stringify(value)}`);
}

console.log('\n— keys —');
{
  check(
    'a key is its section and its label',
    preferenceKey('conventions', 'Instruction budget'),
    'conventions:instruction-budget',
  );
  check(
    'punctuation does not make two keys',
    preferenceKey('conventions', 'Instruction  budget!'),
    'conventions:instruction-budget',
  );
  check(
    'the same label in two sections stays two keys',
    preferenceKey('a', 'Budget') === preferenceKey('b', 'Budget'),
    false,
  );
}

console.log('\n— stored values —');
{
  const prefs: Preferences = {
    'conventions:budget': { value: 4000, label: 'Budget', section: 'Conventions' },
    'conventions:include': { value: true, label: 'Include', section: 'Conventions' },
    'scope:tags': { value: ['a', 'b'], label: 'Tags', section: 'Scope' },
  };
  check('a stored number wins over the default', preferenceValue(prefs, 'conventions:budget', 10), 4000);
  check('a missing key falls back', preferenceValue(prefs, 'nope', 'x'), 'x');
  check('a boolean reads as a boolean', preferenceValue(prefs, 'conventions:include', false), true);
  check('a list reads as a list', preferenceValue(prefs, 'scope:tags', []), ['a', 'b']);
  check(
    'a value of the wrong type falls back rather than leaking through',
    preferenceValue({ ...prefs, 'conventions:budget': { value: 'lots', label: 'Budget', section: 'C' } }, 'conventions:budget', 10),
    10,
  );
}

console.log('\n— normalisation —');
{
  const normalized = normalizePreferences({
    good: { value: 'x', label: 'Good', section: 'S' },
    bad: { value: { nested: true }, label: 'Bad', section: 'S' },
    missing: { label: 'Missing', section: 'S' },
    junk: 'not an entry',
  });
  check('a good entry survives', normalized.good?.value, 'x');
  check('a nested value is dropped', normalized.bad, undefined);
  check('an entry with no value is dropped', normalized.missing, undefined);
  check('a scalar is dropped', normalized.junk, undefined);
  check('nothing at all normalises to an empty map', normalizePreferences(null), {});
  check('prompts default to empty', normalizePrompts(undefined), DEFAULT_PROMPTS);
  check(
    'a partial prompt blob fills the rest',
    normalizePrompts({ global: 'hi' }),
    { ...DEFAULT_PROMPTS, global: 'hi' },
  );
}

console.log('\n— prompt block —');
{
  const prefs: Preferences = {
    'conventions:units': { value: 'SI', label: 'Units', section: 'Conventions' },
    'conventions:empty': { value: '', label: 'Empty', section: 'Conventions' },
    'scope:apply-to': { value: 'project', label: 'Apply to', section: 'Scope' },
    theme: { value: 'dark', label: 'Theme', section: 'UI' },
    navMode: { value: 'tabs', label: 'Pages', section: 'UI' },
  };
  const lines = preferenceLines(prefs, new Set(['theme', 'navMode']));
  check('the block leads with what it is', lines[0], 'The reader set these preferences; follow them unless a task says otherwise.');
  checkTruthy('a filled value is there', lines.some((line) => line.includes('Units: SI')));
  checkTruthy('a section is named', lines.includes('Conventions:'));
  check('an empty value is left out', lines.some((line) => line.includes('Empty')), false);
  checkTruthy('a second section is kept', lines.includes('Scope:'));
  check('UI-only settings do not reach the prompt', lines.some((line) => line.includes('dark')), false);
  check('values read as words', preferenceText(true), 'yes');
  check('lists read as a sentence', preferenceText(['a', 'b']), 'a, b');
}

console.log('\n— the prompt the turn receives —');
{
  const surface = { toolIds: [] as const, mcpIds: [] as const, skillIds: [] as const };
  const defaultPrompt = buildSystemPrompt({ mode: 'plan', workspace: '/lab', surface: { ...surface, toolIds: [] }, interface: false });
  checkTruthy('the built-in behaviour is used when there is no override', defaultPrompt.includes('Agree on a method first'));

  const custom = buildSystemPrompt({
    mode: 'plan',
    workspace: '/lab',
    surface: { toolIds: [], mcpIds: [], skillIds: [] },
    interface: false,
    preferences: {
      'conventions:units': { value: 'SI', label: 'Units', section: 'Conventions' },
    },
    prompts: {
      global: 'Never mix genome builds.',
      plan: 'Write the method as numbered steps.',
      ask: '',
      agent: '',
      worker: 'Report only the facts.',
    },
  });
  checkTruthy('a global override is included', custom.includes('Never mix genome builds.'));
  checkTruthy('a mode override replaces the built-in', custom.includes('Write the method as numbered steps.'));
  check('and the built-in is gone', custom.includes('Agree on a method first'), false);
  checkTruthy('preferences are included', custom.includes('Units: SI'));

  const worker = buildSystemPrompt({
    mode: 'agent',
    workspace: '/lab',
    surface: { toolIds: [], mcpIds: [], skillIds: [] },
    subagent: { id: 'w', name: 'Scout', summary: 'Reads things.' },
    prompts: { ...DEFAULT_PROMPTS, worker: 'Report only the facts.' },
    interface: false,
  });
  checkTruthy('a worker override is included', worker.includes('Report only the facts.'));
  checkTruthy('and the workers own remit is kept', worker.includes('Reads things.'));

  // ---------------------------------------------------------------- the privacy switches are policy
  const privacy: Preferences = {
    [preferenceKey('local', LOCAL_ONLY_LABEL)]: {
      value: true,
      label: LOCAL_ONLY_LABEL,
      section: 'Privacy',
    },
  };
  check('local-only mode is read from its switch', localOnlyEnabled(privacy), true);
  check('and is off by default', localOnlyEnabled({}), false);
  check('a crash report is off by default', crashReportEnabled({}), false);
  check(
    'crash reports follow the switch',
    crashReportEnabled({
      [preferenceKey('local', CRASH_REPORT_LABEL)]: {
        value: true,
        label: CRASH_REPORT_LABEL,
        section: 'Privacy',
      },
    }),
    true,
  );
  check('loopback is local', isLoopbackUrl('http://127.0.0.1:11434/v1'), true);
  check('localhost is local', isLoopbackUrl('http://localhost:8080'), true);
  check('a public endpoint is not local', isLoopbackUrl('https://api.openai.com/v1'), false);

  // ---------------------------------------------------------------- the limits the engine holds
  check('the shipped limits are the defaults', agentPolicy({}), DEFAULT_POLICY);

  const stored: Preferences = {
    [preferenceKey('effort', 'Tool calls per turn')]: { value: 7, label: 'Tool calls per turn', section: 'Research effort' },
    [preferenceKey('effort', 'Wall-clock per turn')]: { value: 5, label: 'Wall-clock per turn', section: 'Research effort' },
    [preferenceKey('effort', 'Parallel read tools')]: { value: 2, label: 'Parallel read tools', section: 'Research effort' },
    [preferenceKey('stops', 'Retries per tool call')]: { value: 0, label: 'Retries per tool call', section: 'Stop rules' },
    [preferenceKey('tools', 'Restrict to the allowlist')]: { value: true, label: 'Restrict to the allowlist', section: 'Tool allowlist' },
    [preferenceKey('tools', 'Allowed tools')]: { value: ['read_file', 'grep'], label: 'Allowed tools', section: 'Tool allowlist' },
    [preferenceKey('tools', 'Always denied')]: { value: ['run_command'], label: 'Always denied', section: 'Tool allowlist' },
  };
  const policy = agentPolicy(stored);
  check('the step limit is read', policy.maxSteps, 7);
  check('the wall-clock limit is read', policy.turnMinutes, 5);
  check('the read concurrency is read', policy.parallelReads, 2);
  check('the retry count is read', policy.retries, 0);
  check('the allowlist switch is read', policy.restricted, true);
  check(
    'a restricted surface is exactly the allowlist',
    applyToolPolicy(['read_file', 'grep', 'write_file', 'run_command'], policy),
    ['read_file', 'grep'],
  );
  check(
    'a denied tool is dropped even without the switch',
    applyToolPolicy(['read_file', 'run_command'], { ...DEFAULT_POLICY, denied: ['run_command'] }),
    ['read_file'],
  );
  check('an open surface is left alone', applyToolPolicy(['read_file', 'write_file'], DEFAULT_POLICY), [
    'read_file',
    'write_file',
  ]);
}

console.log(
  failures === 0 ? '\nOK: settings are keyed, stored, read by the prompt, and enforce what they promise' : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
