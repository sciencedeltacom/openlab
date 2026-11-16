/**
 * Running one turn.
 *
 * A turn is a sequence of model steps: a step returns prose and, optionally, tool calls; the
 * AI SDK executes each call, appends the results, and asks the model again — repeating until a
 * step makes no call or the step budget runs out. `streamText` with `stopWhen(stepCountIs(n))`
 * is that loop, so this module no longer owns it. What it owns is the translation: the events
 * the SDK streams are folded into the app's blocks and callbacks, and the result is reduced to
 * the small outcome the engine reasons about.
 *
 * Delegation is a tool (`task`) whose executor starts a nested turn; it is supplied by the
 * engine as `delegate`, so this module never needs to know how a worker is scoped.
 */

import { stepCountIs, streamText, type LanguageModel, type SystemModelMessage } from 'ai';

import type { PermissionGate } from '@/lib/agent/permissions';
import type { ToolHost } from '@/lib/agent/registry';
import type { DomainHost } from '@/lib/agent/domain';
import type { ToolId } from '@/lib/agent/tools';
import type { ToolCall, ToolResult, TranscriptEntry } from '@/lib/agent/transcript';
import type { GuardSettings } from '@/lib/guard';
import type { Block, ReasoningEffort } from '@/store/types';

import { toModelMessages } from './messages';
import { buildToolSet } from './tools';

/** Why a turn stopped. */
export type LoopStopReason = 'finished' | 'max-steps' | 'aborted' | 'error';

/** Token accounting for a turn, summed over its steps (and its workers). */
export interface TurnUsage {
  input: number;
  output: number;
  cached: number;
}

/** What one turn produced. */
export interface TurnOutcome {
  text: string;
  thinking: string;
  reason: LoopStopReason;
  error?: string;
  usage: TurnUsage;
}

/** Everything a turn needs. */
export interface TurnConfig {
  model: LanguageModel;
  system: string;
  /** Absolute workspace root a relative tool path resolves against. */
  workspace: string;
  toolIds: readonly ToolId[];
  transcript: readonly TranscriptEntry[];
  reasoning: ReasoningEffort;
  /** True when the model descriptor says this model exposes a reasoning control. */
  reasoningSupported: boolean;
  maxSteps: number;
  maxTokens: number;
  /** Extra attempts for a read-only tool that failed. */
  retries?: number;
  /** How many read-only tools may run at the same time. */
  parallelReads?: number;
  /**
   * Ask the provider to cache the fixed prefix (system prompt and tool schemas).
   *
   * Anthropic pays 25% more to write a cache entry and 90% less to read one; a turn that
   * makes several steps reads it many times, so the breakpoint is the single highest-value
   * change for a long tool loop. Other protocols either cache automatically on a stable
   * prefix or have no cache to request, so the flag is off for them.
   */
  cachePrefix?: boolean;
  signal: AbortSignal;
  host: ToolHost;
  domain?: DomainHost;
  /** The session this turn runs in, handed to tools that associate a record with it. */
  sessionId?: string;
  guard: { guarded: boolean; ask: PermissionGate; policy: GuardSettings };
  /** Starts a nested worker turn; the lead has one, a worker does not. */
  delegate?: (call: ToolCall, signal: AbortSignal) => Promise<ToolResult>;
  onBlock: (block: Block) => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  /** A shared sink, so a delegated worker's usage lands on the same turn. */
  usage?: TurnUsage;
}

/** True when an error is the caller's abort rather than a failure. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** A readable message from whatever was thrown or emitted. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The system instruction, with a cache breakpoint when the provider wants one.
 *
 * Anthropic caches the request prefix in the order tools, system, messages, so a breakpoint on
 * the system message covers both the tool schemas and the prompt itself. Providers that cache
 * on their own get the plain string.
 */
export function systemInstruction(system: string, cache: boolean): string | SystemModelMessage {
  return cache
    ? {
        role: 'system',
        content: system,
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      }
    : system;
}

/** Map the app's effort vocabulary onto the SDK's reasoning levels. */
function reasoningFor(effort: ReasoningEffort): 'none' | 'low' | 'medium' | 'high' {
  return effort === 'off' ? 'none' : effort;
}

/**
 * Run one turn to completion.
 *
 * The returned text is the model's running answer; the outcome's reason says why it stopped,
 * which the engine turns into the footer the reader sees.
 */
export async function runTurn(config: TurnConfig): Promise<TurnOutcome> {
  const usage: TurnUsage = config.usage ?? { input: 0, output: 0, cached: 0 };

  const tools = buildToolSet(config.toolIds, {
    workspace: config.workspace,
    signal: config.signal,
    host: config.host,
    domain: config.domain,
    sessionId: config.sessionId,
    guarded: config.guard.guarded,
    ask: config.guard.ask,
    policy: config.guard.policy,
    delegate: config.delegate,
    retries: config.retries ?? 0,
    parallelReads: config.parallelReads ?? 4,
    onToolBlock: (block) => config.onBlock(block),
  });

  let text = '';
  let thinking = '';
  let error: string | undefined;
  let finishReason: string | undefined;

  try {
    const system = systemInstruction(config.system, config.cachePrefix === true);
    const result = streamText({
      model: config.model,
      system,
      messages: toModelMessages(config.transcript),
      tools,
      maxOutputTokens: config.maxTokens,
      stopWhen: stepCountIs(config.maxSteps),
      abortSignal: config.signal,
      ...(config.reasoningSupported ? { reasoning: reasoningFor(config.reasoning) } : {}),
    });

    for await (const part of result.stream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text;
          config.onText?.(text);
          break;
        case 'reasoning-delta':
          thinking += part.text;
          config.onThinking?.(thinking);
          break;
        case 'error':
          error = messageOf(part.error);
          break;
        case 'finish':
          finishReason = part.finishReason;
          break;
        default:
          break;
      }
    }

    // The totals resolve once the stream is drained; a provider that reports none leaves zeros.
    const totals = await result.totalUsage;
    usage.input += totals.inputTokens ?? 0;
    usage.output += totals.outputTokens ?? 0;
    usage.cached += totals.inputTokenDetails?.cacheReadTokens ?? 0;
    finishReason ??= await result.finishReason;
  } catch (thrown) {
    if (isAbort(thrown) || config.signal.aborted) {
      return { text, thinking, reason: 'aborted', usage };
    }
    error = error ?? messageOf(thrown);
  }

  const reason: LoopStopReason = error
    ? 'error'
    : config.signal.aborted
      ? 'aborted'
      : finishReason === 'tool-calls'
        ? 'max-steps'
        : 'finished';

  return { text, thinking, reason, error, usage };
}
