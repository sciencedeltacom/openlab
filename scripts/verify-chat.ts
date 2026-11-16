/**
 * Checks the provider layer around the model: how a provider is registered, how the catalog
 * maps onto one, how a `provider/model-id` resolves to an engine, and the small text transforms
 * the chat surface relies on (mentions, tags, wiki links).
 *
 * Run with: `bun scripts/verify-chat.ts`
 *
 * The wire format itself is no longer this app's to get right — the AI SDK's provider packages
 * speak the three protocols — so what is worth testing here is the data the app feeds them.
 */

import { createEngine } from '../src/store/engine';
import { authFor, PROTOCOL_PACKAGE } from '../src/lib/ai/models';
import { providerHeaders } from '../src/lib/ai/transport';
import { openuiSystemPrompt, OPENUI_FENCE, openuiLibrary } from '../src/lib/openui';
import { createParser } from '@openuidev/react-lang';
import {
  PROVIDERS,
  createProvider,
  mergeProviders,
  parseModelLine,
  type Provider,
} from '../src/lib/providers';
import { catalogToProvider, protocolFor, type CatalogProvider } from '../src/lib/models-dev';
import { remarkMentions } from '../src/lib/chat/mentions';
import { tagColor } from '../src/lib/chat/tags';
import {
  MENTION_KINDS,
  findReference,
  mentionKind,
  parseMentions,
  referenceBlock,
  referencesFrom,
  slug,
  withReferences,
} from '../src/lib/chat/references';
import { newJob, newTarget } from '../src/store/compute';
import { newTask, newWave } from '../src/store/research';
import type { Experiment } from '../src/components/experiments/experiments';
import type { Database } from '../src/components/databases/data';
import { resolveWikiLink } from '../src/lib/knowledge/wiki';

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
 * Protocol mapping
 *
 * A provider declares how it speaks; that choice picks the credential and the SDK package. A
 * wrong pairing is a 401 or a malformed body, so it is pinned here.
 * ============================================================================================== */

console.log('\n— protocol mapping —');
{
  const of = (protocol: Provider['protocol'], requiresKey: boolean): Provider => ({
    id: 'x',
    label: 'X',
    protocol,
    requiresKey,
    summary: '',
    fields: [],
    models: [],
  });

  check('anthropic uses the x-api-key header', authFor(of('anthropic', true)), {
    kind: 'header',
    name: 'x-api-key',
  });
  check('google uses the key query parameter', authFor(of('google', true)), { kind: 'query', name: 'key' });
  check('a hosted openai provider uses a bearer token', authFor(of('openai', true)), { kind: 'bearer' });
  check('a local server takes no credential', authFor(of('local', false)), { kind: 'none' });
  check('a custom no-key endpoint takes no credential', authFor(of('openai', false)), { kind: 'none' });

  check('anthropic is served by its SDK package', PROTOCOL_PACKAGE.anthropic, '@ai-sdk/anthropic');
  check('google is served by its SDK package', PROTOCOL_PACKAGE.google, '@ai-sdk/google');
  check(
    'the openai dialect is served by openai-compatible',
    PROTOCOL_PACKAGE.openai,
    '@ai-sdk/openai-compatible',
  );
  check('local servers speak the openai dialect', PROTOCOL_PACKAGE.local, '@ai-sdk/openai-compatible');
}

/* ================================================================================================
 * Engine resolution
 *
 * The engine has to be honest about whether it can reach a model. Every path that cannot is a
 * fallback to the scripted preview carrying the reason, because a turn that silently runs a
 * script while looking like an answer is the one failure a researcher cannot detect.
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

/* ================================================================================================
 * Provider registry
 * ============================================================================================== */

