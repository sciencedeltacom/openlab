/**
 * The session's own controls, as a block under the agents.
 *
 * Context, stats and settings are three answers to "what is this session doing", so they sit
 * together on the right, below the agent that leads it — the same island shape as the block
 * above, because they are the same kind of thing: the session's own furniture rather than
 * part of the work. Two of them open an island over the transcript; context keeps its ring,
 * which is the glance, and opens its numbers on a press.
 *
 * The files panel that used to live here is gone: a session's files are the workspace's, and
 * the workspace's files have a page of their own.
 */

import { Activity, SlidersHorizontal } from 'lucide-react';

import { Button, ProgressRing, Surface, Tip } from '@/components/ui';
import { formatPercent } from '@/lib/format';
import { useApp, useContextUsage } from '@/store/app';

/**
 * The context meter: the ring is the glance, the column beside the transcript is the detail.
 *
 * It toggles the same panel as the other two, because all three answer the same question —
 * what is this session doing — and a dialog would be a second kind of surface for it.
 */
function ContextButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { state } = useApp();
  const usage = useContextUsage(state);
  const tone = usage.ratio > 0.85 ? 'danger' : usage.ratio > 0.6 ? 'warning' : 'accent';
  const percent = formatPercent(usage.ratio * 100, 1);

  return (
    <Button
      variant={open ? 'primary' : 'ghost'}
      size="sm"
      className="flex-1 justify-start gap-2"
      aria-label="Context usage"
      onPress={onToggle}
    >
      <ProgressRing value={usage.ratio} tone={tone} label={percent} />
      <span className="text-meta text-muted">Context</span>
    </Button>
  );
}

/** Context, stats and settings for the open session. */
export function SessionTools() {
  const { state, dispatch } = useApp();

  /** A panel opens beside the transcript, or closes when it is already the one showing. */
  const toggle = (island: 'context' | 'stats' | 'settings') =>
    dispatch({ type: 'session/island', island: state.sessionIsland === island ? null : island });

  return (
    <Surface className="shrink-0 rounded-3xl p-1.5">
      <div className="flex items-center gap-0.5">
        <ContextButton open={state.sessionIsland === 'context'} onToggle={() => toggle('context')} />

        <Tip content="Session stats">
          <Button
            variant={state.sessionIsland === 'stats' ? 'primary' : 'ghost'}
            size="sm"
            aria-label="Session stats"
            onPress={() => toggle('stats')}
          >
            <Activity className="size-4" />
          </Button>
        </Tip>

        <Tip content="Session settings">
          <Button
            variant={state.sessionIsland === 'settings' ? 'primary' : 'ghost'}
            size="sm"
            aria-label="Session settings"
            onPress={() => toggle('settings')}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </Tip>
      </div>
    </Surface>
  );
}
