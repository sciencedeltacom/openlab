/**
 * The settings that are rules, not preferences.
 *
 * The settings pages hold two kinds of thing. Most are standing choices sent to the model as
 * prose — how thorough to be, what to record. A few are limits the runtime must hold whatever
 * the model asks for: how many steps a turn may take, how long it may run, how many read tools
 * run at once, how many times a failed read is retried, and which tools are allowed at all.
 *
 * Those live here, read once per turn, so the interface cannot promise a boundary the engine
 * does not keep. A key that is missing falls back to the shipped default, so an older stored
 * settings blob keeps working.
 */

import { preferenceKey, preferenceValue, type Preferences } from '@/lib/settings';

/** The rules one turn runs under. */
export interface AgentPolicy {
  /** Model steps in one lead turn. */
  maxSteps: number;
  /** Wall-clock limit for one turn, in minutes. */
  turnMinutes: number;
  /** How many read-only tools may run at the same time. */
  parallelReads: number;
  /** Extra attempts for a read-only tool that failed. Writes are never retried. */
  retries: number;
  /** When true, only `allowed` may be called. */
  restricted: boolean;
  allowed: readonly string[];
  denied: readonly string[];
}

/** The shipped limits, matching the defaults the settings pages show. */
export const DEFAULT_POLICY: AgentPolicy = {
  maxSteps: 40,
  turnMinutes: 30,
  parallelReads: 4,
  retries: 2,
  restricted: false,
  allowed: [],
  denied: [],
};

/** One string list from a stored tags control. */
function stringList(preferences: Preferences, section: string, label: string): string[] {
  const stored = preferences[preferenceKey(section, label)]?.value;
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
}

/** The rules the reader set, with the shipped defaults behind every one of them. */
export function agentPolicy(preferences: Preferences): AgentPolicy {
  return {
    maxSteps: Math.max(
      1,
      Math.round(
        preferenceValue(preferences, preferenceKey('effort', 'Tool calls per turn'), DEFAULT_POLICY.maxSteps),
      ),
    ),
    turnMinutes: Math.max(
      1,
      Math.round(
        preferenceValue(
          preferences,
          preferenceKey('effort', 'Wall-clock per turn'),
          DEFAULT_POLICY.turnMinutes,
        ),
      ),
    ),
    parallelReads: Math.max(
      1,
      Math.round(
        preferenceValue(
          preferences,
          preferenceKey('effort', 'Parallel read tools'),
          DEFAULT_POLICY.parallelReads,
        ),
      ),
    ),
    retries: Math.max(
      0,
      Math.round(
        preferenceValue(preferences, preferenceKey('stops', 'Retries per tool call'), DEFAULT_POLICY.retries),
      ),
    ),
    restricted: preferenceValue(
      preferences,
      preferenceKey('tools', 'Restrict to the allowlist'),
      DEFAULT_POLICY.restricted,
    ),
    allowed: stringList(preferences, 'tools', 'Allowed tools'),
    denied: stringList(preferences, 'tools', 'Always denied'),
  };
}

/**
 * Apply the allowlist to a tool surface.
 *
 * This is the hard boundary the settings page describes: with the allowlist on, a tool that is
 * not named cannot be called, whatever the model asks for. Denied tools are dropped either way.
 * An empty allowlist with the switch on means "nothing", which is what the words say.
 */
export function applyToolPolicy(toolIds: readonly string[], policy: AgentPolicy): string[] {
  const denied = new Set(policy.denied);
  const allowed = new Set(policy.allowed);
  return toolIds.filter((id) => {
    if (denied.has(id)) return false;
    if (policy.restricted && !allowed.has(id)) return false;
    return true;
  });
}