console.log('\n— provider registry —');
{
  const custom = createProvider({
    id: 'lab',
    label: 'Lab gateway',
    protocol: 'openai',
    baseUrl: 'https://gw.example.edu/v1',
    requiresKey: true,
    models: [parseModelLine('m1 | Model One | 128000')!],
  });
  check('a created provider keeps its base url', custom.defaultBaseUrl, 'https://gw.example.edu/v1');
  check('a model line becomes a descriptor', custom.models[0], {
    id: 'm1',
    label: 'Model One',
    contextWindow: 128000,
    supportsTools: true,
  });
  check('a model line with no context omits the window', parseModelLine('m2'), {
    id: 'm2',
    label: 'm2',
    supportsTools: true,
  });

  const merged = mergeProviders([custom]);
  checkTruthy(
    'a custom provider is added to the list',
    merged.some((provider) => provider.id === 'lab'),
  );
  check('and the built-ins stay', merged.length, PROVIDERS.length + 1);

  const override = createProvider({
    id: 'anthropic',
    label: 'My Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://proxy.example/v1',
    requiresKey: true,
  });
  const overridden = mergeProviders([override]);
  check(
    'a custom entry overrides a built-in of the same id',
    overridden.find((p) => p.id === 'anthropic')?.label,
    'My Anthropic',
  );
  check('and the list does not grow', overridden.length, PROVIDERS.length);

  const engine = createEngine({
    modelRef: 'lab/m1',
    baseUrls: {},
    providersWithKeys: { lab: true },
    providers: merged,
  });
  check('the engine reaches a custom provider', engine.id, 'lab/m1');
}

/* ================================================================================================
 * models.dev catalog
 * ============================================================================================== */

console.log('\n— models.dev catalog —');
{
  const entry = (over: Partial<CatalogProvider>): CatalogProvider => ({
    id: 'x',
    name: 'X',
    models: [],
    ...over,
  });

  const anthropic = catalogToProvider(
    entry({
      id: 'anthropic',
      name: 'Anthropic',
      npm: '@ai-sdk/anthropic',
      env: ['ANTHROPIC_API_KEY'],
      models: [{ id: 'm', name: 'M', context: 200000, tools: true }],
    }),
  );
  check('a catalog provider keeps its protocol', anthropic.protocol, 'anthropic');
  check('and reuses the built-in base url', anthropic.defaultBaseUrl, 'https://api.anthropic.com/v1');
  check('and needs a key', anthropic.requiresKey, true);
  check('its models become descriptors', anthropic.models[0], {
    id: 'm',
    label: 'M',
    contextWindow: 200000,
    supportsTools: true,
    supportsReasoning: false,
    supportsVision: false,
  });

  const local = catalogToProvider(
    entry({
      id: 'lmstudio',
      name: 'LM Studio',
      api: 'http://127.0.0.1:1234/v1',
      npm: '@ai-sdk/openai-compatible',
    }),
  );
  check('a loopback api is local', local.protocol, 'local');
  check('and needs no key', local.requiresKey, false);

  check(
    'the npm package picks the protocol',
    {
      anthropic: protocolFor('@ai-sdk/anthropic'),
      google: protocolFor('@ai-sdk/google'),
      openai: protocolFor('@ai-sdk/openai-compatible'),
    },
    { anthropic: 'anthropic', google: 'google', openai: 'openai' },
  );

  const file = (await Bun.file('public/models-dev.json').json()) as { providers: CatalogProvider[] };
  checkTruthy('the shipped catalog carries providers', file.providers.length > 200);
  checkTruthy(
    'and every provider maps to a reachable shape',
    file.providers.every((provider) => catalogToProvider(provider).id === provider.id),
  );

  const goHeaders = providerHeaders('https://opencode.ai/zen/go/v1', 's-42');
  check(
    'OpenCode Go gets a session id',
    goHeaders.find(([name]) => name === 'x-opencode-session')?.[1],
    's-42',
  );
  checkTruthy(
    'and a client user agent',
    goHeaders.some(([name]) => name === 'User-Agent'),
  );
  check('other providers get no extra headers', providerHeaders('https://api.openai.com/v1', 's-42'), []);
}

