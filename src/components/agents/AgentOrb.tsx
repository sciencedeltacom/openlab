/**
 * An agent's avatar: a `thinking-orbs` orb, tinted with the agent's colour.
 *
 * The animation, geometry and theme handling come from the `thinking-orbs` package; this only
 * maps an agent to it — a size preset (64 for a header, 32 for a row, 20 inline with text), the
 * agent's colour as the ink tint, and a state that settles when the agent is idle and works when
 * it is the active one.
 */

import { ThinkingOrb, type OrbState, type OrbSize } from 'thinking-orbs';

/** True when the reader asked for less motion; the orb then holds its frame. */
function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** The package's three tuned presets, nearest to the size asked for. */
function presetFor(size: number): OrbSize {
  if (size >= 48) {
    return 64;
  }
  return size <= 22 ? 20 : 32;
}

export function AgentOrb({
  color,
  size = 32,
  active = false,
  state,
  paused,
}: {
  color?: string;
  /** Rendered size in CSS px; snapped to the package's tuned presets. */
  size?: number;
  /** The active agent works; the others breathe. */
  active?: boolean;
  /** Override the state, e.g. `solving` while a turn runs. */
  state?: OrbState;
  /**
   * Hold the current frame. A transcript can be long, and a mark that only carries identity
   * does not need a loop each: the turn being written animates, the settled ones hold.
   */
  paused?: boolean;
}) {
  return (
    <ThinkingOrb
      state={state ?? (active ? 'working' : 'breathing')}
      size={presetFor(size)}
      theme="auto"
      color={color}
      paused={paused ?? reducedMotion()}
      aria-hidden
    />
  );
}
