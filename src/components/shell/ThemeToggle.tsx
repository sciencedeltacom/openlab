/**
 * The appearance toggle.
 *
 * One button, both directions: at the end of the tab strip, and beside the account at the
 * foot of the column. A button rather than a switch because it is a thing you press — the
 * icon is what you would get, and the tooltip says which.
 */

import { Moon, Sun } from 'lucide-react';

import { IconButton, Tip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';

/**
 * Light or dark.
 *
 * `fill` makes the button the size of the tile it sits in, so the hover matches the card
 * beside it rather than drawing a smaller circle inside it.
 */
export function ThemeToggle({ fill }: { fill?: boolean } = {}) {
  const { state, dispatch } = useApp();
  const dark = state.theme === 'dark';

  return (
    <Tip content={dark ? 'Light appearance' : 'Dark appearance'}>
      <IconButton
        aria-label="Toggle theme"
        className={cn(fill && 'size-full rounded-2xl')}
        onPress={() => dispatch({ type: 'theme/toggled' })}
      >
        {dark ? <Sun /> : <Moon />}
      </IconButton>
    </Tip>
  );
}