/* ================================================================================================
 * Chat text
 * ============================================================================================== */

console.log('\n— chat text —');
{
  const tree = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'see @skill:power-analysis and @src/app.ts now' }],
      },
      { type: 'code', value: '@not/a/mention' },
    ],
  };
  remarkMentions()(tree as never);
  const paragraph = (tree.children[0] as { children: { type: string; value: string }[] }).children;
  check(
    'a mention becomes its own node',
    paragraph.filter((node) => node.type === 'mention').map((node) => node.value),
    ['@skill:power-analysis', '@src/app.ts'],
  );
  check(
    'and the surrounding prose stays',
    paragraph
      .filter((node) => node.type === 'text')
      .map((node) => node.value)
      .join(''),
    'see  and  now',
  );

  const tagTree = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'status [canonical] [verified] and [1]' }] },
    ],
  };
  remarkMentions()(tagTree as never);
  const tagKids = (tagTree.children[0] as { children: { type: string; value?: string }[] }).children;
  check(
    'a bracketed token becomes a tag',
    tagKids.filter((node) => node.type === 'tag').map((node) => node.value),
    ['canonical', 'verified'],
  );
  checkTruthy(
    'and a numeric citation is left as text',
    tagKids
      .filter((node) => node.type === 'text')
      .map((node) => node.value ?? '')
      .join('')
      .includes('[1]'),
  );

  const recordTree = {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'see record:pmid-1 and record:10.1063/x' }] },
    ],
  };
  remarkMentions()(recordTree as never);
  const recordKids = (recordTree.children[0] as { children: { type: string; value?: string }[] }).children;
  check(
    'a record citation becomes its own node',
    recordKids.filter((node) => node.type === 'record').map((node) => node.value),
    ['pmid-1', '10.1063/x'],
  );

  check('a known tag keeps its colour', tagColor('verified'), 'success');
  check('and is not case-sensitive', tagColor('Verified'), tagColor('verified'));
  check('an unknown tag is stable', tagColor('customtag'), tagColor('customtag'));
  check(
    'and lands in the palette',
    ['default', 'accent', 'success', 'warning', 'danger'].includes(tagColor('anothertag')),
    true,
  );

  check(
    'a sibling wiki link resolves',
    resolveWikiLink('architecture/server.md', './client.md'),
    'architecture/client.md',
  );
  check('a parent wiki link resolves', resolveWikiLink('architecture/server.md', '../index.md'), 'index.md');
  check('a bare name gets its extension', resolveWikiLink('index.md', 'server'), 'server.md');
  check('an external link is ignored', resolveWikiLink('a.md', 'https://example.com/x.md'), null);
  check('an anchor only is ignored', resolveWikiLink('a.md', '#section'), null);
}

/* ================================================================================================
 * Record mentions
 *
 * A `@kind:id` token points at one of the app's own records. The composer offers them by name
 * so an id is picked, not typed; the send path spells each one out so the model — which cannot
 * see the store — knows what the message means. Both read the same list, so this checks the
 * list, the lookup and the block the model is handed.
 * ============================================================================================== */

