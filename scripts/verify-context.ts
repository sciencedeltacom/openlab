/**
 * Checks the token budget, the transcript fit and the output shapes.
 *
 * Run with: `bun scripts/verify-context.ts`
 *
 * Every number here is an estimate, so what is tested is not a price but the rules: the
 * prompt no longer carries the interface language of every turn, a tool result keeps its end,
 * a large transcript is fitted without orphan tool calls, and a delegated worker's calls are
 * not replayed to the lead.
 */

import { buildSystemPrompt } from '../src/lib/agent/prompt';
import { resolveWorkbenchSurface } from '../src/lib/agent/packs';
import { executeToolCall, outputLimit, type ToolHost } from '../src/lib/agent/registry';
import {
  entryTokens,
  estimateTokens,
  fitTranscript,
  messageTokens,
  transcriptBudget,
} from '../src/lib/agent/tokens';
import type { ToolCall, TranscriptEntry } from '../src/lib/agent/transcript';
import { blocksToTranscript } from '../src/store/transcript';
import type { Message } from '../src/store/types';
import { toDelimited, toToon } from '../src/lib/format/tabular';
import { effortFor, outputBudget } from '../src/lib/ai/budget';
import { systemInstruction } from '../src/lib/ai/run';

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

/** A host whose reads and commands the checks control. */
function host(overrides: Partial<ToolHost> = {}): ToolHost {
  return {
    readFile: async () => '',
    writeFile: async () => undefined,
    listDir: async () => [],
    glob: async () => [],
    grep: async () => '',
    runCommand: async () => ({ output: '', exitCode: 0 }),
    fetchUrl: async () => '',
    ...overrides,
  };
}

const context = (h: ToolHost) => ({ workspace: '/tmp/lab', signal: new AbortController().signal, host: h });
const call = (name: string, args: Record<string, unknown>, id = 'c1'): ToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

// ── Estimation ──────────────────────────────────────────────────────────────────────────────

check('an empty string is no tokens', estimateTokens(''), 0);
checkTruthy('a longer string costs more', estimateTokens('x'.repeat(3600)) === 1000);
checkTruthy('a budget is a share of the window', transcriptBudget(200_000) < 200_000);
check('a tiny window still gets a working budget', transcriptBudget(8_000), 8_000);

const message: Message = {
  id: 'm1',
  role: 'assistant',
  createdAt: Date.now(),
  blocks: [
    { kind: 'text', text: 'x'.repeat(360) },
    { kind: 'thinking', text: 'x'.repeat(36_000), startedAt: 0, endedAt: 1 },
  ],
};
check('thinking is not replayed, so it is not counted', messageTokens(message), 100);

// ── The prompt no longer teaches the interface language every step ───────────────────────────

const everything = resolveWorkbenchSurface({
  enabledPacks: [
    'genomics',
    'molecular',
    'ml',
    'structural-biology',
    'cheminformatics',
    'proteomics',
    'transcriptomics',
    'imaging',
    'epidemiology',
  ],
});
const prompt = buildSystemPrompt({ mode: 'agent', workspace: '/tmp/lab', surface: everything });
check('the prompt points at the guide', prompt.includes('openui-guide'), true);
check('the full interface language is not in the prompt', prompt.includes('root ='), false);
checkTruthy('the prompt is a fraction of what it was (41k before)', prompt.length < 12_000);

// ── A tool result keeps both ends ────────────────────────────────────────────────────────────

const longRead = await executeToolCall(
  call('read_file', { path: 'big.txt' }),
  context(host({ readFile: async () => `HEAD${'x'.repeat(40_000)}TAIL` })),
);
checkTruthy('the head survives the cap', longRead.content.startsWith('HEAD'));
checkTruthy('the tail survives the cap', longRead.content.endsWith('TAIL'));
checkTruthy('the cut is stated', longRead.content.includes('elided'));
checkTruthy('one result cannot exceed its tool budget', longRead.content.length <= outputLimit('read_file') + 120);

// ── Reading a range instead of the file ─────────────────────────────────────────────────────

const ranged = await executeToolCall(
  call('read_file', { path: 'table.csv', start_line: 2, end_line: 3 }),
  context(host({ readFile: async () => 'a,b\n1,2\n3,4\n5,6' })),
);
checkTruthy('a range names its lines', ranged.content.includes('lines 2-3'));
checkTruthy('a range keeps the asked-for lines', ranged.content.includes('1,2') && ranged.content.includes('3,4'));
checkTruthy('a range leaves the rest out', !ranged.content.includes('5,6'));

