/**
 * xterm, in the app's own palette.
 *
 * One place, because two surfaces draw a terminal — a run's transcript and the log on the
 * diagnostics page — and a palette that drifts between them is worse than none. The colours
 * come from the theme variables rather than being written out, so a theme change reaches
 * both.
 */

import { useEffect, useMemo } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import type { ITerminalInitOnlyOptions, ITerminalOptions, ITheme } from '@xterm/xterm';
import { useXTerm } from 'react-xtermjs';

/**
 * The app's palette, as xterm's concrete colours.
 *
 * xterm takes concrete colours — a variable reference is not something it can parse — so each
 * one is resolved by the browser through a throwaway element. That element carries the theme
 * asked for rather than inheriting the document's, which is what makes the palette correct in
 * the same render the theme changes: the document still holds the old one there.
 */
export function terminalTheme(dark: boolean): ITheme {
  const probe = document.createElement('span');
  probe.dataset.theme = dark ? 'openlab-dark' : 'openlab';
  document.body.append(probe);

  /** One variable, as the concrete colour the browser resolved it to. */
  const read = (name: string): string => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };

  const theme: ITheme = {
    background: read('--surface-secondary'),
    foreground: read('--foreground'),
    cursor: read('--accent'),
    selectionBackground: read('--surface-tertiary'),
    blue: read('--accent'),
    green: read('--success'),
    red: read('--danger'),
    yellow: read('--warning'),
    brightBlack: read('--muted'),
  };
  probe.remove();
  return theme;
}

/**
 * xterm's options: the app's palette, a 12px monospace grid, and no input.
 *
 * Every terminal here renders a record and takes no keys: `disableStdin` keeps xterm from
 * drawing a caret where a shell would put one.
 */
export function terminalOptions(
  dark: boolean,
  extra?: Partial<ITerminalOptions>,
): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    disableStdin: true,
    cursorBlink: false,
    cursorStyle: 'bar',
    cursorInactiveStyle: 'none',
    convertEol: true,
    fontSize: 12,
    lineHeight: 1.35,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    scrollback: 10_000,
    theme: terminalTheme(dark),
    ...extra,
  };
}

/** An xterm instance in the app's palette, sized to its box. */
export function useTerminalPane(dark: boolean, extra?: Partial<ITerminalOptions>) {
  const fit = useMemo(() => new FitAddon(), []);
  // Both the options and the addon list are identity-stable: xterm is rebuilt when either
  // changes, and a fresh array per render would rebuild it on every one.
  const addons = useMemo(() => [fit], [fit]);
  const options = useMemo(() => terminalOptions(dark, extra), [dark, extra]);
  const { instance, ref } = useXTerm({ options, addons });

  useEffect(() => {
    const host = ref.current;
    if (!instance || !host) return;
    fit.fit();
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    return () => observer.disconnect();
  }, [instance, ref, fit]);

  return { instance, ref };
}