console.log('\n— record mentions —');
{
  const target = {
    ...newTarget({ name: 'Lab GPU', kind: 'ssh', host: 'gpu.lab.edu', readiness: 'ready' }),
    gpus: '2× A100',
  };
  const job = {
    ...newJob({ name: 'Train baseline', command: 'python train.py', targetId: target.id }),
    state: 'running' as const,
  };
  const task = { ...newTask([], 'Screen the cohorts'), key: 'TASK-12' };
  const wave = { ...newWave([]), number: 3, name: 'Amplicon' };
  const experiment = {
    id: 'EXP-A1B2',
    objective: 'Does the assay hold?',
    outcome: 'running',
    stage: 'registered',
    designKind: 'Amplicon validation',
  } as unknown as Experiment;
  const database = {
    id: 'openalex',
    name: 'OpenAlex',
    family: 'Literature',
    access: 'open',
    holds: 'Works and citations',
  } as unknown as Database;

  const refs = referencesFrom({
    jobs: [job],
    targets: [target],
    tasks: [task],
    waves: [wave],
    experiments: [experiment],
    databases: [database],
  });

  check('every kind is listed', MENTION_KINDS.length, 6);
  check('a kind is named by its word', mentionKind('job'), 'job');
  check('and is not case-sensitive', mentionKind('Task'), 'task');
  check('a word that names no kind has none', mentionKind('nope'), undefined);

  check(
    'the lists become one reference per record',
    refs.map((reference) => `${reference.kind}:${reference.id}`),
    [
      `job:${job.id}`,
      `target:${target.id}`,
      'experiment:EXP-A1B2',
      'database:openalex',
      `task:${task.id}`,
      `wave:${wave.id}`,
    ],
  );
  check('a job says which machine it ran on', refs[0]?.detail.includes('on Lab GPU'), true);

  check('a record is found by its id', findReference('job', job.id, refs)?.label, 'Train baseline');
  check('and by a name with its spaces lost', findReference('job', 'train-baseline', refs)?.id, job.id);
  check('and by a task key', findReference('task', 'TASK-12', refs)?.id, task.id);
  check('a value naming nothing finds nothing', findReference('job', 'no-such-job', refs), undefined);
  check('a name loses its spaces', slug('Screen the  cohorts!'), 'screen-the-cohorts');

  check(
    'a mention token is parsed, and one of an unknown kind is not',
    parseMentions('compare @job:j-1a2b3c4d with @nope:x and @record:pmid-1'),
    [{ kind: 'job', value: 'j-1a2b3c4d', raw: '@job:j-1a2b3c4d' }],
  );
  check(
    'trailing punctuation is not part of the value',
    parseMentions('see @task:TASK-12.')[0]?.value,
    'TASK-12',
  );

  const block = referenceBlock(`compare with @job:${job.id}`, refs);
  check('the block is a heading and one line per mention', block.split('\n').length, 2);
  checkTruthy('it names the record', block.includes('Train baseline'));
  checkTruthy('it carries the id the tools take', block.includes(job.id));
  checkTruthy('it says what the record is', block.includes('running'));
  checkTruthy(
    'a mention of nothing is reported rather than dropped',
    referenceBlock('@job:no-such-job', refs).includes('no such job'),
  );
  check(
    'a message mentioning nothing is left alone',
    withReferences('no mentions here', refs),
    'no mentions here',
  );
  checkTruthy(
    'and one that mentions a record carries the block',
    withReferences(`look at @target:${target.id}`, refs).includes(`@target:${target.id} = “Lab GPU”`),
  );
}

/* ================================================================================================
 * OpenUI
 *
 * The model draws an interface by writing an OpenUI Lang program in a fenced block. The
 * prompt must teach the fence and the library must parse a program — and refuse one that
 * names a component it does not have, which is what the reader falls back on.
 * ============================================================================================== */

console.log('\n— openui —');
{
  check('the fence is the one the renderer looks for', OPENUI_FENCE, 'openui-lang');

  const prompt = openuiSystemPrompt();
  checkTruthy('the prompt teaches the fence', prompt.includes('```openui-lang'));
  checkTruthy('it steers to prose by default', prompt.includes('research workbench agent'));
  checkTruthy('it asks for a self-contained program', prompt.includes('self-contained program'));

  const parser = createParser(openuiLibrary.toJSONSchema(), openuiLibrary.root);
  check(
    'a program resolves to its root',
    parser.parse('root = Stack([t])\nt = TextContent("Hi")').root?.typeName,
    'Stack',
  );
  check('an unknown component does not resolve', parser.parse('root = NopeComponent([])').root ?? null, null);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: providers resolve, the catalog maps, and the chat text transforms hold');
