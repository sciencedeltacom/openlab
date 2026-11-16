/**
 * What one answer may cost.
 *
 * Output tokens are the expensive half of a bill, and a mode already says how much room the
 * answer needs: a file write can use the full budget, a question cannot. The reasoning effort
 * follows the same idea — a question that changes nothing does not need a long internal
 * debate — while `agent` keeps whatever the reader chose.
 */

import type { AgentMode, ReasoningEffort } from '@/store/types';

/** The full budget, for a mode that writes files. */
export const MAX_OUTPUT_TOKENS = 16_384;

/** Output budget per mode. */
export function outputBudget(mode: AgentMode): number {
  if (mode === 'ask') return 2_048;
  if (mode === 'plan') return 4_096;
  return MAX_OUTPUT_TOKENS;
}

/** Thinking effort for a mode: the reader's choice in `agent`, a lighter one elsewhere. */
export function effortFor(mode: AgentMode, effort: ReasoningEffort): ReasoningEffort {
  if (mode === 'agent') return effort;
  return effort === 'high' ? 'medium' : effort;
}
