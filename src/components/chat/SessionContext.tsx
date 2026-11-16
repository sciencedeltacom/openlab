/**
 * How much of the model's window the session has spent.
 *
 * The ring in the session block is the glance; this is the detail, and it opens in the same
 * column as stats and settings rather than as a dialog over the transcript — the numbers are
 * something to read beside the conversation, not a modal to dismiss.
 *
 * The dial is the whole answer, so it leads. Under it, the same budget as words, then the
 * spend per turn: a shape is what tells a reader whether the window is filling from one long
 * turn or from twenty short ones.
 */

import { formatPercent } from '@/lib/format';
import type { Block } from '@/store/types';
import { useApp, useContextUsage } from '@/store/app';
import { Figure, PanelLine, PanelSection } from './PanelParts';

/** The dial: a ring, and the percentage at its centre. */
function Dial({ ratio, tone }: { ratio: number; tone: 'accent' | 'warning' | 'danger' }) {
  const size = 116;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, ratio));
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--accent)';
  const percent = formatPercent(clamped * 100, clamped * 100 < 10 ? 1 : 0);

  return (
    <div className="relative grid place-items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-secondary)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span className="absolute flex flex-col items-center">
        <span className="text-[1.5rem] leading-none font-semibold tracking-tight tabular-nums text-foreground">
          {percent}
        </span>
        <span className="mt-1 text-meta text-muted">used</span>
      </span>
    </div>
  );
}

/** The tokens each turn spent, oldest to newest, as a row of hairlines. */
function TurnSpend({ blocks }: { blocks: readonly Block[] }) {
  const turns = blocks
    .filter((block): block is Extract<Block, { kind: 'run' }> => block.kind === 'run')
    .map((block) => (block.tokensIn ?? 0) + (block.tokensOut ?? 0))
    .slice(-28);

  if (turns.length === 0) {
    return <p className="text-meta text-muted">No turn has run in this session yet.</p>;
  }

  const peak = Math.max(...turns, 1);
  return (
    <div className="flex h-9 items-end justify-end gap-[3px] border-b border-separator pb-px" aria-hidden>
      {turns.map((tokens, index) => (
        <span
          key={index}
          className="w-2 rounded-[2px] bg-accent"
          style={{
            height: `${Math.max(8, (tokens / peak) * 100)}%`,
            opacity: index === turns.length - 1 ? 1 : 0.45,
          }}
        />
      ))}
    </div>
  );
}

/** The session's context budget. */
export function SessionContext() {
  const { state } = useApp();
  const usage = useContextUsage(state);
  const tone = usage.ratio > 0.85 ? 'danger' : usage.ratio > 0.6 ? 'warning' : 'accent';
  const remaining = Math.max(0, usage.limit - usage.used);
  const blocks = state.messages.flatMap((message) => message.blocks);
  const turnCount = blocks.filter((block) => block.kind === 'run').length;

  return (
    <div className="flex flex-col gap-5 px-4 pb-5">
      <div className="flex flex-col items-center gap-2 pt-1">
        <Dial ratio={usage.ratio} tone={tone} />
        <span className="text-meta tabular-nums text-muted">
          {usage.used.toLocaleString('en-US')} of {usage.limit.toLocaleString('en-US')} tokens
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Figure label="Remaining" value={remaining.toLocaleString('en-US')} hint="before compaction" />
        <Figure label="Turns" value={String(state.messages.length)} hint="in this transcript" />
      </div>

      <PanelSection label="Window">
        <div className="flex flex-col divide-y divide-separator">
          <PanelLine label="Used" value={usage.used.toLocaleString('en-US')} />
          <PanelLine label="Window" value={usage.limit.toLocaleString('en-US')} />
        </div>
      </PanelSection>

      <PanelSection label="Turn spend" aside={turnCount === 1 ? '1 turn' : `${turnCount} turns`}>
        <TurnSpend blocks={blocks} />
      </PanelSection>

      <p className="text-meta text-muted">
        When the window fills, the oldest turns are compacted: the work stays, and a result that was elided
        can be read or rerun again.
      </p>
    </div>
  );
}
