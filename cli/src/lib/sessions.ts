/**
 * Reading a session back.
 *
 * A transcript is stored as blocks — prose, reasoning, tool calls, the footer — because that is
 * what the app renders. A terminal wants lines, so this flattens the same blocks without
 * dropping the parts a reader needs to follow: what was asked, what ran, what came back.
 */

import type { Block, Message } from '@/store/types';
import type { Lab } from './lab';
import { windowMessages } from '@/store/transcript';

/** The word the app shows for a phase. */
export function phaseLabel(phase: string | undefined): string {
  if (!phase) return '—';
  return phase.charAt(0) + phase.slice(1).toLowerCase();
}

/** The messages a session holds, newest window applied. */
export function messagesOf(lab: Lab, sessionId: string): Message[] {
  return windowMessages(lab.state.transcripts[sessionId] ?? []);
}

/** The first line of a message, for a list. */
export function preview(message: Message): string {
  const text = message.blocks.find(
    (block): block is Extract<Block, { kind: 'text' }> => block.kind === 'text',
  );
  return text?.text.split('\n')[0]?.slice(0, 80) ?? `(${message.blocks.length} blocks)`;
}

/** One message as lines. */
export function renderMessage(
  message: Message,
  options: { thinking?: boolean; tools?: boolean } = {},
): string[] {
  const lines: string[] = [];
  const speaker = message.role === 'user' ? 'you' : 'openlab';
  lines.push(`${speaker}  ${new Date(message.createdAt).toLocaleString()}`);
  for (const block of message.blocks) {
    switch (block.kind) {
      case 'text':
        lines.push(...block.text.split('\n').map((line) => `  ${line}`));
        break;
      case 'thinking':
        if (options.thinking) {
          lines.push(...block.text.split('\n').map((line) => `  · ${line}`));
        }
        break;
      case 'tool':
        if (options.tools !== false) {
          lines.push(`  ▸ ${block.name} ${block.description} [${block.status}]`);
          if (block.output && options.tools) {
            lines.push(
              ...block.output
                .split('\n')
                .slice(0, 20)
                .map((line) => `      ${line}`),
            );
          }
        }
        break;
      case 'run':
        lines.push(
          `  · ${block.modelRef} · ${block.mode} · ${(block.durationMs / 1000).toFixed(1)}s${block.tokensIn ? ` · ${block.tokensIn} in / ${block.tokensOut ?? 0} out` : ''}`,
        );
        break;
      default:
        break;
    }
  }
  return lines;
}

/** A whole transcript as Markdown, for `session export`. */
export function transcriptMarkdown(lab: Lab, sessionId: string): string {
  const session = lab.state.sessions.find((candidate) => candidate.id === sessionId);
  const lines = [
    `# ${session?.title ?? sessionId}`,
    '',
    `- session: \`${sessionId}\``,
    `- phase: ${phaseLabel(session?.phase)}`,
    `- messages: ${messagesOf(lab, sessionId).length}`,
    '',
  ];
  for (const message of messagesOf(lab, sessionId)) {
    lines.push(message.role === 'user' ? '## You' : '## openlab', '');
    for (const block of message.blocks) {
      if (block.kind === 'text') {
        lines.push(block.text, '');
      } else if (block.kind === 'tool') {
        lines.push(`\`${block.name}\`: ${block.description} _(${block.status})_`, '');
        if (block.output) {
          lines.push('```', block.output, '```', '');
        }
      } else if (block.kind === 'run') {
        lines.push(
          `_${block.modelRef} · ${block.mode} · ${(block.durationMs / 1000).toFixed(1)}s${block.tokensIn ? ` · ${block.tokensIn} in / ${block.tokensOut ?? 0} out` : ''}_`,
          '',
        );
      }
    }
  }
  return lines.join('\n');
}
