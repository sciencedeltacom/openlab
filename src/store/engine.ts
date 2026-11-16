/**
 * The run engine.
 *
 * The UI talks to an engine through {@link RunEngine}; it never knows which model answered or
 * how. {@link createEngine} resolves the selected `provider/model-id` to an AI SDK model and
 * hands it to {@link createModelEngine}, which runs one lead turn — the SDK's loop, the app's
 * tools and permission gate, and delegation to bounded workers. {@link createEchoEngine} is
 * the scripted preview for when nothing is connected, so the workbench is never a dead shell
 * and never pretends a script is a model.
 *
 * A worker is a nested turn: the same loop, a narrower system prompt and tool set, and no
 * ability to delegate again. Its usage lands on the same turn, so the footer counts the whole
 * job rather than only the lead.
 */

import type { LanguageModel } from 'ai';

import { effortFor, MAX_OUTPUT_TOKENS, outputBudget } from '@/lib/ai/budget';
import { agentPolicy, applyToolPolicy, type AgentPolicy } from '@/lib/agent/policy';
import { createLanguageModel } from '@/lib/ai/models';
import { runTurn, isAbort, type LoopStopReason, type TurnOutcome, type TurnUsage } from '@/lib/ai/run';
import { PROVIDERS, type Provider } from '@/lib/providers';
import { resolveSubagent, findSubagent } from '@/lib/agent/subagents';
import { ensureSerena } from '@/lib/mcp/serena';
import { toPackIds, type PackId, type PackSurface } from '@/lib/agent/packs';
import type { PermissionGate } from '@/lib/agent/permissions';
import { buildSystemPrompt, type AgentBrief, type SubagentBrief } from '@/lib/agent/prompt';
import {
  DEFAULT_PROMPTS,
  isLoopbackUrl,
  localOnlyEnabled,
  type Preferences,
  type PromptOverrides,
} from '@/lib/settings';
import { parseArguments, type ToolHost } from '@/lib/agent/registry';
import type { GuardSettings } from '@/lib/guard';
import type { DomainHost } from '@/lib/agent/domain';
import type { ToolId } from '@/lib/agent/tools';
import type { ToolCall, ToolResult, TranscriptEntry } from '@/lib/agent/transcript';
import type { AgentMode, Block, ReasoningEffort } from './types';
import { notify } from '@/lib/toast';

/**
 * Output budget for one step.
 *
 * A tool call carries its arguments as output, and a `write_file` carries the whole file —
 * so this has to be large enough that a normal report fits in one call.
 */
const MAX_TOKENS = MAX_OUTPUT_TOKENS;

/** A worker is bounded tighter than the lead it was dispatched from. */
const SUBAGENT_MAX_STEPS = 30;

/** What the engine needs to start a turn. */
export interface RunRequest {
  /** The user's message, for the transcript and for the preview. */
  prompt: string;
  /** Folder the turn runs in, or an empty string for an in-memory project. */
  workspace: string;
  /** `provider/model-id`. */
  modelRef: string;
  mode: AgentMode;
  reasoning: ReasoningEffort;
  /** The conversation so far, including the new prompt, oldest first. */
  transcript: TranscriptEntry[];
  /** The packs the user has opened, resolved to tools, MCP servers and procedures. */
  surface: PackSurface;
  /** The workbench's open packs, so a delegated worker can be granted a subset of them. */
  enabledPacks: readonly PackId[];
  /** Set when this run is a bounded worker rather than the lead. */
  subagent?: SubagentBrief;
  /** The agent the user picked in the agent bar; its instructions lead the turn. */
  agent?: AgentBrief;
  /** The session's current title, so the lead knows whether naming it is still its job. */
  sessionTitle?: string;
  /** Whether to confirm mutating calls, and how to ask. */
  guard: { guarded: boolean; ask: PermissionGate; policy: GuardSettings };
  /** Filesystem, process and network access the tools run against. */
  host: ToolHost;
  /** The app's own records — tracker tasks, targets, the job ledger. */
  domain: DomainHost;
  /** Discrete blocks the engine emits, in order, as they become available. */
  onBlock: (block: Block) => void;
  /** The answer so far. Each call replaces the previous value. */
  onText: (text: string) => void;
  /** Reasoning so far, when the model exposes it. Each call replaces the previous value. */
  onThinking: (text: string) => void;
  /** Called once, when the turn is complete. */
  onDone: () => void;
  /**
   * Open a session for one delegated worker, so a delegation has a transcript of its own
   * instead of only the lead's tool row. Called once per `task` call.
   */
  openSubsession?(start: {
    toolCallId: string;
    worker: SubagentBrief;
    description: string;
  }): WorkerSink | undefined;
  /** Abort signal so the stop button works. */
  signal: AbortSignal;
}

