/**
 * A turn, rendered for a terminal.
 *
 * The engine is the app's; this is what a terminal does with what it emits. Prose streams,
 * a tool call prints as one line that settles, reasoning prints dimmed, and the footer is the
 * same one the app shows. The confirmation the app draws as a dialog is a prompt on stdin,
 * with `a` for "the rest of this turn" — the same gate, a different surface.
 */

import type { PermissionGate, PermissionRequest } from '@/lib/agent/permissions';
import { windowMessages } from '@/store/transcript';
import type { AgentMode, Block, Message, ReasoningEffort, Session } from '@/store/types';

import { runTurn } from './agent';
import type { Lab } from './lab';
import * as out from './output';
import { cancelled, interactive as tty, prompts, spinner, type Ora } from './ui';

/** How a turn should run. */
export interface ChatOptions {
  prompt: string;
  mode: AgentMode;
  reasoning: ReasoningEffort;
  modelRef?: string;
  /** Approve every mutating call without asking. */
  yes?: boolean;
  /** The session to append to; a new one is created when absent. */
  sessionId?: string;
  /** Whether to write the turn back to the store. */
  persist?: boolean;
  /** Show a spinner while the model is thinking. Only when a terminal is attached. */
  spinner?: boolean;
}

/** What a turn did. */
export interface ChatResult {
  sessionId: string;
  blocks: Block[];
  /** True when the model never ran (an error was reported instead). */
  failed: boolean;
}

/** A new session for a workspace, titled from the first prompt. */
export function startSession(lab: Lab, title: string): string {
  const project = lab.project;
  if (!project) {
    throw new Error('A session belongs to a lab folder.');
  }
  // The shape the reducer's `session/create` uses: a fresh line of enquiry in the tracker's
  // first phase, so the app's session list reads the same for a CLI turn.
  const session: Session = {
    id: `s-${crypto.randomUUID().slice(0, 8)}`,
    projectId: project.id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phase: 'ANALYSIS',
  };
  lab.state.sessions = [...lab.state.sessions, session];
  lab.state.activeSessionId = session.id;
  lab.state.transcripts = { ...lab.state.transcripts, [session.id]: [] };
  lab.state.messages = [];
  return session.id;
}

/** The active session, or a fresh one. */
function sessionFor(lab: Lab, options: ChatOptions): string {
  const wanted = options.sessionId ?? lab.state.activeSessionId;
  if (wanted && lab.state.sessions.some((session) => session.id === wanted)) {
    if (lab.state.activeSessionId !== wanted) {
      lab.state.activeSessionId = wanted;
      lab.state.messages = lab.state.transcripts[wanted] ?? [];
    }
    return wanted;
  }
  const title = options.prompt.trim().split('\n')[0]?.slice(0, 60) || 'Untitled session';
  return startSession(lab, title);
}

/** Append a message to a session, keeping the flat mirror and the map in step. */
function appendMessage(lab: Lab, sessionId: string, message: Message): void {
  const current = lab.state.transcripts[sessionId] ?? [];
  const next = windowMessages([...current, message]);
  lab.state.transcripts = { ...lab.state.transcripts, [sessionId]: next };
  if (lab.state.activeSessionId === sessionId) {
    lab.state.messages = next;
  }
  lab.state.sessions = lab.state.sessions.map((session) =>
    session.id === sessionId ? { ...session, updatedAt: Date.now() } : session,
  );
}

/** The gate: a question on stdin, or a blanket yes. */
export function permissionGate(options: { yes?: boolean; interactive: boolean }): PermissionGate {
  let approvedForTurn = Boolean(options.yes);
  const asked = new Set<string>();
  return async (request: PermissionRequest, signal: AbortSignal): Promise<boolean> => {
    if (approvedForTurn) {
      return true;
    }
    if (!options.interactive || signal.aborted) {
      return false;
    }
    const key = request.tool.id;
    if (asked.has(key)) {
      return true;
    }
    // The same gate, drawn as a choice rather than a line to parse. Escape is a refusal:
    // a prompt that cannot be answered must not become an approval.
    const answer = await prompts.select({
      message: `${out.c.bold(request.tool.name)} ${out.c.grey(request.detail)}`,
      options: [
        { value: 'yes', label: 'Allow this call' },
        { value: 'all', label: 'Allow this tool for the rest of the turn' },
        { value: 'no', label: 'Refuse' },
      ],
    });
    if (cancelled(answer)) {
      return false;
    }
    if (answer === 'all') {
      approvedForTurn = true;
      return true;
    }
    if (answer === 'yes') {
      asked.add(key);
      return true;
    }
    return false;
  };
}

/** Run one turn and draw it. */
export async function chatTurn(
  lab: Lab,
  options: ChatOptions & { interactive?: boolean; signal?: AbortSignal },
): Promise<ChatResult> {
  const sessionId = sessionFor(lab, options);
  const user: Message = {
    id: `m-${crypto.randomUUID().slice(0, 8)}`,
    role: 'user',
    blocks: [{ kind: 'text', text: options.prompt }],
    createdAt: Date.now(),
  };
  appendMessage(lab, sessionId, user);

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const gate = permissionGate({ yes: options.yes, interactive: options.interactive ?? false });
  let printed = 0;
  let printedThinking = 0;
  let failed = false;
  const spin: Ora | null = options.spinner ? spinner('Thinking…') : null;
  const settle = (label?: string) => {
    if (spin?.isSpinning) label ? spin.succeed(label) : spin.stop();
  };
  spin?.start();

  const blocks = await runTurn(lab, {
    prompt: options.prompt,
    mode: options.mode,
    reasoning: options.reasoning,
    modelRef: options.modelRef,
    guarded: !options.yes,
    ask: gate,
    sessionId,
    signal,
    onBlock: (block) => {
      if (block.kind === 'tool') {
        if (block.status === 'running') {
          settle();
          process.stdout.write(
            `${out.c.grey('▸')} ${out.c.bold(block.name)} ${out.c.grey(block.description)}\n`,
          );
        } else if (block.status === 'error') {
          process.stdout.write(`${out.c.red('✗')} ${out.c.grey(block.name)}\n`);
        }
      }
    },
    onText: (text) => {
      // The engine replaces the answer rather than appending to it, so print the new suffix.
      if (text.length > printed) {
        settle();
        process.stdout.write(text.slice(printed));
        printed = text.length;
      }
    },
    onThinking: (text) => {
      if (text.length > printedThinking) {
        settle();
        process.stderr.write(out.c.grey(text.slice(printedThinking)));
        printedThinking = text.length;
      }
    },
  });

  settle();
  if (printed > 0) {
    process.stdout.write('\n');
  }
  const footer = blocks.find((block) => block.kind === 'run');
  failed = blocks.some((block) => block.kind === 'text' && block.text.startsWith('**Run failed.**'));
  if (footer && footer.kind === 'run') {
    const tokens =
      footer.tokensIn !== undefined
        ? ` · ${footer.tokensIn} in / ${footer.tokensOut ?? 0} out${footer.cachedTokens ? ` (${footer.cachedTokens} cached)` : ''}`
        : '';
    process.stderr.write(
      out.c.grey(
        `  ${footer.modelRef} · ${footer.mode} · ${(footer.durationMs / 1000).toFixed(1)}s${tokens}\n`,
      ),
    );
  }

  const assistant: Message = {
    id: `m-${crypto.randomUUID().slice(0, 8)}`,
    role: 'assistant',
    blocks,
    createdAt: Date.now(),
  };
  appendMessage(lab, sessionId, assistant);
  if (options.persist !== false) {
    await lab.save();
  }
  return { sessionId, blocks, failed };
}
