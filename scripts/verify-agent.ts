/**
 * Checks the agent turn, the tool registry and the permission gate.
 *
 * Run with: `bun scripts/verify-agent.ts`
 *
 * The turn is the part where a mistake is expensive and quiet: a step that never stops, a tool
 * result that is dropped, a refusal that still runs the call. None of that needs a model to
 * test — the AI SDK is driven by a mock language model that plays a scripted stream — so the
 * fixtures here run the real `runTurn` and the real engine and assert what they did.
 */

import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';

import { runTurn } from '../src/lib/ai/run';
import { createModelEngine, createEngine } from '../src/store/engine';
import {
  executeToolCall,
  describeToolCall,
  type ToolHost,
  type ToolContext,
} from '../src/lib/agent/registry';
import { needsPermission } from '../src/lib/agent/permissions';
import { DEFAULT_GUARD } from '../src/lib/guard';
import { findTool } from '../src/lib/agent/tools';
import { specFor } from '../src/lib/agent/spec';
import { resolveWorkbenchSurface, type PackId } from '../src/lib/agent/packs';
import { buildSystemPrompt } from '../src/lib/agent/prompt';
import { blocksToTranscript } from '../src/store/transcript';
import type { Block, Message } from '../src/store/types';
import type { Provider } from '../src/lib/providers';
import { newJob, newTarget, type Job, type Target } from '../src/store/compute';
import { newWave, type Task, type Wave } from '../src/store/research';
import type { ToolCall } from '../src/lib/agent/transcript';

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