/** Where a delegated worker's own transcript goes. */
export interface WorkerSink {
  onBlock(block: Block): void;
  onText(text: string): void;
  onThinking(text: string): void;
  /** Called when the worker's turn ends, however it ended, with what it spent. */
  onDone(usage: TurnUsage): void;
}

/** Anything that can produce a turn. */
export interface RunEngine {
  readonly id: string;
  /** Human-readable note about what this engine can do. */
  readonly description: string;
  /** True when the engine can actually reach a model. */
  isReady(): boolean;
  run(request: RunRequest): Promise<void>;
}

/** Everything shared across a lead turn and the workers it dispatches. */
interface TurnState {
  model: LanguageModel;
  mode: AgentMode;
  /** The limits the reader set, read once for the whole turn. */
  policy: AgentPolicy;
  /** True when the provider needs an explicit cache breakpoint on the prefix. */
  cacheSystem: boolean;
  workspace: string;
  host: ToolHost;
  domain: DomainHost;
  /** The session this turn runs in, so a tool can associate a record with it. */
  sessionId?: string;
  guard: { guarded: boolean; ask: PermissionGate; policy: GuardSettings };
  /** The reader's preferences and prompt overrides, so a worker follows the same ones. */
  preferences: Preferences;
  prompts: PromptOverrides;
  enabledPacks: readonly PackId[];
  reasoning: ReasoningEffort;
  reasoningSupported: boolean;
  signal: AbortSignal;
  onBlock: (block: Block) => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  /** Where a worker's own session is written, when the host keeps one. */
  openSubsession?: RunRequest['openSubsession'];
  /** Token accounting for the whole turn, workers included. */
  usage: TurnUsage;
}

/**
 * Dispatch one worker.
 *
 * The packs named on the call override the profile's default, but either way they are
 * intersected with the workbench's open packs: a worker can be handed a subset, never a pack
 * the user did not open. Packs that could not be granted are named in the handoff so the lead
 * knows what the worker was missing.
 */
