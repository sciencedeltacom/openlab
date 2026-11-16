/**
 * The agent, from the terminal.
 *
 * This is the app's own run loop: the same system prompt, the same tool inventory and pack
 * gating, the same permission gate and the same delegation to bounded workers. Two things
 * differ, and only two: the model is built directly instead of through the Rust tunnel (there
 * is no webview to route around), and the tool host talks to the filesystem, `git` and the
 * shell from this process instead of over IPC. Everything above those two seams is shared.
 */

import { activeAgent, teammates } from '@/components/agents/store';
import {
  addDomain,
  allDomains,
  allExperiments,
  createExperiment,
  logTrial,
  setOutcome,
} from '@/components/experiments/store';
import type { DomainHost } from '@/lib/agent/domain';
import { resolveWorkbenchSurface, toPackIds } from '@/lib/agent/packs';
import type { PermissionGate } from '@/lib/agent/permissions';
import { DEFAULT_GUARD } from '@/lib/guard';
import type { ToolHost } from '@/lib/agent/registry';
import { createModelEngine } from '@/store/engine';
import { newJob, newTarget } from '@/store/compute';
import { newTask, newWave } from '@/store/research';
import { blocksToTranscript } from '@/store/transcript';
import type { AgentMode, Block, ReasoningEffort } from '@/store/types';

import type { Lab } from './lab';
import { createDirectModel, resolveModel, supportsReasoning } from './models';
import { runCommand, fetchUrl } from './host/exec';
import * as files from './host/fs';
import { globFiles, grepFiles } from './host/search';

/** The filesystem, process and network access a tool call gets. */
export function toolHost(root: string): ToolHost {
  return {
    readFile: async (path) => files.readFile(path, root),
    writeFile: async (path, contents) => files.writeFile(path, contents, root),
    listDir: async (path) =>
      files.listDir(path, root).map((entry) => ({ name: entry.name, path: entry.path, isDir: entry.isDir })),
    glob: async (pattern, path) => globFiles(pattern, root, path).map((match) => match.path),
    grep: async (pattern, options) => {
      const result = grepFiles(pattern, root, { path: options.path, glob: options.glob });
      const lines = result.matches.map((match) => `${match.path}:${match.line}: ${match.text}`);
      if (result.truncated) {
        lines.push(`… more than ${result.matches.length} matches; narrow the pattern`);
      }
      return lines.join('\n');
    },
    runCommand: async (command, cwd) => {
      const result = runCommand(command, { cwd, root });
      return { output: result.output, exitCode: result.exitCode };
    },
    fetchUrl,
  };
}

/** The app's own records — the tracker, the compute ledger, the experiment log. */
export function domainHost(lab: Lab, sessionId: string): DomainHost {
  const state = lab.state;
  const current = () => state.sessions.find((session) => session.id === sessionId);
  return {
    tasks: () => state.tasks,
    waves: () => state.waves,
    targets: () => state.targets,
    jobs: () => state.jobs,
    records: () => state.records,
    experiments: () => allExperiments(),
    domains: () => allDomains(),
    addTask: (task) => {
      state.tasks = [...state.tasks, task];
    },
    patchTask: (id, patch) => {
      state.tasks = state.tasks.map((task) => (task.id === id ? { ...task, ...patch, id } : task));
    },
    addWave: (wave) => {
      state.waves = [...state.waves, wave];
    },
    patchWave: (id, patch) => {
      state.waves = state.waves.map((wave) => (wave.id === id ? { ...wave, ...patch, id } : wave));
    },
    addTarget: (target) => {
      state.targets = [...state.targets, target];
    },
    addJob: (job) => {
      state.jobs = [...state.jobs, job];
    },
    addRecords: (records) => {
      state.records = [...records, ...state.records];
    },
    createExperiment: (input) => createExperiment(input),
    linkExperiment: (sessionId, experimentId) => {
      state.sessions = state.sessions.map((session) =>
        session.id === sessionId ? { ...session, experimentId } : session,
      );
    },
    logTrial: (id, trial) => logTrial(id, trial),
    setOutcome: (id, outcome, summary) => setOutcome(id, outcome, summary),
    // A CLI turn runs in a session too, so the lead may plan it and name it there.
    sessionPlan: () => current()?.plan,
    setSessionPlan: (plan) => {
      state.sessions = state.sessions.map((session) =>
        session.id === sessionId ? { ...session, plan } : session,
      );
    },
    sessionTitle: () => current()?.title,
    setSessionTitle: (title) => {
      state.sessions = state.sessions.map((session) =>
        session.id === sessionId ? { ...session, title } : session,
      );
    },
    createDomain: (domain) => addDomain(domain),
  };
}

/** What one turn needs. */
export interface TurnInput {
  prompt: string;
  mode: AgentMode;
  reasoning: ReasoningEffort;
  /** `provider/model-id`; defaults to the workbench's selection. */
  modelRef?: string;
  /** Whether mutating calls must be confirmed. */
  guarded: boolean;
  /** How a confirmation is asked. */
  ask: PermissionGate;
  /** The session this turn runs in. */
  sessionId: string;
  onBlock: (block: Block) => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  signal: AbortSignal;
}

/** Run one lead turn and return the blocks it produced. */
export async function runTurn(lab: Lab, input: TurnInput): Promise<Block[]> {
  const root = lab.root;
  if (!root) {
    throw new Error('A turn needs a lab folder to work in.');
  }
  const target = resolveModel(lab.state, input.modelRef);
  const modelRef = `${target.provider.id}/${target.modelId}`;
  const engine = createModelEngine({
    provider: target.provider,
    modelId: target.modelId,
    baseUrl: target.baseUrl,
    supportsReasoning: supportsReasoning(target),
    model: createDirectModel(target),
    sessionId: input.sessionId,
  });

  const surface = resolveWorkbenchSurface({
    enabledPacks: lab.state.enabledPacks,
    closedMcps: lab.state.closedMcps,
  });
  const agent = activeAgent();
  const transcript = blocksToTranscript(lab.state.messages);
  transcript.push({ role: 'user', content: input.prompt });

  const blocks: Block[] = [];
  await engine.run({
    prompt: input.prompt,
    workspace: root,
    modelRef,
    mode: input.mode,
    reasoning: input.reasoning,
    transcript,
    surface,
    enabledPacks: toPackIds(lab.state.enabledPacks),
    agent: {
      id: agent.id,
      name: agent.name,
      instructions: agent.instructions,
      teammates: teammates()
        .filter((other) => other.id !== agent.id)
        .map((other) => `${other.name} (${other.id})`),
    },
    // The automatic review runs in the desktop backend. The CLI is a separate process with
    // no Tauri runtime, so it keeps the older gate: ask for what it cannot judge.
    guard: { guarded: input.guarded, ask: input.ask, policy: { ...DEFAULT_GUARD, enabled: false } },
    host: toolHost(root),
    domain: domainHost(lab, input.sessionId),
    sessionTitle: lab.state.sessions.find((session) => session.id === input.sessionId)?.title,
    onBlock: (block) => {
      blocks.push(block);
      input.onBlock(block);
    },
    onText: input.onText ?? (() => undefined),
    onThinking: input.onThinking ?? (() => undefined),
    onDone: () => undefined,
    signal: input.signal,
  });
  return blocks;
}
