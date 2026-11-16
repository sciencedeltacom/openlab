/**
 * The tool set, as AI SDK tools.
 *
 * The inventory (`lib/agent/tools`), the schemas (`lib/agent/spec`) and the executors
 * (`lib/agent/registry`) already say what a tool is, what it accepts and how it runs. This
 * module is the adapter: it wraps each one as an AI SDK `tool()` so the SDK's loop can call
 * them, and it keeps the app's own rules intact — the permission gate runs before a mutating
 * call, a refusal is a readable error result rather than a thrown one, and every call is
 * reported to the transcript as a running and then settled block.
 *
 * A worker's set has no `task`, so delegation stays the lead's.
 */

import { jsonSchema, tool, type JSONSchema7, type ToolSet } from 'ai';

import { describeToolCall, executeToolCall, type ToolHost } from '@/lib/agent/registry';
import { needsPermission, type PermissionGate } from '@/lib/agent/permissions';
import { judgeToolCall, type GuardSettings } from '@/lib/guard';
import { specFor } from '@/lib/agent/spec';
import { findTool, type AgentToolId, type ToolId } from '@/lib/agent/tools';
import type { DomainHost } from '@/lib/agent/domain';
import type { ToolCall, ToolResult } from '@/lib/agent/transcript';
import type { Block } from '@/store/types';

/** The tool block half of {@link Block}. */
export type ToolBlock = Extract<Block, { kind: 'tool' }>;

/** Everything a tool call needs from the turn it runs in. */
export interface ToolRuntime {
  workspace: string;
  signal: AbortSignal;
  host: ToolHost;
  domain?: DomainHost;
  /** The session this turn runs in, handed to tools that associate a record with it. */
  sessionId?: string;
  /** Whether mutating calls must be confirmed. */
  guarded: boolean;
  /** Extra attempts for a read-only tool that failed. Writes are never retried. */
  retries: number;
  /** How many read-only tools may run at the same time. */
  parallelReads: number;
  ask: PermissionGate;
  /** The automatic review's posture. When it is off, the gate above is the only rule. */
  policy: GuardSettings;
  /** Produce a worker handoff for a `task` call. Absent for a worker, which never delegates. */
  delegate?: (call: ToolCall, signal: AbortSignal) => Promise<ToolResult>;
  /** Report a call as it starts and settles, for the transcript. */
  onToolBlock: (block: ToolBlock) => void;
}

/**
 * Tools whose arguments the review can read. Everything else (tracker records, skills,
 * subagents) keeps the older gate: the reviewer has nothing to say about a task title.
 */
const REVIEWED_TOOLS = new Set([
  'run_command',
  'read_file',
  'read_file_binary',
  'write_file',
  'rename_file',
  'remove_file',
  'list_zip',
  'grep_files',
  'glob_files',
  'fetch_url',
]);

/** The call shape the registry and the transcript speak, built from the SDK's call. */
function asCall(name: string, input: unknown, toolCallId: string): ToolCall {
  return { id: toolCallId, name, arguments: JSON.stringify(input ?? {}) };
}

/** Run one call under the app's rules, and draw it. */
async function invoke(
  id: ToolId,
  name: string,
  input: unknown,
  toolCallId: string,
  runtime: ToolRuntime,
  signal: AbortSignal,
): Promise<string> {
  const call = asCall(name, input, toolCallId);
  const description = describeToolCall(call);
  const startedAt = Date.now();
  const parsed = (input ?? {}) as Record<string, unknown>;
  runtime.onToolBlock({
    kind: 'tool',
    name,
    description,
    status: 'running',
    startedAt,
    endedAt: null,
    callId: toolCallId,
    input: parsed,
  });

  const tool = findTool(id);

  // The local review runs first. `null` means it is off, and the old gate decides alone.
  const verdict = REVIEWED_TOOLS.has(name) ? await judgeToolCall(name, parsed, runtime.policy) : null;

  /**
   * Run the call, retrying only a read-only tool.
   *
   * A read that failed on a transient error (a file being written, a socket that closed) is
   * worth one more attempt; a write is not, because a retried write is a second write.
   */
  const run = async (): Promise<ToolResult> => {
    const attempts = tool?.effects.readOnly ? Math.max(1, runtime.retries + 1) : 1;
    let outcome = await executeToolCall(call, context(runtime, signal));
    for (let attempt = 1; attempt < attempts && outcome.isError && !signal.aborted; attempt += 1) {
      outcome = await executeToolCall(call, context(runtime, signal));
    }
    return outcome;
  };

  let result: ToolResult;
  if (verdict?.action === 'block') {
    result = {
      toolCallId,
      name,
      content: `Blocked by the automatic review (${verdict.policy}): ${verdict.reason}`,
      isError: true,
    };
  } else if (id === 'task' && runtime.delegate) {
    // Delegation is a handoff inside the app, not a machine action; the worker's own calls
    // are reviewed against its own surface.
    result = await runtime.delegate(call, signal);
  } else if (verdict?.action === 'review' && runtime.guarded && tool) {
    const allowed = await runtime.ask({ tool, detail: `${description}: ${verdict.reason}` }, signal);
    result = allowed
      ? await run()
      : { toolCallId, name, content: 'The user declined this call.', isError: true };
  } else if (verdict === null && tool && runtime.guarded && needsPermission(tool)) {
    // The automatic review is off: keep the pre-existing rule exactly as it was.
    const allowed = await runtime.ask({ tool, detail: description }, signal);
    result = allowed
      ? await run()
      : { toolCallId, name, content: 'The user declined this call.', isError: true };
  } else {
    result = await run();
  }

  runtime.onToolBlock({
    kind: 'tool',
    name,
    description,
    status: result.isError ? 'error' : 'ok',
    startedAt,
    endedAt: Date.now(),
    output: result.content,
    callId: toolCallId,
    input: parsed,
  });

  return result.content;
}

/**
 * A queue with a fixed number of slots.
 *
 * The SDK runs every call in a step in parallel. A handful of file reads at once is faster; a
 * hundred is a machine on its knees. Read tools go through this; anything that changes state
 * runs on its own, because serialising writes is the engine's business, not a queue's.
 */
function limiter(slots: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= slots) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/** The context an executor is given. */
function context(runtime: ToolRuntime, signal: AbortSignal) {
  return {
    workspace: runtime.workspace,
    signal,
    host: runtime.host,
    domain: runtime.domain,
    sessionId: runtime.sessionId,
  };
}

/**
 * Build the AI SDK tool set for a turn.
 *
 * Each tool keeps the description and JSON Schema the inventory already carries, so the model
 * sees exactly what it saw before; only the execution wrapper is new.
 */
export function buildToolSet(toolIds: readonly ToolId[], runtime: ToolRuntime): ToolSet {
  const tools: ToolSet = {};
  const readQueue = limiter(Math.max(1, runtime.parallelReads));
  for (const id of toolIds) {
    const spec = specFor(id);
    const readOnly = findTool(id)?.effects.readOnly === true;
    tools[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema(spec.parameters as JSONSchema7),
      // Send the result as plain text, which is what every executor already returns.
      toModelOutput: ({ output }) => ({ type: 'text', value: String(output) }),
      execute: (input, options) => {
        const run = () =>
          invoke(id, spec.name, input, options.toolCallId, runtime, options.abortSignal ?? runtime.signal);
        return readOnly ? readQueue(run) : run();
      },
    });
  }
  return tools;
}