async function dispatch(call: ToolCall, signal: AbortSignal, state: TurnState): Promise<ToolResult> {
  const args = parseArguments(call.arguments);
  const type = typeof args.subagent_type === 'string' ? args.subagent_type : 'explore';
  const prompt = typeof args.prompt === 'string' ? args.prompt : '';
  if (prompt.trim().length === 0) {
    return {
      toolCallId: call.id,
      name: 'task',
      content: '`prompt` is required and must describe the task on its own.',
      isError: true,
    };
  }

  const requested = Array.isArray(args.packs)
    ? toPackIds((args.packs as unknown[]).filter((id): id is string => typeof id === 'string'))
    : undefined;
  // The lead may name the exact tools instead of a pack. A named list is the assignment.
  const requestedTools = Array.isArray(args.tools)
    ? (args.tools as unknown[]).filter((id): id is string => typeof id === 'string')
    : undefined;
  // A worker whose tools come from a server starts it first: the surface is discovered, not
  // written down, and a worker with an empty toolkit would report that as a result.
  const profileForTools = findSubagent(type);
  let serverNote: string | undefined;
  if (profileForTools?.mcp && !requestedTools) {
    const ready = await ensureSerena(state.workspace);
    if (!ready.ok) {
      serverNote = `The ${profileForTools.name} worker needs its server, which did not start: ${ready.error ?? 'unknown error'}.`;
    }
  }
  const resolved = resolveSubagent(type, { enabledPacks: state.enabledPacks }, requested, requestedTools);
  const profile = findSubagent(type);
  const brief: SubagentBrief = profile
    ? { id: profile.id, name: profile.name, summary: profile.summary }
    : { id: type, name: 'Worker', summary: 'A bounded worker with a narrow set of tools.' };

  // The reader watches a delegation as its own session, so the call's own label is the title:
  // `description` when the lead gave one, otherwise the first line of the task.
  const description =
    typeof args.description === 'string' && args.description.trim().length > 0
      ? args.description.trim()
      : (prompt.trim().split('\n')[0] ?? '').slice(0, 80);
  const sink = state.openSubsession?.({ toolCallId: call.id, worker: brief, description });

  const system = buildSystemPrompt({
    mode: 'agent',
    workspace: state.workspace,
    surface: { toolIds: resolved.toolIds, mcpIds: resolved.mcpIds, skillIds: resolved.skillIds },
    subagent: brief,
    preferences: state.preferences,
    prompts: state.prompts,
  });

  const spentBefore = { ...state.usage };
  let outcome: TurnOutcome;
  try {
    outcome = await runTurn({
      model: state.model,
      system,
      workspace: state.workspace,
      toolIds: applyToolPolicy(resolved.toolIds, state.policy),
      transcript: [{ role: 'user', content: prompt }],
      reasoning: state.reasoning,
      reasoningSupported: state.reasoningSupported,
      // A worker is bounded tighter than the lead, and never wider than the reader's own limit.
      maxSteps: Math.max(5, Math.min(SUBAGENT_MAX_STEPS, state.policy.maxSteps)),
      maxTokens: MAX_TOKENS,
      retries: state.policy.retries,
      parallelReads: state.policy.parallelReads,
      cachePrefix: state.cacheSystem,
      signal,
      host: state.host,
      // The plan and the session's name belong to the lead. A worker reads records and reports
      // back; it does not rewrite the steps the reader is watching or rename the session.
      domain: {
        ...state.domain,
        sessionPlan: undefined,
        setSessionPlan: undefined,
        sessionTitle: undefined,
        setSessionTitle: undefined,
      },
      sessionId: state.sessionId,
      guard: state.guard,
      // A worker's tools are drawn in the lead's transcript and in its own session, tagged with
      // the worker so the lead's model never replays them; its prose is streamed only into its
      // own session, which is where a reader goes to read the work.
      onBlock: (block) => {
        state.onBlock(block.kind === 'tool' ? { ...block, worker: brief.id } : block);
        sink?.onBlock(block);
      },
      onText: sink ? (text) => sink.onText(text) : undefined,
      onThinking: sink ? (text) => sink.onThinking(text) : undefined,
      usage: state.usage,
    });
  } finally {
    // However the worker's turn ended — answered, aborted, failed — its session stops running,
    // and its own share of the turn's usage is what its row shows.
    sink?.onDone({
      input: state.usage.input - spentBefore.input,
      output: state.usage.output - spentBefore.output,
      cached: state.usage.cached - spentBefore.cached,
    });
  }

  const notes: string[] = [];
  if (serverNote) {
    notes.push(serverNote);
  }
  if (resolved.missingPacks.length > 0) {
    notes.push(`Packs not open on the workbench, so not granted: ${resolved.missingPacks.join(', ')}.`);
  }
  if (resolved.missingTools.length > 0) {
    notes.push(`Tools not open on the workbench, so not granted: ${resolved.missingTools.join(', ')}.`);
  }
  if (requestedTools && requestedTools.length > 0) {
    notes.push(`Tools granted: ${resolved.toolIds.join(', ')}.`);
  }
  if (outcome.error) {
    notes.push(`The worker stopped with an error: ${outcome.error}`);
  }

  const body = [
    `Worker: ${brief.name} (${type})`,
    `Stopped: ${outcome.reason}`,
    '',
    outcome.text || '(the worker produced no answer)',
    ...(notes.length > 0 ? ['', ...notes] : []),
  ].join('\n');

  return { toolCallId: call.id, name: 'task', content: body, isError: outcome.reason === 'error' };
}

/** Run the lead turn, with delegation wired to {@link dispatch}. */
function leadTurn(
  state: TurnState,
  opts: { system: string; toolIds: readonly ToolId[]; transcript: readonly TranscriptEntry[] },
): Promise<TurnOutcome> {
  return runTurn({
    model: state.model,
    system: opts.system,
    workspace: state.workspace,
    toolIds: opts.toolIds,
    transcript: opts.transcript,
    reasoning: state.reasoning,
    reasoningSupported: state.reasoningSupported,
    maxSteps: state.policy.maxSteps,
    maxTokens: outputBudget(state.mode),
    retries: state.policy.retries,
    parallelReads: state.policy.parallelReads,
    cachePrefix: state.cacheSystem,
    signal: state.signal,
    host: state.host,
    // The lead owns the session: its plan is the panel above the composer, so the domain is
    // handed on whole. Only a dispatched worker runs without it (see `dispatch`).
    domain: state.domain,
    sessionId: state.sessionId,
    guard: state.guard,
    delegate: (call, signal) => dispatch(call, signal, state),
    onBlock: state.onBlock,
    onText: state.onText,
    onThinking: state.onThinking,
    usage: state.usage,
  });
}

