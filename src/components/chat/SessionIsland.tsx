/**
 * The session's panels, as a column beside the transcript.
 *
 * Stats, settings and the context detail open the way the agent column does: an island in the
 * row, to the left of it, taking width from the transcript as it arrives and giving it back as
 * it leaves. A panel that floats over the conversation covers the answer it is describing, and
 * one that replaces it hides it; this one sits beside the work, which is where a reader looks
 * when they want to know how the work is going.
 *
 * Each panel leads with its own mark, its name and one line saying what is behind it — a
 * column of bare numbers with no title is the look of a debug view, not of a surface.
 */

import { AnimatePresence, motion } from 'motion/react';
import { Activity, Gauge, SlidersHorizontal, X } from 'lucide-react';

import { IconButton, ScrollShadow, Surface } from '@/components/ui';
import { useApp } from '@/store/app';
import { SessionContext } from './SessionContext';
import { SessionSettings } from './SessionSettings';
import { SessionStats } from './SessionStats';

/** The panel's width, in pixels. The transcript keeps whatever is left. */
const PANEL_WIDTH = 360;

const PANELS = {
  context: {
    title: 'Context',
    hint: 'What this window has left',
    icon: Gauge,
  },
  stats: {
    title: 'Session stats',
    hint: 'What the work has taken',
    icon: Activity,
  },
  settings: {
    title: 'Session settings',
    hint: 'What the agent may reach',
    icon: SlidersHorizontal,
  },
} as const;

/** Whichever session panel is open, or nothing. */
export function SessionIsland() {
  const { state, dispatch } = useApp();
  const island = state.sessionIsland;
  const panel = island ? PANELS[island] : null;
  const Icon = panel?.icon;

  return (
    <AnimatePresence initial={false}>
      {island && panel && (
        <motion.aside
          // One key for the column, not one per panel: switching panels keeps the column open
          // instead of replaying the entrance, which would read as a flicker.
          key="session-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: PANEL_WIDTH, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 40, mass: 0.7 }}
          className="h-full shrink-0 overflow-hidden"
        >
          {/* A fixed width inside the animated one, so the contents never reflow as it opens. */}
          <div className="flex h-full flex-col py-3 ps-1 pe-1" style={{ width: PANEL_WIDTH }}>
            <Surface className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl">
              <header className="flex shrink-0 items-center gap-2.5 px-4 pb-3 pt-4">
                {Icon && (
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label font-medium text-foreground">{panel.title}</span>
                  <span className="block truncate text-meta text-muted">{panel.hint}</span>
                </span>
                <IconButton
                  aria-label={`Close ${panel.title}`}
                  onPress={() => dispatch({ type: 'session/island', island: null })}
                >
                  <X className="size-4" />
                </IconButton>
              </header>

              <ScrollShadow className="min-h-0 flex-1 border-t border-separator">
                <div className="pt-4">
                  {island === 'context' && <SessionContext />}
                  {island === 'stats' && <SessionStats />}
                  {island === 'settings' && <SessionSettings />}
                </div>
              </ScrollShadow>
            </Surface>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
