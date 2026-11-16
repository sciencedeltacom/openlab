/**
 * Automatic review of a tool call.
 *
 * The permission gate asks about every write, command and fetch. This puts a local review in
 * front of it: a known-safe call runs, a dangerous one is refused, and only the uncertain
 * middle reaches the prompt. The rules live in Rust (`commands/guard.rs`); this module is the
 * typed client and the stored posture.
 */

import { invokeCommand } from './ipc';

/** What the review decided. */
export type GuardAction = 'allow' | 'review' | 'block';

/** The user's posture, edited in Settings → Permissions. */
export interface GuardSettings {
  enabled: boolean;
  allowNetwork: boolean;
  protectCredentials: boolean;
  blockDestructive: boolean;
  /** Regular expressions that block a command outright. */
  extraBlocked: string[];
  /** Programs the safe lane should also allow. */
  extraAllowed: string[];
}

export const DEFAULT_GUARD: GuardSettings = {
  enabled: true,
  allowNetwork: false,
  protectCredentials: true,
  blockDestructive: true,
  extraBlocked: [],
  extraAllowed: [],
};

/** The answer the Rust review returned. */
export interface GuardVerdict {
  action: GuardAction;
  risk: number;
  policy: string;
  reason: string;
}

/** Keep a stored blob to the current shape. */
export function normalizeGuard(value: unknown): GuardSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_GUARD;
  const stored = value as Partial<GuardSettings>;
  const list = (item: unknown) =>
    Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string') : [];
  return {
    enabled: stored.enabled !== false,
    allowNetwork: stored.allowNetwork === true,
    protectCredentials: stored.protectCredentials !== false,
    blockDestructive: stored.blockDestructive !== false,
    extraBlocked: list(stored.extraBlocked),
    extraAllowed: list(stored.extraAllowed),
  };
}

/**
 * Review one call.
 *
 * `null` means the review is off, and the caller should keep the old gate. A backend failure
 * is a `review`, never an `allow`: if the reviewer cannot answer, the person is asked.
 */
export async function judgeToolCall(
  tool: string,
  args: Record<string, unknown>,
  settings: GuardSettings,
): Promise<GuardVerdict | null> {
  if (!settings.enabled) return null;
  const result = await invokeCommand<GuardVerdict>('guard_judge', {
    request: { tool, arguments: args, policy: settings },
  });
  if (result.ok) return result.value;
  // Outside the desktop shell there is no reviewer to ask. Keep the old gate rather than
  // turning every read into a prompt.
  if (!result.ok && result.error.kind === 'no-runtime') return null;
  return {
    action: 'review',
    risk: 50,
    policy: 'unavailable',
    reason: 'The automatic review could not answer, so this call asks.',
  };
}

/** Only the keys the reviewer reads, so a call cannot grow the payload by accident. */
export function guardPayload(settings: GuardSettings): GuardSettings {
  return normalizeGuard(settings);
}
