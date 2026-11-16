/**
 * The permission gate.
 *
 * The workbench's default posture is to ask before the agent changes the workspace or reaches
 * the network, and the gate is the one place that decision is made. It is a function rather
 * than a boolean so the harness stays testable: the real app passes a gate that opens a
 * prompt, a test passes one that answers immediately.
 *
 * A tool that only reads never reaches the gate. That is deliberate — confirming every file
 * read trains a user to approve without looking, which is worse than not asking.
 */

import type { AgentTool } from './tools';

/** One confirmation request, carrying everything a prompt needs to show. */
export interface PermissionRequest {
  tool: AgentTool;
  /** One line describing this specific call, e.g. `run_command npm test`. */
  detail: string;
}

/** Decide whether one call may run. Resolves `false` on refusal or abort. */
export type PermissionGate = (request: PermissionRequest, signal: AbortSignal) => Promise<boolean>;

/** True when a call must be confirmed: anything that writes, executes, reaches the network,
 * or settles a decision that is the reader's rather than the model's. */
export function needsPermission(tool: AgentTool): boolean {
  return tool.confirm === true || tool.effects.writes || tool.effects.executes || tool.effects.network;
}
