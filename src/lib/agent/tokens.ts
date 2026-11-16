/**
 * Token estimates, and the transcript budget.
 *
 * The app has no tokenizer in the bundle: a research workbench ships on a desktop, and a
 * vocabulary file per model is weight for a number that only needs to be close. The estimate
 * (about 3.6 characters per token for English and code) is honest about being one, and every
 * decision it drives — the meter, the window, the elision — is a threshold, not an invoice.
 *
 * The budget is applied to the transcript the model is about to see, not to the stored one:
 * a session keeps its whole record, and only what is sent is compacted. Older entries are
 * elided at the boundary and the oldest are dropped, so the recent work stays verbatim while
 * the context stays finite.
 */

import type { Block, Message } from '@/store/types';
import type { ToolResult, TranscriptEntry } from './transcript';

/** Characters per token, the usual rule of thumb for prose and code. */
export const CHARS_PER_TOKEN = 3.6;

/** Roughly how many tokens a string costs. */
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** What one stored block costs when it is sent back. */
export function blockTokens(block: Block): number {
  switch (block.kind) {
    case 'text':
      return estimateTokens(block.text);
    case 'thinking':
      // A reasoning trace is drawn, never replayed to the model.
      return 0;
    case 'tool':
      return estimateTokens(block.output ?? '') + estimateTokens(JSON.stringify(block.input ?? {}));
    default:
      return 0;
  }
}

/** What one stored message costs, blocks summed. */
export function messageTokens(message: Message): number {
  return message.blocks.reduce((sum, block) => sum + blockTokens(block), 0);
}

/** What one transcript entry costs. */
export function entryTokens(entry: TranscriptEntry): number {
  if (entry.role === 'user') return estimateTokens(entry.content);
  if (entry.role === 'assistant') {
    const calls = entry.toolCalls.reduce(
      (sum, call) => sum + estimateTokens(call.name) + estimateTokens(call.arguments),
      0,
    );
    return estimateTokens(entry.content) + calls;
  }
  return estimateTokens(entry.result.content) + estimateTokens(entry.result.name);
}

/** How much of a context window the transcript may use, leaving room for the rest. */
export function transcriptBudget(contextWindow: number): number {
  // The system prompt, the tool schemas and the next answer all share the window. A little
  // over half for the conversation keeps a 200k model from being asked to write into a full
  // context, and scales with a smaller one.
  return Math.max(8_000, Math.floor(contextWindow * 0.55));
}

/** First line of a tool result, for the elided form. */
function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  return (line ?? '').slice(0, 200);
}

/** The result of a tool call, in the form kept when the budget is tight. */
export function elideToolResult(result: ToolResult): ToolResult {
  const lines = result.content.split('\n').length;
  const kept = firstLine(result.content);
  return {
    ...result,
    content: `[${result.name}: ${kept || 'a result'}; ${lines} line${lines === 1 ? '' : 's'} elided to fit the context; re-read or rerun if needed]`,
  };
}

/** One entry in its smallest useful form. */
function elideEntry(entry: TranscriptEntry): TranscriptEntry {
  if (entry.role === 'tool') {
    return { role: 'tool', result: elideToolResult(entry.result) };
  }
  if (entry.role === 'assistant') {
    // The calls stay: a result without its call is a message the provider refuses.
    const text = entry.content.trim();
    return {
      ...entry,
      content: text.length > 240 ? `${text.slice(0, 240).trimEnd()}…` : text,
    };
  }
  return entry;
}

/**
 * Fit a transcript into a token budget.
 *
 * Walks from the newest entry backwards, so recent work is exact: an entry that fits is kept
 * whole; the first ones past the budget are elided; once even an elided entry does not fit,
 * the rest is dropped. A leading tool result is removed with its call, because a result whose
 * call was dropped is invalid to every provider.
 */
export function fitTranscript(entries: readonly TranscriptEntry[], budget: number): TranscriptEntry[] {
  if (entries.length === 0) return [];
  const kept: TranscriptEntry[] = [];
  let total = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const full = entryTokens(entry);
    if (total + full <= budget) {
      kept.push(entry);
      total += full;
      continue;
    }
    const small = elideEntry(entry);
    const shrunk = entryTokens(small);
    if (total + shrunk > budget) {
      break;
    }
    kept.push(small);
    total += shrunk;
  }

  kept.reverse();
  // The transcript may start at a tool result, whose assistant call was dropped.
  while (kept.length > 0 && kept[0]!.role === 'tool') {
    kept.shift();
  }
  return kept;
}
