/**
 * The agent transcript, and the pieces a tool call leaves behind.
 *
 * A chat transcript is a list of prose turns; an agent transcript is not. An assistant turn
 * may carry tool calls, each call is answered by a tool result, and the next model call has
 * to see both or it will repeat work it already did. Keeping that shape explicit is what lets
 * a turn survive compaction, resumption and a switch of provider without losing the calls in
 * flight.
 *
 * The types here are provider-neutral. Each protocol adapter lowers them to its own message
 * format; nothing above this file needs to know which one is in use.
 */

/** A call the model asked for, with the arguments exactly as it streamed them. */
export interface ToolCall {
  /** Provider-assigned id, echoed back on the result. */
  id: string;
  /** Tool name from the inventory. */
  name: string;
  /** Raw JSON argument string. Parsed by the executor, not by the transcript. */
  arguments: string;
}

/** What a tool returned for one call. */
export interface ToolResult {
  toolCallId: string;
  name: string;
  /** Text the model reads next. Truncated by the executor, not here. */
  content: string;
  isError: boolean;
}

/** One turn in the transcript. */
export type TranscriptEntry =
  | { role: 'user'; content: string }
  /** Prose plus any calls the model made in the same turn. */
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  /** One tool's answer. Adapters group consecutive results where their API expects it. */
  | { role: 'tool'; result: ToolResult };

/** A model-facing tool declaration. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}