/**
 * An engine that refuses, and says why.
 *
 * The echo engine is a preview: it answers with scripted content so the shell is not dead. A
 * refusal must not do that — a policy that blocks a request has to look like a blocked
 * request, not like a model that answered.
 */
export function createRefusalEngine(reason: string): RunEngine {
  return {
    id: 'refused',
    description: reason,
    isReady: () => false,
    async run({ mode, modelRef, onBlock, onDone, signal }) {
      const started = Date.now();
      if (signal.aborted) {
        onDone();
        return;
      }
      onBlock({ kind: 'text', text: `**This turn did not run.** ${reason}` });
      onBlock({ kind: 'run', modelRef, mode, durationMs: Date.now() - started });
      onDone();
    },
  };
}

/**
 * A scripted engine.
 *
 * It exists so the workbench is not a dead shell before a provider is connected, and so the
 * block renderer can be developed against realistic content. It says plainly that it is not
 * a model, and why it is standing in.
 */
export function createEchoEngine(reason = 'No provider is connected.'): RunEngine {
  return {
    id: 'echo',
    description: reason,
    isReady: () => false,

    async run({ prompt, modelRef, mode, onBlock, onText, onDone, signal }: RunRequest) {
      const started = Date.now();
      const wait = (ms: number) =>
        new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            return reject(new DOMException('aborted', 'AbortError'));
          }
          const timer = setTimeout(resolve, ms);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      try {
        onBlock({
          kind: 'thinking',
          text: 'Reading the request, deciding whether it needs the workspace at all…',
          startedAt: Date.now(),
          endedAt: null,
        });
        await wait(600);

        onText(
          [
            `**Scripted preview.** ${reason}`,
            '',
            `You asked, in \`${mode}\` mode:`,
            '',
            `> ${prompt}`,
            '',
            'Open **Models**, add a key for a provider, and this block is replaced by that model’s',
            'output, streamed token by token.',
            '',
            '**What is already real:**',
            '',
            '- The workspace, its git status and the diff counters come from your repository.',
            '- The commit panel stages and commits for real.',
            '- Every statistic in the Analyze panel is computed locally and matches SciPy.',
            '- The agent loop is wired: connect a provider and its tool calls run against your files.',
          ].join('\n'),
        );

        onBlock({ kind: 'run', modelRef, mode, durationMs: Date.now() - started });
      } catch (error) {
        if (!isAbort(error)) {
          const text = error instanceof Error ? error.message : String(error);
          onBlock({ kind: 'text', text: `**Run failed.** ${text}` });
          notify('The run failed', { description: text, tone: 'danger' });
        }
      } finally {
        onDone();
      }
    },
  };
}

/**
 * The real engine.
 *
 * It runs the lead turn against the AI SDK model, streaming text and thinking to the
 * interface and drawing every tool. The system prompt lists only the tools the packs have
 * opened, and the tool set the SDK is given holds only those, so a tool the workbench did not
 * open is one the model never learns about.
 */
