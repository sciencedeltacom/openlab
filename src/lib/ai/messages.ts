/**
 * Lowering the agent transcript to AI SDK messages.
 *
 * The transcript (`lib/agent/transcript`) is the app's own shape: a user turn, an assistant
 * turn that may carry tool calls, and one tool result per call. The AI SDK wants the same
 * information as its `ModelMessage` union. This module is the only place the two meet, so the
 * rest of the app keeps its provider-neutral transcript and the SDK keeps its own types.
 */

import type { ModelMessage, ToolResultPart } from 'ai';

import type { TranscriptEntry } from '@/lib/agent/transcript';

/** Parse a call's raw argument string, defaulting to an empty object. */
function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // A truncated payload is reported to the model by the registry, not here.
    return {};
  }
}

/** One tool result, as an error when the call failed so the model can adapt. */
function toolResultPart(entry: Extract<TranscriptEntry, { role: 'tool' }>): ToolResultPart {
  const { result } = entry;
  return {
    type: 'tool-result',
    toolCallId: result.toolCallId,
    toolName: result.name,
    output: result.isError
      ? { type: 'error-text', value: result.content }
      : { type: 'text', value: result.content },
  };
}

/** Lower a whole transcript to the SDK's message list. */
export function toModelMessages(transcript: readonly TranscriptEntry[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const entry of transcript) {
    if (entry.role === 'user') {
      messages.push({ role: 'user', content: entry.content });
      continue;
    }
    if (entry.role === 'assistant') {
      const content: Extract<ModelMessage, { role: 'assistant' }>['content'] = [];
      if (entry.content.length > 0) {
        content.push({ type: 'text', text: entry.content });
      }
      for (const call of entry.toolCalls) {
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: parseArgs(call.arguments),
        });
      }
      // A turn that carried nothing is dropped rather than sent as an empty message.
      if (content.length > 0) {
        messages.push({ role: 'assistant', content });
      }
      continue;
    }
    messages.push({ role: 'tool', content: [toolResultPart(entry)] });
  }
  return messages;
}
