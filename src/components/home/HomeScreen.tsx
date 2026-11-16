/**
 * The home screen.
 *
 * A stage rather than a dashboard: the background carries the mood, the wordmark carries the
 * identity, and the composer is the only thing to do. The numbers the workbench records still
 * exist — they moved to Home → Insights, one click away — because a home that opens on a wall
 * of charts is a report, not a place to start work.
 *
 * The background is the reader's: `Settings → Appearance → Background` chooses the tint and
 * the glow, and `None` leaves the theme's own surface. The default is Lumenwave in blue at a
 * low opacity, which is the surface the app ships with.
 */

import { BarChart3 } from 'lucide-react';

import { Button } from '@/components/ui';
import { HexMark } from '@/components/brand/Marks';
import { cn } from '@/lib/cn';
import { Composer } from '@/components/chat/Composer';
import { useApp } from '@/store/app';
import { paths } from '@/app/routes';
import { preferenceKey, preferenceValue } from '@/lib/settings';
import { LumenWave } from './LumenWave';

/** The tint palettes. Blue is the shipped one; the others are a shift, not a theme. */
const TINTS: Record<string, { surface: string; base: string; accent: string; highlight: string }> = {
  blue: { surface: '#123a8f', base: '#123a8f', accent: '#5b93ff', highlight: '#e2ecff' },
  ice: { surface: '#0e3a4d', base: '#0e3a4d', accent: '#63cdf1', highlight: '#e4f9ff' },
  violet: { surface: '#2a1d63', base: '#2a1d63', accent: '#9a7dff', highlight: '#ece5ff' },
};

export function HomeScreen() {
  const { state, dispatch } = useApp();

  const preferences = state.preferences;
  const background = preferenceValue<string>(
    preferences,
    preferenceKey('background', 'Home background'),
    'lumenwave',
  );
  const tintId = preferenceValue<string>(preferences, preferenceKey('background', 'Tint'), 'blue');
  const glow = preferenceValue<number>(preferences, preferenceKey('background', 'Glow'), 55);
  const tint = TINTS[tintId] ?? TINTS.blue!;

  const go = (route: string) => dispatch({ type: 'route/go', route });
  const staged = background !== 'none';

  return (
    <div className="relative h-full overflow-hidden">
      {staged && (
        <div className="absolute inset-0" aria-hidden>
          {/* A flat blue stage, not the theme's black. The wave is drawn over it, and the
              left edge falls into shadow so the eye lands on the wordmark and the composer. */}
          <div className="absolute inset-0" style={{ backgroundColor: tint.surface }} />
          <div className="absolute inset-0">
            <LumenWave
              baseColor={tint.base}
              accentColor={tint.accent}
              highlight={tint.highlight}
              glow={Math.max(0, Math.min(100, Number(glow) || 0)) / 100}
            />
          </div>
          {/* The seam is the shell's own colour, carried into the stage and faded out: a black
              shadow in the dark theme, the paper of the sidebar in the light one. */}
          <div
            className="absolute inset-y-0 left-0 w-[42%]"
            style={{
              backgroundImage:
                'linear-gradient(90deg, var(--background) 0%, color-mix(in oklch, var(--background) 90%, transparent) 16%, color-mix(in oklch, var(--background) 55%, transparent) 38%, color-mix(in oklch, var(--background) 22%, transparent) 62%, color-mix(in oklch, var(--background) 6%, transparent) 82%, transparent 100%)',
            }}
          />
        </div>
      )}

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex shrink-0 justify-end p-3">
          <Button
            size="sm"
            variant="ghost"
            className={cn('gap-1.5', staged ? 'text-white/70 hover:text-white' : 'text-muted')}
            onPress={() => go('home/insights')}
          >
            <BarChart3 className="size-3.5" aria-hidden />
            Insights
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-20">
          <h1 className="flex items-center gap-[0.14em] font-baskerville text-[clamp(3.4rem,8vw,7rem)] leading-none tracking-[-0.03em] text-white">
            <HexMark className="h-[0.78em] w-[0.78em]" />
            OpenLab
          </h1>

          <div className="mt-14 w-full max-w-[808px]">
            <Composer
              placeholder="Ask anything. @ files, $ skills, / commands"
              onStarted={(sessionId) => dispatch({ type: 'route/go', route: paths.session(sessionId) })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
