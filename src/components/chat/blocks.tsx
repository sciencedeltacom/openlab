/**
 * The non-prose parts of a turn: reasoning, tool calls, file changes and the run footer.
 *
 * These are the pieces that make a turn auditable — what the model thought, what it ran,
 * what changed — so they are built as the shapes a reader actually needs, not as decoration.
 *
 * A tool call is a collapsible card: the header carries what a reader scans (which tool, on
 * what, how it ended, how long), and the body carries what only a suspicious reader wants
 * (the exact output). Collapsed by default is the point — a transcript with twenty calls
 * should read as twenty lines, not twenty screens.
 *
 * Reasoning is the same shape with a different voice: muted, ruled, and closed unless asked
 * for. It is never the only thing shown, and it is never the answer.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BadgeDollarSign, Brain, ChevronRight, CircleDashed, GitCompareArrows, Split } from 'lucide-react';

import { Disclosure } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { MOTION } from '@/theme/tokens';
import type { Block } from '@/store/types';
import { toolHasDetail, toolPresentation } from './tools';

/**
 * Reasoning, as a chain of thought: one icon-led line that opens into the trace.
 *
 * While the model is still thinking the mark spins; once it settles the brain returns and
 * the line says how long it took. Closed by default — the answer is the page, the trace is
 * the audit — but the icon and the duration make it worth opening.
 */