// ── Fitting a transcript ────────────────────────────────────────────────────────────────────

const entries: TranscriptEntry[] = [];
for (let index = 0; index < 40; index += 1) {
  entries.push({
    role: 'assistant',
    content: '',
    toolCalls: [{ id: `c${index}`, name: 'read_file', arguments: '{}' }],
  });
  entries.push({
    role: 'tool',
    result: {
      toolCallId: `c${index}`,
      name: 'read_file',
      content: `file ${index}\n${'x'.repeat(20_000)}`,
      isError: false,
    },
  });
}
const fitted = fitTranscript(entries, 30_000);
const fittedTokens = fitted.reduce((sum, entry) => sum + entryTokens(entry), 0);
check('the fitted transcript starts with a call, not an orphan result', fitted[0]?.role !== 'tool', true);
checkTruthy('the newest result is verbatim', JSON.stringify(fitted.at(-1)).includes('file 39'));
checkTruthy('the fitted transcript is within the budget', fittedTokens < 30_000);
const callIds = new Set(
  fitted.flatMap((entry) => (entry.role === 'assistant' ? entry.toolCalls.map((item) => item.id) : [])),
);
check(
  'every surviving result has its call',
  fitted.every((entry) => entry.role !== 'tool' || callIds.has(entry.result.toolCallId)),
  true,
);
checkTruthy('something was elided', JSON.stringify(fitted).includes('elided'));

// ── A worker's calls are drawn, not replayed ─────────────────────────────────────────────────

const delegated: Message = {
  id: 'm2',
  role: 'assistant',
  createdAt: Date.now(),
  blocks: [
    {
      kind: 'tool',
      name: 'grep',
      description: 'grep TODO',
      status: 'ok',
      startedAt: 0,
      endedAt: 1,
      output: 'src/a.ts:1: TODO',
      callId: 'w1',
      worker: 'explore',
    },
  ],
};
check('a worker tool block is not in the lead transcript', blocksToTranscript([delegated]), []);

// ── Table shapes ────────────────────────────────────────────────────────────────────────────

check(
  'csv quotes a delimiter and keeps the header once',
  toDelimited([{ a: 1, b: 'x,y' }, { a: 2, b: 'plain' }]),
  'a,b\n1,"x,y"\n2,plain',
);
check(
  'toon states the shape once',
  toToon([{ a: 1, b: 2 }, { a: 3, b: 4 }]),
  'records[2]{a,b}:\n  1,2\n  3,4',
);
checkTruthy('a nested value stays JSON in its cell', toDelimited([{ a: { b: 1 } }]).includes('"{""b"":1}"'));

// ── The prefix is cacheable, and a small answer is small ────────────────────────────────────

const cached = systemInstruction('hello', true);
checkTruthy(
  'a cached prefix carries an ephemeral breakpoint',
  typeof cached === 'object' &&
    JSON.stringify(cached.providerOptions).includes('"cacheControl":{"type":"ephemeral"}'),
);
check('an uncached prefix stays a string', systemInstruction('hello', false), 'hello');
checkTruthy('ask costs less output than agent', outputBudget('ask') < outputBudget('agent'));
check('plan thinking is capped', effortFor('plan', 'high'), 'medium');
check('agent keeps the chosen effort', effortFor('agent', 'high'), 'high');

// ── A big command output is kept as an artifact ─────────────────────────────────────────────

let written: { path: string; contents: string } | undefined;
const artifact = await executeToolCall(
  call('run_command', { command: 'make' }),
  context(
    host({
      runCommand: async () => ({ output: `HEAD${'x'.repeat(30_000)}TAIL`, exitCode: 0 }),
      writeFile: async (path, contents) => {
        written = { path, contents };
      },
    }),
  ),
);
checkTruthy('a large result is written to .openlab/artifacts', written?.path.startsWith('.openlab/artifacts/'));
checkTruthy('the artifact holds the whole output', written?.contents.endsWith('TAIL'));
checkTruthy('the model is given the path', artifact.content.includes(written?.path ?? 'missing'));

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: the prompt is lazy, results keep both ends, and context is fitted without orphans');