export function createModelEngine(input: {
  provider: Provider;
  modelId: string;
  baseUrl: string;
  supportsReasoning: boolean;
  /** Stable per conversation; OpenCode's endpoints use it to route and cache. */
  sessionId?: string;
  /** An injected model, used by tests to run the real turn without a network. */
  model?: LanguageModel;
  /** The reader's stored preferences and prompt overrides. */
  preferences?: Preferences;
  prompts?: PromptOverrides;
}): RunEngine {
  const { provider, modelId, baseUrl, supportsReasoning } = input;
  const preferences = input.preferences ?? {};
  const prompts = input.prompts ?? DEFAULT_PROMPTS;
  const sessionId = input.sessionId ?? crypto.randomUUID();
  const model =
    input.model ??
    createLanguageModel({
      provider,
      modelId,
      baseUrl,
      sessionId,
    });

  return {
    id: `${provider.id}/${modelId}`,
    description: `${provider.label} · ${modelId}`,
    isReady: () => true,

    async run(request: RunRequest) {
      const {
        workspace,
        modelRef,
        mode,
        transcript,
        surface,
        enabledPacks,
        subagent,
        agent,
        sessionTitle,
        guard,
        host,
        domain,
      } = request;
      const { onBlock, onText, onThinking, onDone, signal } = request;
      const started = Date.now();
      const system = buildSystemPrompt({
        mode,
        workspace,
        surface,
        subagent,
        agent,
        sessionTitle,
        preferences,
        prompts,
      });
      const usage: TurnUsage = { input: 0, output: 0, cached: 0 };

      const state: TurnState = {
        model,
        mode,
        policy: agentPolicy(preferences),
        // Anthropic is the protocol with an explicit cache breakpoint; the others either
        // cache a stable prefix on their own or have no cache to ask for.
        cacheSystem: provider.protocol === 'anthropic',
        workspace,
        host,
        domain,
        sessionId,
        guard,
        enabledPacks,
        // A question does not need the thinking budget a long build does.
        reasoning: effortFor(mode, request.reasoning),
        reasoningSupported: supportsReasoning,
        signal,
        onBlock,
        onText,
        onThinking,
        openSubsession: request.openSubsession,
        usage,
        preferences,
        prompts,
      };

      try {
        const outcome = await leadTurn(state, {
          system,
          // The allowlist is applied here, at the last moment, so no caller can widen it.
          toolIds: applyToolPolicy(surface.toolIds, state.policy),
          transcript,
        });

        if (outcome.reason === 'error' && outcome.error) {
          onBlock({ kind: 'text', text: `**Run failed.** ${outcome.error}` });
          notify('The run failed', { description: outcome.error, tone: 'danger' });
        } else if (outcome.reason === 'max-steps') {
          onBlock({
            kind: 'text',
            text: `**Stopped at the ${state.policy.maxSteps}-step limit.** The work is unfinished; ask for it to continue.`,
          });
        }

        onBlock({
          kind: 'run',
          modelRef,
          mode,
          durationMs: Date.now() - started,
          ...(usage.input > 0 || usage.output > 0
            ? { tokensIn: usage.input, tokensOut: usage.output, cachedTokens: usage.cached }
            : {}),
        });
      } catch (error) {
        if (!isAbort(error)) {
          const text = error instanceof Error ? error.message : String(error);
          onBlock({ kind: 'text', text: `**Run failed.** ${text}` });
          notify('The run failed', { description: text, tone: 'danger' });
        }
      } finally {
        onDone();
      }
    },
  };
}

/**
 * The engine the app should use.
 *
 * It reports honestly: a provider with no credential falls back to the preview and says which
 * credential is missing, rather than failing a turn the user thought would work.
 */
export function createEngine(input: {
  modelRef: string;
  baseUrls: Record<string, string>;
  /** Providers with a credential in the OS store. */
  providersWithKeys: Record<string, boolean>;
  /** The providers in play: built-ins plus the user's registry. Defaults to the built-ins. */
  providers?: readonly Provider[];
  /** Stable per conversation. Passed to providers that ask for a session id. */
  sessionId?: string;
  /** The reader's stored preferences and prompt overrides. */
  preferences?: Preferences;
  prompts?: PromptOverrides;
}): RunEngine {
  const providers = input.providers ?? PROVIDERS;
  const slash = input.modelRef.indexOf('/');
  const providerId = slash === -1 ? input.modelRef : input.modelRef.slice(0, slash);
  const modelId = slash === -1 ? '' : input.modelRef.slice(slash + 1);

  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) {
    return createEchoEngine(`No provider is registered for “${providerId}”.`);
  }
  if (!modelId) {
    return createEchoEngine(`No model is selected for ${provider.label}.`);
  }
  if (provider.requiresKey && !input.providersWithKeys[provider.id]) {
    return createEchoEngine(`No credential is stored for ${provider.label}. Add one in Models.`);
  }

  const baseUrl = input.baseUrls[provider.id] ?? provider.defaultBaseUrl ?? '';
  if (!baseUrl) {
    return createEchoEngine(`${provider.label} has no base URL yet. Set one in Models.`);
  }

  // Local-only mode is a policy, not a suggestion to the model: a network endpoint is refused
  // before a request is built.
  if (localOnlyEnabled(input.preferences ?? {}) && provider.protocol !== 'local' && !isLoopbackUrl(baseUrl)) {
    return createRefusalEngine(
      `Local-only mode is on, so ${provider.label} was not called. Turn it off in Settings → Privacy, or choose a provider on this machine.`,
    );
  }

  const model = provider.models.find((candidate) => candidate.id === modelId);

  return createModelEngine({
    provider,
    modelId,
    baseUrl,
    supportsReasoning: model?.supportsReasoning ?? false,
    sessionId: input.sessionId ?? crypto.randomUUID(),
    preferences: input.preferences,
    prompts: input.prompts,
  });
}

export type { LoopStopReason, TurnOutcome };