export function ThinkingTrace({ text, startedAt, endedAt }: Extract<Block, { kind: 'thinking' }>) {
  const [open, setOpen] = useState(false);
  const running = endedAt === null;
  const [now, setNow] = useState(() => Date.now());

  // A live clock while the model works, then it settles on one number.
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [running]);

  const seconds = ((endedAt ?? now) - startedAt) / 1000;

  return (
    <Disclosure isExpanded={open} onExpandedChange={setOpen} className="my-2">
      <Disclosure.Heading>
        <Disclosure.Trigger className="group flex w-full items-center gap-2 text-start">
          <motion.span
            className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-secondary text-muted"
            animate={running ? { scale: [1, 1.12, 1], opacity: [0.75, 1, 0.75] } : { scale: 1, opacity: 1 }}
            transition={
              running
                ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
                : { duration: MOTION.duration.panel, ease: MOTION.signature }
            }
          >
            {running ? (
              <CircleDashed className="size-3 animate-spin" aria-hidden />
            ) : (
              <Brain className="size-3" aria-hidden />
            )}
          </motion.span>

          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={running ? 'running' : 'done'}
              initial={{ opacity: 0, y: 3, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -3, filter: 'blur(4px)' }}
              transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
              className="text-body text-muted"
            >
              {running ? 'Thinking' : 'Thought for'}{' '}
              <span className="tabular-nums">{seconds.toFixed(1)}s</span>
            </motion.span>
          </AnimatePresence>

          <ChevronRight
            className={cn('size-3 shrink-0 text-muted transition-transform', open && 'rotate-90')}
            aria-hidden
          />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body>
          <div className="mt-1.5 ms-1 border-s-2 border-muted/35 ps-3">
            <p className="text-body leading-[1.65] whitespace-pre-wrap text-muted">{text}</p>
          </div>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

/**
 * One tool invocation, on the same quiet line as the reasoning trace.
 *
 * The glyph is the tool's own and its colour is how the call ended, so the row says which
 * tool, on what, and how long, without a word of chrome. The body is the tool's own shape —
 * a file, a terminal, a listing — closed until asked for.
 */
export function ToolRow({
  name,
  description,
  status,
  startedAt,
  endedAt,
  output,
  input,
}: Extract<Block, { kind: 'tool' }>) {
  const [open, setOpen] = useState(false);
  const presentation = toolPresentation(name);
  const Icon = status === 'ok' ? presentation.doneIcon : presentation.icon;
  const hasBody = toolHasDetail(name, input, output);
  const duration = endedAt === null ? null : endedAt - startedAt;

  const tone = status === 'error' ? 'text-danger' : status === 'running' ? 'text-accent' : 'text-muted';
  const chip =
    status === 'error' ? 'bg-danger/10' : status === 'running' ? 'bg-accent/10' : 'bg-surface-secondary';

  const header = (
    <>
      <span
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full',
          chip,
          tone,
          status === 'running' && 'animate-pulse',
        )}
      >
        <Icon className="size-3" aria-hidden />
      </span>
      <span className="shrink-0 text-body text-foreground">{presentation.name}</span>
      <span className="min-w-0 flex-1 truncate text-start text-meta text-muted">{description}</span>
      {duration !== null && (
        <span className="shrink-0 text-meta tabular-nums text-muted">{formatDuration(duration)}</span>
      )}
    </>
  );

  if (!hasBody) {
    return <div className="my-1.5 flex items-center gap-2">{header}</div>;
  }

  return (
    <Disclosure isExpanded={open} onExpandedChange={setOpen} className="my-1.5">
      <Disclosure.Heading>
        <Disclosure.Trigger className="group flex w-full items-center gap-2 text-start">
          {header}
          <ChevronRight
            className={cn('size-3 shrink-0 text-muted transition-transform', open && 'rotate-90')}
            aria-hidden
          />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body>
          <div className="mt-1.5 ms-1 border-s-2 border-muted/35 ps-3">
            <presentation.Content input={input} output={output} />
          </div>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

/**
 * A recommendation to continue in a separate session.
 *
 * The call is the model's; the decision is the reader's. So it is drawn as a card where the
 * call was made rather than as another one-line tool row: the title it would be called, the
 * reason it left this one alone, and — while the gate is open — the fact that the answer is
 * being asked for above the composer.
 */
export function SplitCard({ status, input, output, description }: Extract<Block, { kind: 'tool' }>) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  const headline =
    status === 'running'
      ? 'Splitting this session is recommended'
      : status === 'ok'
        ? 'This work continues in its own session'
        : 'This session was not split';
  const body =
    status === 'running'
      ? reason || 'This turn has nothing to do with what came before it.'
      : status === 'ok'
        ? `“${title || description}”. It is working there now.`
        : (output ?? '').trim() || 'The call did not run.';
  const tone =
    status === 'error'
      ? 'bg-surface-secondary text-muted'
      : status === 'running'
        ? 'bg-warning/10 text-warning'
        : 'bg-accent/10 text-accent';

  return (
    <div className="my-2 rounded-2xl bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={cn('grid size-5 shrink-0 place-items-center rounded-full', tone)}>
          <Split className="size-3" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-body text-foreground">{headline}</span>
        {status === 'running' && <span className="shrink-0 text-meta text-muted">waiting for approval</span>}
      </div>
      <p className="mt-1.5 ms-7 text-meta leading-relaxed text-muted">{body}</p>
      {status !== 'error' && (
        // The reason the reader should care, rather than the reason the model gave: a session
        // that ends where the job ends is cheaper to send and easier to follow.
        <p className="mt-1 flex items-start gap-1.5 ps-7 text-meta text-muted">
          <BadgeDollarSign className="mt-px size-3 shrink-0" aria-hidden />
          <span>Good for context health, and it saves you money.</span>
        </p>
      )}
    </div>
  );
}

/** How much of the working tree this turn moved. */
export function DiffSummary({ filesChanged, added, removed }: Extract<Block, { kind: 'diff' }>) {
  return (
    <div className="my-2 flex items-center gap-2.5 rounded-2xl bg-surface px-3 py-2">
      <GitCompareArrows className="size-3.5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-meta text-foreground/85">
        {filesChanged} file{filesChanged === 1 ? '' : 's'} changed in the workspace
      </span>
      <span className="shrink-0 text-meta tabular-nums text-success">+{added}</span>
      <span className="shrink-0 text-meta tabular-nums text-danger">−{removed}</span>
    </div>
  );
}

/** Footer for a completed turn: how long it took and what it cost in tokens, no vendor. */
export function RunFooter({ durationMs, tokensIn, tokensOut }: Extract<Block, { kind: 'run' }>) {
  const total = (tokensIn ?? 0) + (tokensOut ?? 0);
  return (
    <div className="mt-2 text-meta text-muted">
      Answered in <span className="tabular-nums">{formatDuration(durationMs)}</span>
      {total > 0 && (
        <>
          {' '}
          using <span className="tabular-nums">{total.toLocaleString('en-US')}</span> token
          {total === 1 ? '' : 's'}
        </>
      )}
    </div>
  );
}