/** Assert a value is present. */
function checkTruthy(label: string, actual: unknown) {
  if (actual) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label} — got ${JSON.stringify(actual)}`);
}

/* ================================================================================================
 * Scripting the mock model
 * ============================================================================================== */

/** A provider-shaped token report, in the AI SDK's v4 usage shape. */
function usage(input: number, output: number, cached = 0) {
  return {
    inputTokens: { total: input, noCache: input - cached, cacheRead: cached, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

/** A stream that answers with prose and stops. */
function textTurn(text: string, input = 10, output = 4) {
  return [
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usage(input, output) },
  ];
}

/** A stream that asks for one tool call and stops for the results. */
function toolTurn(name: string, id: string, args: unknown, input = 10, output = 4) {
  const json = JSON.stringify(args);
  return [
    { type: 'tool-input-start', id, toolName: name },
    { type: 'tool-input-delta', id, delta: json },
    { type: 'tool-input-end', id },
    { type: 'tool-call', toolCallId: id, toolName: name, input: json },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usage(input, output) },
  ];
}

/** A mock model that plays one scripted turn per model call, in order. */
function scripted(...turns: unknown[][]) {
  return new MockLanguageModelV4({
    doStream: turns.map((parts) => ({ stream: convertArrayToReadableStream(parts as never[]) })),
  });
}

/** A provider that needs no real endpoint, for driving the engine in a test. */
const provider: Provider = {
  id: 'mock',
  label: 'Mock',
  protocol: 'local',
  requiresKey: false,
  summary: 'A scripted model for tests.',
  fields: [],
  models: [],
};

/** A host that answers in memory, so the registry can be tested without a filesystem. */
const host: ToolHost = {
  readFile: async (path) => `contents of ${path}`,
  writeFile: async () => undefined,
  listDir: async () => [{ name: 'a.txt', path: 'a.txt', isDir: false }],
  glob: async () => ['a.txt', 'b.ts'],
  grep: async () => 'a.txt:1: hello',
  runCommand: async (command) => ({ output: `ran ${command}`, exitCode: 0 }),
  fetchUrl: async (url) => `body of ${url}`,
};

const ctx: ToolContext = {
  workspace: '/tmp/workspace',
  signal: new AbortController().signal,
  host,
};

const call = (name: string, args: Record<string, unknown>, id = 'c1'): ToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

/* ================================================================================================
 * The turn
 * ============================================================================================== */

console.log('\n— turn —');
{
  const events: string[] = [];
  const model = scripted(toolTurn('read_file', 'c1', { path: 'a.txt' }), textTurn('It says hi.'));
  const outcome = await runTurn({
    model,
    system: 'You are a research agent.',
    workspace: '/tmp/workspace',
    toolIds: ['read_file'],
    transcript: [{ role: 'user', content: 'go' }],
    reasoning: 'off',
    reasoningSupported: false,
    maxSteps: 5,
    maxTokens: 1024,
    signal: new AbortController().signal,
    host,
    guard: { guarded: false, ask: async () => true, policy: { ...DEFAULT_GUARD, enabled: false } },
    onBlock: (block) => {
      if (block.kind === 'tool') events.push(block.status);
    },
  });

  check('a turn with one call finishes', outcome.reason, 'finished');
  check('the answer is the last step’s prose', outcome.text, 'It says hi.');
  check('the call is drawn running then settled', events, ['running', 'ok']);
  check('the tokens are summed across the steps', outcome.usage, { input: 20, output: 8, cached: 0 });
}

{
  // A step that always calls a tool must stop at the limit, not run forever.
  const turns = Array.from({ length: 5 }, () => toolTurn('read_file', 'c1', { path: 'a.txt' }));
  const outcome = await runTurn({
    model: scripted(...turns),
    system: 's',
    workspace: '/tmp/workspace',
    toolIds: ['read_file'],
    transcript: [{ role: 'user', content: 'go' }],
    reasoning: 'off',
    reasoningSupported: false,
    maxSteps: 3,
    maxTokens: 1024,
    signal: new AbortController().signal,
    host,
    guard: { guarded: false, ask: async () => true, policy: { ...DEFAULT_GUARD, enabled: false } },
    onBlock: () => undefined,
  });
  check('an endless caller stops at the step limit', outcome.reason, 'max-steps');
}

{
  // A refusal is an error result, and the turn keeps going so the model can adapt.
  const model = scripted(toolTurn('run_command', 'c1', { command: 'rm -rf /' }), textTurn('Understood.'));
  const blocks: Block[] = [];
  const outcome = await runTurn({
    model,
    system: 's',
    workspace: '/tmp/workspace',
    toolIds: ['run_command'],
    transcript: [{ role: 'user', content: 'go' }],
    reasoning: 'off',
    reasoningSupported: false,
    maxSteps: 3,
    maxTokens: 1024,
    signal: new AbortController().signal,
    host,
    guard: { guarded: true, ask: async () => false, policy: { ...DEFAULT_GUARD, enabled: false } },
    onBlock: (block) => blocks.push(block),
  });
  const refused = blocks.filter((block) => block.kind === 'tool').pop();
  check(
    'a declined call is drawn as an error',
    refused && refused.kind === 'tool' ? refused.status : null,
    'error',
  );
  checkTruthy(
    'and carries the reason',
    refused && refused.kind === 'tool' && refused.output?.includes('declined'),
  );
  check('the turn still finished', outcome.reason, 'finished');
}

/* ================================================================================================
 * The registry
 * ============================================================================================== */

console.log('\n— registry —');
{
  const read = await executeToolCall(call('read_file', { path: 'a.txt' }), ctx);
  check('read_file returns the host output', read.content, 'contents of a.txt');
  check('and is not an error', read.isError, false);

  const listed = await executeToolCall(call('list_dir', {}), ctx);
  check('list_dir lists entries', listed.content, 'file a.txt');

  const found = await executeToolCall(call('glob', { pattern: '*.ts' }), ctx);
  check('glob joins paths', found.content, 'a.txt\nb.ts');

  const command = await executeToolCall(call('run_command', { command: 'echo hi' }), ctx);
  check('run_command reports the exit code', command.content, 'ran echo hi\n\n[exit code 0]');
  check('a zero exit is not an error', command.isError, false);

  const fetched = await executeToolCall(call('fetch_url', { url: 'https://example.org' }), ctx);
  check('fetch_url returns the body', fetched.content, 'body of https://example.org');

  const missing = await executeToolCall(call('read_file', {}), ctx);
  check('a missing argument is a readable error', missing.isError, true);
  checkTruthy('and names the argument', missing.content.includes('path'));

  const unknown = await executeToolCall(call('does_not_exist', {}), ctx);
  check('an unknown tool is refused', unknown.isError, true);

  // A truncated payload must not be reported as a missing argument.
  const truncated = await executeToolCall(
    { id: 'c1', name: 'write_file', arguments: '{"path":"a.txt","contents":"cut off here' },
    ctx,
  );
  check('a truncated call is refused', truncated.isError, true);
  checkTruthy('and blames the payload, not a missing path', truncated.content.includes('valid JSON'));
  check('so write_file never ran', truncated.content.includes('did not run'), true);

  const delegation = await executeToolCall(call('task', { subagent_type: 'explore', prompt: 'look' }), ctx);
  check('task does not run through the registry', delegation.isError, true);

  const skill = await executeToolCall(call('skill', { id: 'literature-review' }), ctx);
  checkTruthy('a known procedure loads', skill.content.includes('Literature review'));
  check(
    'an unknown procedure is an error',
    (await executeToolCall(call('skill', { id: 'nope' }), ctx)).isError,
    true,
  );

  const stats = await executeToolCall(call('statistics', { test: 'descriptives', a: [1, 2, 3] }), ctx);
  check('statistics runs a procedure', stats.isError, false);
  checkTruthy('and returns reproducible code', stats.content.includes('"test":"descriptives"'));

  const badStats = await executeToolCall(call('statistics', { test: 'nope' }), ctx);
  check('an unknown procedure is refused', badStats.isError, true);

  // A host that throws must become a result, not an exception that ends the turn.
  const throwing: ToolContext = {
    ...ctx,
    host: {
      ...host,
      readFile: async () => {
        throw new Error('outside the workspace');
      },
    },
  };
  const blewUp = await executeToolCall(call('read_file', { path: '../secret' }), throwing);
  check('a host failure is a result', blewUp.isError, true);
  checkTruthy('carrying the host message', blewUp.content.includes('outside the workspace'));

  check(
    'a call is described for the transcript',
    describeToolCall(call('run_command', { command: 'ls' })),
    'ls',
  );
  check('a schema is available for a tool', specFor('read_file').name, 'read_file');
}

/* ================================================================================================
 * Knowledge
 * ============================================================================================== */

console.log('\n— knowledge —');
{
  const pages: Record<string, string> = {
    'openwiki/index.md':
      '---\ntitle: Demo lab\n---\n\n# Demo lab\n\nSee [Quickstart](quickstart.md). The theme is EGFR.\n',
    'openwiki/quickstart.md': '# Quickstart\n\nInputs live in data/, code in scripts/.\n',
  };
  const wikiHost: ToolHost = {
    ...host,
    glob: async (pattern) => (pattern.startsWith('openwiki/') ? Object.keys(pages) : []),
    readFile: async (path) => {
      const content = pages[path];
      if (content === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      return content;
    },
  };
  const wctx: ToolContext = { ...ctx, host: wikiHost };

  const listed = await executeToolCall(call('knowledge', { action: 'list' }), wctx);
  check('knowledge lists the pages', listed.isError, false);
  checkTruthy(
    'with their ids and titles',
    listed.content.includes('quickstart.md') && listed.content.includes('Demo lab'),
  );

  const read = await executeToolCall(call('knowledge', { action: 'read', page: 'quickstart' }), wctx);
  checkTruthy('knowledge reads a page by short name', read.content.includes('Inputs live in data/'));

  const search = await executeToolCall(call('knowledge', { action: 'search', query: 'EGFR' }), wctx);
  checkTruthy('knowledge searches the page text', search.content.includes('index.md'));

  check(
    'an unknown page is an error',
    (await executeToolCall(call('knowledge', { action: 'read', page: 'nope' }), wctx)).isError,
    true,
  );
  check(
    'a workspace with no wiki says so',
    (
      await executeToolCall(call('knowledge', { action: 'list' }), {
        ...ctx,
        host: { ...host, glob: async () => [] },
      })
    ).isError,
    true,
  );
  check(
    'a knowledge call is described',
    describeToolCall(call('knowledge', { action: 'read', page: 'architecture' })),
    'architecture',
  );
}

/* ================================================================================================
 * Domain tools
 * ============================================================================================== */

console.log('\n— domain tools —');
{
  const tasks: Task[] = [];
  const targets: Target[] = [];
  const jobs: Job[] = [];
  const waves: Wave[] = [];
  const domain: ToolContext['domain'] = {
    tasks: () => tasks,
    waves: () => waves,
    targets: () => targets,
    jobs: () => jobs,
    addTask: (task) => void tasks.push(task),
    patchTask: (id, patch) => {
      const task = tasks.find((candidate) => candidate.id === id);
      if (task) Object.assign(task, patch);
    },
    addWave: (wave) => void waves.push(wave),
    patchWave: (id, patch) => {
      const wave = waves.find((candidate) => candidate.id === id);
      if (wave) Object.assign(wave, patch);
    },
    addTarget: (target) => void targets.push(target),
    addJob: (job) => void jobs.push(job),
  };
  const dctx: ToolContext = { ...ctx, domain };

  // Naming the session: once, and only while nobody has.
  let sessionTitle = 'Untitled session';
  const titled: ToolContext = {
    ...ctx,
    domain: {
      ...domain,
      sessionTitle: () => sessionTitle,
      setSessionTitle: (next) => {
        sessionTitle = next;
      },
    },
  };
  const named = await executeToolCall(call('session_title', { title: 'EGFR panel re-analysis.' }), titled);
  check('session_title names an untitled session', sessionTitle, 'EGFR panel re-analysis');
  checkTruthy('and says so', named.content.includes('EGFR panel re-analysis'));
  const secondName = await executeToolCall(call('session_title', { title: 'Something else' }), titled);
  check('a named session keeps its name', sessionTitle, 'EGFR panel re-analysis');
  checkTruthy('and the second call says the name is kept', secondName.content.includes('already called'));

  const surface = { toolIds: [], mcpIds: [], skillIds: [] };
  const untitledPrompt = buildSystemPrompt({
    mode: 'agent',
    workspace: '',
    surface,
    sessionTitle: 'Untitled session',
  });
  const namedPrompt = buildSystemPrompt({
    mode: 'agent',
    workspace: '',
    surface,
    sessionTitle: 'EGFR panel re-analysis',
  });
  checkTruthy('the prompt asks an untitled session to be named', untitledPrompt.includes('session_title'));
  check('and tells a named one to keep its name', namedPrompt.includes('do not rename it'), true);
  checkTruthy('the prompt lets the agent split a different job', untitledPrompt.includes('split_session'));
  check('and says a step of the same job is not a split', untitledPrompt.includes('not a split'), true);

  // A different job opens its own session, so the two do not share a context.
  let splitTitle: string | undefined;
  let splitPrompt: string | undefined;
  let splitId: string | undefined;
  const splittable: ToolContext = {
    ...ctx,
    domain: {
      ...domain,
      splitSession: (title, prompt) => {
        splitTitle = title;
        splitPrompt = prompt;
        splitId = 's-split';
        return splitId;
      },
    },
  };
  const split = await executeToolCall(
    call('split_session', { title: 'Dose response curve.', new_prompt: 'Fit the curve.' }),
    splittable,
  );
  check('split_session opens a session', splitId, 's-split');
  check('with the title it was given', splitTitle, 'Dose response curve');
  check('and the prompt that runs there', splitPrompt, 'Fit the curve.');
  checkTruthy('and says it started there', split.content.includes('started there'));
  const noTitle = await executeToolCall(call('split_session', { new_prompt: 'x' }), splittable);
  check('split_session refuses a call with no title', noTitle.isError, true);
  const noPrompt = await executeToolCall(call('split_session', { title: 'x' }), splittable);
  check('split_session refuses a call with no prompt', noPrompt.isError, true);
  const splitTool = findTool('split_session');
  check('split_session is a core tool', splitTool?.scope, 'core');
  check('and asks the reader before it runs', splitTool ? needsPermission(splitTool) : null, true);

  const created = await executeToolCall(
    call('task_create', { title: 'Fit the model', status: 'active', priority: 3 }),
    dctx,
  );
  check('task_create is not an error', created.isError, false);
  check('and records the task', tasks.length, 1);
  check('with the asked-for status', tasks[0]?.status, 'active');
  checkTruthy('and names it in the result', created.content.includes(tasks[0]!.key));

  const found = await executeToolCall(call('task_search', { query: 'model' }), dctx);
  checkTruthy('task_search finds it', found.content.includes(tasks[0]!.key));

  await executeToolCall(call('task_update', { task: tasks[0]!.key, status: 'done' }), dctx);
  check('task_update settles the task', tasks[0]?.status, 'done');

  check(
    'target_search with no targets is an error',
    (await executeToolCall(call('target_search', {}), dctx)).isError,
    true,
  );

  targets.push(newTarget({ name: 'lab-gpu', kind: 'slurm', host: 'gpu.lab', readiness: 'ready' }));
  const targetFound = await executeToolCall(call('target_search', { query: 'gpu' }), dctx);
  checkTruthy('target_search finds a target', targetFound.content.includes('lab-gpu'));

  const queued = await executeToolCall(
    call('job_create', { name: 'train', command: 'uv run train.py', target: 'lab-gpu' }),
    dctx,
  );
  checkTruthy('job_create queues a job', jobs.length === 1 && jobs[0]!.name === 'train');
  check('on the named target', jobs[0]?.targetId, targets[0]!.id);
  checkTruthy('and reports it', queued.content.includes('train'));

  const freshJob = newJob({ name: 'x', command: 'y', targetId: 't' });
  check('a new job starts queued', freshJob.state, 'queued');

  // Waves: the stretch of work a task is planned into.
  check(
    'wave_list with no waves is an error',
    (await executeToolCall(call('wave_list', {}), dctx)).isError,
    true,
  );

  const opened = await executeToolCall(
    call('wave_create', {
      name: 'Docking campaign',
      goal: 'Sweep the twelve structures',
      start: '2026-03-03',
      end: '2026-03-24',
    }),
    dctx,
  );
  check('wave_create opens a wave', waves.length, 1);
  check(
    'with the period it was given',
    [waves[0]?.startDate, waves[0]?.endDate],
    ['2026-03-03', '2026-03-24'],
  );
  checkTruthy('and reports its number', opened.content.includes('W1'));

  check(
    'a bad date is refused',
    (await executeToolCall(call('wave_create', { name: 'x', start: 'the third' }), dctx)).isError,
    true,
  );

  const listed = await executeToolCall(call('wave_list', {}), dctx);
  checkTruthy('wave_list names the wave', listed.content.includes('Docking campaign'));
  checkTruthy('and its goal', listed.content.includes('Sweep the twelve structures'));
  checkTruthy(
    'and how far along it is',
    /(days left|days over|last day)/.test(listed.content),
    listed.content,
  );

  // A wave around today is the current one, and says how much of it is left.
  const today = new Date().toISOString().slice(0, 10);
  const fortnight = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
  await executeToolCall(call('wave_create', { name: 'Now', start: today, end: fortnight }), dctx);
  const current = await executeToolCall(call('wave_list', { current: true }), dctx);
  checkTruthy(
    'the current wave is the one that contains today',
    current.content.includes('Now'),
    current.content,
  );
  checkTruthy('and it is marked as current', current.content.includes('current'), current.content);
  check('an end with no start is two weeks out', waves[1]?.endDate, fortnight);

  // A task is planned into the wave by number, and the task is reported as being in it.
  const planned = await executeToolCall(call('task_create', { title: 'Re-run the panel', wave: 'W1' }), dctx);
  check('a task created with a wave lands in it', tasks[1]?.waveId, waves[0]?.id);
  checkTruthy('and the result says so', planned.content.includes('in W1'));

  await executeToolCall(call('task_update', { task: tasks[0]!.key, wave: '1' }), dctx);
  check('a task can be moved into a wave by number alone', tasks[0]?.waveId, waves[0]?.id);

  await executeToolCall(call('task_update', { task: tasks[0]!.key, wave: 'none' }), dctx);
  check('and taken out of every wave', tasks[0]?.waveId, null);

  check(
    'an unknown wave is refused rather than silently ignored',
    (await executeToolCall(call('task_update', { task: tasks[0]!.key, wave: 'W9' }), dctx)).isError,
    true,
  );
  check('and the task is left where it was', tasks[0]?.waveId, null);

  const renamed = await executeToolCall(call('wave_update', { wave: 'W1', name: 'Docking sweep' }), dctx);
  check('wave_update renames the wave', waves[0]?.name, 'Docking sweep');
  checkTruthy('and says what changed', renamed.content.includes('name'));

  check(
    'a wave update with nothing to change is an error',
    (await executeToolCall(call('wave_update', { wave: 'W1' }), dctx)).isError,
    true,
  );

  check(
    'without a domain the tool is refused',
    (await executeToolCall(call('task_create', { title: 'x' }), ctx)).isError,
    true,
  );
}

/* ================================================================================================
 * Permissions
 * ============================================================================================== */

console.log('\n— permissions —');
{
  check('reading needs no confirmation', needsPermission(findTool('read_file')!), false);
  check('grepping needs no confirmation', needsPermission(findTool('grep')!), false);
  check('writing needs confirmation', needsPermission(findTool('write_file')!), true);
  check('running a command needs confirmation', needsPermission(findTool('run_command')!), true);
  check('fetching needs confirmation', needsPermission(findTool('fetch_url')!), true);
}

/* ================================================================================================
 * Delegation
 *
 * The lead hands a bounded task to a worker with a specific pack assignment. The mock answers
 * as both, in call order — lead, then worker, then lead — so the whole path is exercised.
 * ============================================================================================== */

console.log('\n— delegation —');
{
  const enabledPacks: PackId[] = ['genomics', 'molecular', 'ml'];
  const surface = resolveWorkbenchSurface({ enabledPacks });
  const model = scripted(
    toolTurn('task', 't1', { subagent_type: 'literature', prompt: 'Find EGFR records.' }),
    textTurn('Found three EGFR records.'),
    textTurn('Done.'),
  );
  const engine = createModelEngine({
    provider,
    modelId: 'mock',
    baseUrl: 'local',
    supportsReasoning: false,
    model,
  });

  const blocks: Block[] = [];
  // The delegation's own session, as the host would keep it.
  const subs: { title: string; worker: string; blocks: Block[]; text: string; done: number }[] = [];
  let leadText = '';
  await engine.run({
    prompt: 'go',
    workspace: '/tmp/workspace',
    modelRef: 'mock/mock',
    mode: 'agent',
    reasoning: 'off',
    transcript: [{ role: 'user', content: 'go' }],
    surface,
    enabledPacks,
    guard: { guarded: false, ask: async () => true, policy: { ...DEFAULT_GUARD, enabled: false } },
    host,
    domain: dummyDomain(),
    signal: new AbortController().signal,
    onBlock: (block) => blocks.push(block),
    onText: (text) => {
      leadText = text;
    },
    onThinking: () => undefined,
    onDone: () => undefined,
    openSubsession: ({ worker, description }) => {
      const sub = { title: description, worker: worker.name, blocks: [] as Block[], text: '', done: 0 };
      subs.push(sub);
      return {
        onBlock: (block) => sub.blocks.push(block),
        onText: (text) => {
          sub.text = text;
        },
        onThinking: () => undefined,
        onDone: () => {
          sub.done += 1;
        },
      };
    },
  });

  const task = blocks.filter((block) => block.kind === 'tool' && block.name === 'task').pop();
  checkTruthy('the lead delegated to a worker', task && task.kind === 'tool' && task.status === 'ok');
  checkTruthy(
    'the handoff carries the worker answer',
    task && task.kind === 'tool' && task.output?.includes('three EGFR records'),
  );

  // The delegation opened a session of its own, titled for the reader, and the worker's prose
  // went there rather than into the lead's transcript.
  check('one delegation opened one subsession', subs.length, 1);
  check('it is named after the worker', subs[0]?.worker, 'Literature');
  check('its title is the call’s own label', subs[0]?.title, 'Find EGFR records.');
  checkTruthy('the worker’s answer is in its own session', subs[0]?.text.includes('three EGFR records'));
  check(
    'the lead never sees the worker’s prose streamed as its own',
    leadText.includes('three EGFR records'),
    false,
  );
  check('and the subsession settles when the worker stops', subs[0]?.done, 1);

  // The worker is the second model call; its declared tools say who it was.
  const workerTools = ((model.doStreamCalls[1]?.tools ?? []) as { name: string }[]).map((t) => t.name);
  checkTruthy('the worker got the literature tools', workerTools.includes('science_search'));
  check('the worker could not re-delegate', workerTools.includes('task'), false);
  // The plan and the session's name belong to the lead; a worker offered them could only fail.
  check('the worker cannot write the session plan', workerTools.includes('plan_update'), false);
  check('the worker cannot name the session', workerTools.includes('session_title'), false);
  check('the worker cannot split the session', workerTools.includes('split_session'), false);
  check('the worker got a cross-domain tool its pack grants', workerTools.includes('statistics'), true);

  // A worker assigned a pack the workbench has not opened is told, not silently widened.
  const strict = scripted(
    toolTurn('task', 't2', { subagent_type: 'literature', prompt: 'x' }),
    textTurn('Nothing to use.'),
    textTurn('Done.'),
  );
  const strictEngine = createModelEngine({
    provider,
    modelId: 'mock',
    baseUrl: 'local',
    supportsReasoning: false,
    model: strict,
  });
  const strictBlocks: Block[] = [];
  await strictEngine.run({
    prompt: 'go',
    workspace: '/tmp/workspace',
    modelRef: 'mock/mock',
    mode: 'agent',
    reasoning: 'off',
    transcript: [{ role: 'user', content: 'go' }],
    surface: resolveWorkbenchSurface({ enabledPacks: ['ml'] }),
    enabledPacks: ['ml'],
    guard: { guarded: false, ask: async () => true, policy: { ...DEFAULT_GUARD, enabled: false } },
    host,
    domain: dummyDomain(),
    signal: new AbortController().signal,
    onBlock: (block) => strictBlocks.push(block),
    onText: () => undefined,
    onThinking: () => undefined,
    onDone: () => undefined,
  });
  const strictTask = strictBlocks.filter((block) => block.kind === 'tool' && block.name === 'task').pop();
  checkTruthy(
    'a closed pack is reported in the handoff',
    strictTask && strictTask.kind === 'tool' && strictTask.output?.includes('not open on the workbench'),
  );
}

/**
 * The lead's plan.
 *
 * The plan is the lead's page, so the tool has to reach the session's own domain: a run that
 * strips it makes `plan_update` fail in every turn, which is the one failure a reader sees
 * every single time they ask for something large.
 */
console.log('\n— the session plan —');
{
  let planned: { goal: string; steps: { title: string }[] } | undefined;
  const model = scripted(
    toolTurn('plan_update', 'p1', {
      goal: 'Ship the cathode scan',
      steps: [{ title: 'Read the engine', status: 'active' }],
    }),
    textTurn('Planned.'),
  );
  const engine = createModelEngine({
    provider,
    modelId: 'mock',
    baseUrl: 'local',
    supportsReasoning: false,
    model,
  });
  const blocks: Block[] = [];
  await engine.run({
    prompt: 'go',
    workspace: '/tmp/workspace',
    modelRef: 'mock/mock',
    mode: 'agent',
    reasoning: 'off',
    transcript: [{ role: 'user', content: 'go' }],
    surface: resolveWorkbenchSurface({ enabledPacks: [] }),
    enabledPacks: [],
    guard: { guarded: false, ask: async () => true, policy: { ...DEFAULT_GUARD, enabled: false } },
    host,
    domain: {
      ...dummyDomain(),
      sessionPlan: () => planned as never,
      setSessionPlan: (plan) => {
        planned = plan as never;
      },
    },
    signal: new AbortController().signal,
    onBlock: (block) => blocks.push(block),
    onText: () => undefined,
    onThinking: () => undefined,
    onDone: () => undefined,
  });

  const call = blocks.filter((block) => block.kind === 'tool' && block.name === 'plan_update').pop();
  check('the lead may write the session plan', planned?.steps[0]?.title, 'Read the engine');
  checkTruthy('and the call is reported as done', call && call.kind === 'tool' && call.status === 'ok');
}

/** A domain host backed by empty in-memory lists. */
function dummyDomain() {
  return {
    tasks: () => [],
    targets: () => [],
    jobs: () => [],
    records: () => [],
    addTask: () => undefined,
    patchTask: () => undefined,
    addTarget: () => undefined,
    addJob: () => undefined,
    addRecords: () => undefined,
  };
}

/* ================================================================================================
 * Usage accounting
 * ============================================================================================== */

console.log('\n— usage —');
{
  const model = scripted([
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'hi' },
    { type: 'text-end', id: 't' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 120, noCache: 80, cacheRead: 40, cacheWrite: 0 },
        outputTokens: { total: 8, text: 8, reasoning: 0 },
      },
    },
  ]);
  const engine = createModelEngine({
    provider,
    modelId: 'mock',
    baseUrl: 'local',
    supportsReasoning: false,
    model,
  });
  const blocks: Block[] = [];
  await engine.run({
    prompt: 'go',
    workspace: '/tmp/workspace',
    modelRef: 'mock/mock',
    mode: 'agent',
    reasoning: 'off',
    transcript: [{ role: 'user', content: 'go' }],
    surface: resolveWorkbenchSurface({ enabledPacks: [] }),
    enabledPacks: [],
    guard: { guarded: false, ask: async () => true, policy: { ...DEFAULT_GUARD, enabled: false } },
    host,
    domain: dummyDomain(),
    signal: new AbortController().signal,
    onBlock: (block) => blocks.push(block),
    onText: () => undefined,
    onThinking: () => undefined,
    onDone: () => undefined,
  });
  const run = blocks.find((block) => block.kind === 'run');
  check(
    'the run footer carries the tokens the turn reported',
    run && run.kind === 'run' ? [run.tokensIn, run.tokensOut, run.cachedTokens] : null,
    [120, 8, 40],
  );
}

/* ================================================================================================
 * The transcript bridge
 * ============================================================================================== */

console.log('\n— transcript bridge —');
{
  const messages: Message[] = [
    { id: 'u', role: 'user', blocks: [{ kind: 'text', text: 'read it' }], createdAt: 0 },
    {
      id: 'a',
      role: 'assistant',
      blocks: [
        { kind: 'text', text: 'reading' },
        {
          kind: 'tool',
          callId: 'c1',
          name: 'read_file',
          description: 'read_file a.txt',
          status: 'ok',
          startedAt: 0,
          endedAt: 1,
          output: 'A',
          input: { path: 'a.txt' },
        },
        { kind: 'text', text: 'done' },
      ],
      createdAt: 0,
    },
  ];
  const transcript = blocksToTranscript(messages);
  check(
    'the transcript is user, assistant, tool, assistant',
    transcript.map((e) => e.role),
    ['user', 'assistant', 'tool', 'assistant'],
  );
  const firstAssistant = transcript[1];
  checkTruthy(
    'the assistant turn carries the call',
    firstAssistant &&
      firstAssistant.role === 'assistant' &&
      firstAssistant.toolCalls[0]!.name === 'read_file',
  );
  checkTruthy(
    'with the arguments round-tripped',
    firstAssistant &&
      firstAssistant.role === 'assistant' &&
      firstAssistant.toolCalls[0]!.arguments === '{"path":"a.txt"}',
  );
  const toolEntry = transcript[2];
  checkTruthy(
    'the result keeps the provider call id',
    toolEntry && toolEntry.role === 'tool' && toolEntry.result.toolCallId === 'c1',
  );
  const last = transcript[3];
  checkTruthy(
    'the trailing prose is its own turn',
    last && last.role === 'assistant' && last.content === 'done' && last.toolCalls.length === 0,
  );
}

/* ================================================================================================
 * Engine resolution
 * ============================================================================================== */

console.log('\n— engine resolution —');
{
  const resolve = (modelRef: string, providersWithKeys: Record<string, boolean> = {}) =>
    createEngine({ modelRef, baseUrls: {}, providersWithKeys });

  check('a hosted provider with no key falls back', resolve('anthropic/claude-sonnet-4-6').id, 'echo');
  checkTruthy(
    'and says which credential is missing',
    resolve('anthropic/claude-sonnet-4-6').description.includes('Anthropic'),
  );
  check(
    'the same provider with a key uses the model',
    resolve('anthropic/claude-sonnet-4-6', { anthropic: true }).id,
    'anthropic/claude-sonnet-4-6',
  );
  check('a local server needs no key', resolve('ollama/llama3').id, 'ollama/llama3');
  check('an unregistered provider falls back', resolve('nope/some-model').id, 'echo');
  check('an empty model id falls back', resolve('anthropic/').id, 'echo');
  check('a bare provider name falls back', resolve('anthropic').id, 'echo');
  check(
    'a model that needs no base url is reachable',
    resolve('openai/gpt-5.2', { openai: true }).id,
    'openai/gpt-5.2',
  );
  check(
    'the OpenCode membership resolves a member model',
    resolve('opencode/muse-spark-1.3-contributor-free', { opencode: true }).id,
    'opencode/muse-spark-1.3-contributor-free',
  );
  check('and falls back without a key', resolve('opencode/muse-spark-1.3-contributor-free').id, 'echo');
  check(
    'a base URL override is honoured',
    createEngine({
      modelRef: 'custom/some-model',
      baseUrls: { custom: 'http://localhost:1234/v1' },
      providersWithKeys: {},
    }).id,
    'custom/some-model',
  );
  check('a custom provider with no base URL falls back', resolve('custom/some-model').id, 'echo');
}

console.log('\n— catalogue tools —');
{
  const listed = await executeToolCall(call('list_databases', {}), ctx);
  check('the catalogue lists its databases', listed.content.includes('openalex'), true);
  check('and says what each holds', listed.content.includes('Works'), true);

  const unknown = await executeToolCall(call('query_database', { database: 'nope' }), ctx);
  check('an unknown database is refused', unknown.isError, true);
  check('with a pointer to list_databases', unknown.content.includes('list_databases'), true);

  const noDomain = await executeToolCall(call('run_review', { question: 'x' }), ctx);
  check('starting a review without the store is refused', noDomain.isError, true);

  const questions: string[] = [];
  const domain: ToolContext['domain'] = {
    tasks: () => [],
    targets: () => [],
    jobs: () => [],
    records: () => [],
    addTask: () => undefined,
    patchTask: () => undefined,
    addTarget: () => undefined,
    addJob: () => undefined,
    addRecords: () => undefined,
    startReview: (inputs) => {
      questions.push(inputs.question);
      return 'review-1';
    },
  };
  const started = await executeToolCall(call('run_review', { question: 'Does it work?' }), {
    ...ctx,
    domain,
  });
  check('a review starts in the background', started.isError, false);
  check('and its id is reported back', started.content.includes('review-1'), true);
  check('with the question passed on', questions, ['Does it work?']);

  const none = await executeToolCall(call('run_review', { question: 'x' }), {
    ...ctx,
    domain: { ...domain, startReview: () => null },
  });
  check('no sources is a readable refusal', none.isError, true);
}

console.log('\n— scan tools —');
{
  const scan = await executeToolCall(call('scan_pdf', { doi: '10.1/x' }), ctx);
  check('scan_pdf without the desktop runtime is a readable failure', scan.isError, true);
  checkTruthy('and names the runtime', scan.content.includes('desktop runtime'));

  const missing = await executeToolCall(call('scan_pdf', {}), ctx);
  check('scan_pdf asks for something to scan', missing.isError, true);
  checkTruthy('and lists the ways', missing.content.includes('`doi`'));

  const noQuery = await executeToolCall(call('search_library', {}), ctx);
  check('search_library requires a query', noQuery.isError, true);
  checkTruthy('and says so', noQuery.content.includes('`query` is required'));

  const noWorkspace = await executeToolCall(call('search_library', { query: 'chromatin' }), {
    ...ctx,
    workspace: '',
  });
  check('without a workspace the tool refuses', noWorkspace.isError, true);
  checkTruthy('and says why', noWorkspace.content.includes('workspace folder'));
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: the turn runs to a stop, tools execute or refuse, and the transcript round-trips');
