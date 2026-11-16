/**
 * Message rendering.
 *
 * User turns are right-aligned in the accent colour; assistant turns are unboxed and full
 * width, because the answer is the page and it wears no face. Blocks are rendered in the
 * order the engine emitted them, which is what makes the transcript honest.
 */

import { memo } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { AgentOrb } from '@/components/agents/AgentOrb';
import { defaultAvatarColor } from '@/components/agents/data';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { MOTION } from '@/theme/tokens';
import type { Message } from '@/store/types';
import { DiffSummary, RunFooter, SplitCard, ThinkingTrace, ToolRow } from './blocks';
import { Markdown } from './Markdown';

const ENTER = { duration: MOTION.duration.entrance, ease: MOTION.signature };

/**
 * Who wrote an assistant turn.
 *
 * A turn is the agent's answer, so the transcript names the agent above it — the lead's name,
 * or the worker's in its own subsession — with the agent's own orb, the same mark the bar
 * wears. The orb is identity here, not progress: the turn being written animates, the settled
 * ones hold their frame, so a long transcript is not a wall of loops.
 */
function AgentHeader({
  agent,
  at,
  live,
}: {
  agent: NonNullable<Message['agent']>;
  at: number;
  /** True for the turn being written: only that one animates. */
  live: boolean;
}) {
  return (
    <div className="mb-1 flex items-center gap-2 text-meta text-muted">
      <AgentOrb color={defaultAvatarColor(agent.name)} size={20} paused={!live} />
      <span className="text-label text-foreground">{agent.name}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{relativeTime(at)}</span>
    </div>
  );
}

/** One block, dispatched by kind. */
function BlockView({
  block,
  streaming,
}: {
  block: Message['blocks'][number];
  /** True when this block is the one currently being written. */
  streaming: boolean;
}) {
  switch (block.kind) {
    case 'text':
      return <Markdown isStreaming={streaming}>{block.text}</Markdown>;
    case 'thinking':
      return <ThinkingTrace {...block} />;
    case 'tool':
      // A split is a recommendation the reader answers, so it is drawn as a card rather than
      // as one more call in the row list.
      return block.name === 'split_session' ? <SplitCard {...block} /> : <ToolRow {...block} />;
    case 'diff':
      return <DiffSummary {...block} />;
    case 'run':
      return <RunFooter {...block} />;
    default:
      return null;
  }
}

function UserMessage({ message }: { message: Message }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="flex justify-end"
    >
      <div className="max-w-[min(680px,78%)] rounded-3xl bg-accent px-4 py-3 text-accent-foreground [&_a]:text-accent-foreground [&_a]:underline [&_code]:text-accent-foreground [&_strong]:text-accent-foreground">
        <Markdown className="text-accent-foreground">
          {message.blocks.map((block) => (block.kind === 'text' ? block.text : '')).join('')}
        </Markdown>
      </div>
    </motion.div>
  );
}

function AssistantMessage({ message, streaming }: { message: Message; streaming: boolean }) {
  // Only the last prose block grows during a turn; the earlier ones are already settled.
  const lastText = message.blocks.reduce(
    (found, block, index) => (block.kind === 'text' ? index : found),
    -1,
  );
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="min-w-0"
    >
      {message.agent && <AgentHeader agent={message.agent} at={message.createdAt} live={streaming} />}
      {/* A turn with nothing in it yet shows nothing: the agent's name is the acknowledgement,
          and a loader would be a second answer pretending to be the model. */}
      {message.blocks.map((block, index) => (
        <BlockView key={`${block.kind}-${index}`} block={block} streaming={streaming && index === lastText} />
      ))}
    </motion.article>
  );
}

/**
 * One message, memoised.
 *
 * A streaming turn replaces the transcript array on every token, but only the message being
 * written actually changes; the rest keep their identity, so this skips them.
 */
const MessageRow = memo(function MessageRow({
  message,
  streaming,
}: {
  message: Message;
  streaming: boolean;
}) {
  return (
    <div>
      {message.role === 'user' ? (
        <UserMessage message={message} />
      ) : (
        <AssistantMessage message={message} streaming={streaming} />
      )}
    </div>
  );
});

/**
 * The full transcript.
 *
 * Memoised on purpose: the composer writes the draft into the store on every keystroke, and
 * without this the whole conversation — every markdown body and every code editor — would
 * re-render while the user types. The messages do not change when the draft does.
 */
export const MessageList = memo(function MessageList({
  messages,
  running,
}: {
  messages: Message[];
  running: boolean;
}) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <p className="max-w-[52ch] text-center text-body text-muted">
          Ask about your data, your literature, or the manuscript.
        </p>
      </div>
    );
  }

  const last = messages[messages.length - 1];
  return (
    <div className={cn('flex flex-col gap-6 px-6 py-5', 'mx-auto w-full max-w-[820px]')}>
      <AnimatePresence initial={false}>
        {messages.map((message) => (
          <MessageRow key={message.id} message={message} streaming={running && message.id === last?.id} />
        ))}
      </AnimatePresence>
    </div>
  );
});
