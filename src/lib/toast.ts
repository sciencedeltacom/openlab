/**
 * Notifications.
 *
 * One small API the rest of the app calls without React context or a hook: a mutation,
 * an async failure and a copy can all say what happened from wherever they are. It is a
 * thin wrapper over HeroUI's toast singleton, so the viewport is mounted once and every
 * message shares one look and one stack.
 */

import { Toast } from '@/components/ui';

/** The washes a toast can take. `default` is the quiet one. */
export type ToastTone = 'default' | 'success' | 'warning' | 'danger';

/** What a caller can say about a message beyond its text. */
export interface NotifyOptions {
  /** A second line, for the reason behind the outcome. */
  description?: string;
  /** The wash. `danger` for a failure, `success` for a completed change. */
  tone?: ToastTone;
  /** An undo or a follow-up. Omit when the action cannot be reversed. */
  action?: { label: string; onClick: () => void };
}

/**
 * Say that something happened.
 *
 * The message is written in the past tense and names the thing — "Renamed to *Off-target
 * validation*", not "Success". Callers own the wording because only they know what changed.
 */
export function notify(message: string, options?: NotifyOptions): void {
  Toast.toast(message, {
    description: options?.description,
    variant: options?.tone ?? 'default',
    actionProps: options?.action
      ? { children: options.action.label, onPress: options.action.onClick, size: 'sm', variant: 'secondary' }
      : undefined,
  });
}
