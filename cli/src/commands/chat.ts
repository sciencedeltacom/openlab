/**
 * A turn at the terminal.
 *
 * `openlab chat "plot the docking scores"` runs one turn; with no prompt and a terminal it
 * opens a small loop, which is the same thing repeated. The turn is the app's own: the same
 * system prompt, the same tools under the same pack gating, and the same permission gate —
 * mutating calls ask first unless `--yes`.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../lib/base';
import { chatTurn, startSession } from '../lib/chat';
import * as out from '../lib/output';
import type { AgentMode, ReasoningEffort } from '@/store/types';

/** The three modes the workbench runs in. */
const MODES: AgentMode[] = ['agent', 'plan', 'ask'];
const EFFORTS: ReasoningEffort[] = ['off', 'low', 'medium', 'high'];

export default class Chat extends LabCommand {
  static description = 'Talk to the agent with this lab in context';

  static args = {
    prompt: Args.string({ description: 'What to ask. Omit it for a loop on a terminal.' }),
  };

  static flags = {
    mode: Flags.string({
      char: 'm',
      description: 'How much latitude the agent has',
      options: MODES,
      default: 'agent',
    }),
    reasoning: Flags.string({ description: 'How hard to think first', options: EFFORTS }),
    model: Flags.string({ description: 'provider/model-id to run this turn on' }),
    session: Flags.string({ description: 'Append to this session instead of the active one' }),
    new: Flags.boolean({ description: 'Start a new session', char: 'n' }),
    yes: Flags.boolean({ char: 'y', description: 'Approve mutating calls without asking' }),
    save: Flags.boolean({ description: 'Write the turn to the store', default: true, allowNo: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Chat);
    const lab = await this.requireLab();
    const interactive = Boolean(process.stdin.isTTY);

    if (flags.new) {
      startSession(lab, args.prompt?.slice(0, 60) ?? 'Untitled session');
      await lab.save();
    }

    const base = {
      mode: flags.mode as AgentMode,
      reasoning: (flags.reasoning as ReasoningEffort | undefined) ?? lab.state.reasoning,
      modelRef: flags.model,
      yes: flags.yes,
      sessionId: flags.session,
      persist: flags.save,
      interactive,
      spinner: interactive && !this.json,
    };

    const prompt = args.prompt?.trim();
    if (prompt) {
      const result = await chatTurn(lab, { ...base, prompt });
      if (this.json) {
        this.log(out.json({ sessionId: result.sessionId, blocks: result.blocks, failed: result.failed }));
      }
      if (result.failed) {
        process.exitCode = 1;
      }
      return;
    }

    if (!interactive) {
      this.fail('Give a prompt, or run this on a terminal for a loop.');
    }

    this.log(`${out.brand()}  ${out.c.grey(this.short(lab.root as string))}`);
    this.log(out.note('One line is one turn. `exit` leaves, `!command` runs a shell command.'));
    const sessionId = flags.session ?? lab.state.activeSessionId ?? undefined;
    let current = sessionId;

    for (;;) {
      const line = await this.askLine();
      if (line === null) {
        break;
      }
      const text = line.trim();
      if (text === '') {
        continue;
      }
      if (text === 'exit' || text === 'quit') {
        break;
      }
      if (text.startsWith('!')) {
        const { runCommand } = await import('../lib/host/exec');
        const result = runCommand(text.slice(1), { root: lab.root as string });
        process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
        continue;
      }
      const result = await chatTurn(lab, { ...base, prompt: text, sessionId: current, interactive: true });
      current = result.sessionId;
    }
    this.log(out.note(`Session ${current}. \`openlab session show ${current}\` reads it back.`));
  }

  /** One line from the terminal, or null at end of input. */
  private async askLine(): Promise<string | null> {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(`${out.c.cyan('›')} `);
    } catch {
      return null;
    } finally {
      rl.close();
    }
  }
}
