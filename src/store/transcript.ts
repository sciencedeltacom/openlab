/**
 * Rebuilding a provider transcript from the stored messages.
 *
 * The transcript is derived rather than stored a second time: the rendered blocks are already
 * the record of a turn, and a parallel copy would be one more thing to keep in sync. This
 * walks the blocks back into the shape a model expects — an assistant turn that carries its
 * tool calls, followed by one result per call — so the next turn sees the work that already
 * happened instead of starting from the prose alone.
 *
 * A tool call is paired with its result by the provider's call id. When a call predates that
 * id (a scripted preview, or an interrupted turn) a stable synthetic id keeps the pairing.
 */

import type { ToolCall, ToolResult, TranscriptEntry } from '@/lib/agent/transcript';
import type { Block, Message } from './types';

/**
 * How many messages one session keeps in memory.
 *
 * A session is a working record, not an archive: the review and experiment outputs are what is
 * kept for the long term, and a transcript that grows without bound is memory the app never
 * gets back. Older messages fall off the front of the window.
 *
 * ponytail: a window rather than a schema change — the whole state is one blob, so messages are
 * not rows yet; a window is the smallest change that bounds the growth.
 */
export const TRANSCRIPT_WINDOW = 2000;

/** The last {@link TRANSCRIPT_WINDOW} messages, unchanged when the transcript is shorter. */
export function windowMessages(messages: Message[]): Message[] {
  return messages.length > TRANSCRIPT_WINDOW ? messages.slice(-TRANSCRIPT_WINDOW) : messages;
}

/** The tool block half of the {@link Block} union. */
type ToolBlock = Extract<Block, { kind: 'tool' }>;

/** Turn one assistant message's blocks into transcript entries. */
function assistantEntries(blocks: readonly Block[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let pendingText = '';
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index]!;
    if (block.kind === 'text') {
      pendingText = pendingText.length > 0 ? `${pendingText}\n${block.text}` : block.text;
      index += 1;
      continue;
    }
    if (block.kind === 'tool') {
      const calls: ToolCall[] = [];
      const results: ToolResult[] = [];
      while (index < blocks.length && blocks[index]!.kind === 'tool') {
        const tool = blocks[index] as ToolBlock;
        // A worker's calls are drawn for the reader, not replayed to the lead: the handoff
        // result is the lead's view of that work.
        index += 1;
        if (tool.worker) continue;
        const id = tool.callId ?? `call-${index}-${tool.name}`;
        calls.push({ id, name: tool.name, arguments: JSON.stringify(tool.input ?? {}) });
        results.push({
          toolCallId: id,
          name: tool.name,
          content: tool.output ?? '',
          isError: tool.status === 'error',
        });
      }
      // Every call in one assistant turn is answered before the next model step.
      if (calls.length > 0) {
        entries.push({ role: 'assistant', content: pendingText, toolCalls: calls });
        pendingText = '';
        for (const result of results) {
          entries.push({ role: 'tool', result });
        }
      }
      continue;
    }
    index += 1;
  }

  if (pendingText.trim().length > 0) {
    entries.push({ role: 'assistant', content: pendingText, toolCalls: [] });
  }
  return entries;
}

/** Rebuild the transcript a session's messages describe. */
export function blocksToTranscript(messages: readonly Message[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const text = message.blocks
        .filter((block): block is Extract<Block, { kind: 'text' }> => block.kind === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      if (text.length > 0) {
        entries.push({ role: 'user', content: text });
      }
      continue;
    }
    entries.push(...assistantEntries(message.blocks));
  }
  return entries;
}
