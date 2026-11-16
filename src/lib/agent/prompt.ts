/**
 * The system prompt.
 *
 * The prompt is assembled per session from three facts the model cannot infer: where it is
 * allowed to work, which domain packs the user opened, and whether it is the lead or a
 * bounded worker. The tool list is generated from the resolved surface rather than written by
 * hand, so a pack that is closed is absent from the prompt instead of being described and
 * then refused.
 *
 * The behavioural rules are few and about evidence, and there is one block about recording
 * work: the tracker is where a piece of work leaves a trace, so the model is told to open a
 * task before it starts and attach what the work produced. A long instruction file is one the
 * model skims; every line here is meant to change what gets written down.
 */

import type { AgentMode } from '@/store/types';
import type { PackSurface } from './packs';
import { findTool } from './tools';
import { OPENUI_FENCE } from '@/lib/openui';
import { DEFAULT_PROMPTS, preferenceLines, type Preferences, type PromptOverrides } from '@/lib/settings';

/** The worker context, when this prompt is for a subagent rather than the lead. */
export interface SubagentBrief {
  id: string;
  name: string;
  summary: string;
}

/** The agent a lead turn runs as, when the user picked one in the agent bar. */
export interface AgentBrief {
  id: string;
  name: string;
  /** Added to the prompt verbatim; empty for the built-in main agent. */
  instructions: string;
  /** The other agents, as `name (id)` lines the lead may delegate to. */
  teammates?: readonly string[];
}

/** What the prompt needs to know. */
export interface PromptInput {
  mode: AgentMode;
  /** Absolute workspace path, or an empty string for a scratch project. */
  workspace: string;
  surface: PackSurface;
  subagent?: SubagentBrief;
  agent?: AgentBrief;
  /** What this session is called, so the lead can name it when nobody has. */
  sessionTitle?: string;
  /** The reader's standing preferences, from Settings. */
  preferences?: Preferences;
  /** The workspace's own words for the global, mode and worker instructions. */
  prompts?: PromptOverrides;
  /**
   * Whether the model may answer with interface cards.
   *
   * True in the app, where the cards are rendered. A host with no renderer — the CLI — passes
   * false rather than teaching the model a language nothing on the other end speaks.
   */
  interface?: boolean;
}

/** The behaviour each mode asks for. */
const MODE_BEHAVIOUR: Record<AgentMode, string> = {
  agent:
    'You work in the lab: you read, write and run. Do the work rather than describe it, and carry it to a result the user can check.',
  plan: 'Agree on a method first. Answer with a plan and the checks that would confirm it (not a result), and change nothing.',
  ask: 'Answer the question and change nothing.',
};

/**
 * How to work, and what to record.
 *
 * Short on purpose: the first block is the evidence discipline, the second is the tracker.
 * Both are about what ends up written down, which is the only part of a turn that outlives it.
 */
/**
 * How the model learns the interface language.
 *
 * The full guide is ~35 KB and was appended to every step of every turn — the largest fixed
 * cost in the prompt. It is a skill now: loaded once, when a card is actually wanted, and
 * then kept in the transcript like any other read.
 */
const INTERFACE = [
  'Interfaces:',
  `- When a chart, table, form or set of choices answers better than prose, first call \`skill\` with id \`openui-guide\`, then write one fenced \`\`\`${OPENUI_FENCE} program beside your Markdown.`,
  '- Never write the fence before loading the guide: the component names and their arguments come from it.',
].join('\n');

const METHOD = [
  'How to work:',
  '- Read the file, schema or data before acting on it; verify a number against its source, not your expectation.',
  '- `openwiki/` documents the project: list, search, then read it with the knowledge tool before assuming how it is organised.',
  '- Never delete or overwrite data or results unless asked; a rerun writes beside the last one.',
  '- Report what ran end to end, and name the command or file it came from. A missing capability is said plainly, never staged as if it ran.',
  '- Cite a source a tool returned as `record:<id>`, not as a full reference.',
  '- Ask only when the answer is not in the evidence and would change the outcome.',
  '- A long session is compacted: the transcript may begin mid-thread, and an old tool result may say it was elided. Re-read the file or rerun the command instead of guessing what it said.',
  '',
  'Record the work:',
  '- Anything past a step or two: `task_create` first (a title and what it involves), then `task_update` as it moves. Status when it changes; `evidence` for what the work produced (kind, title, and the path, DOI or job id; `verified` only if you opened or reran it); `note` for a decision or a caveat.',
  '- Plan in waves: `wave_list` reads the stretches the workspace works in, `wave_create` opens one, and `wave` on a task puts it in the wave it belongs to. The plan is mirrored to `.openlab/plan/` for the repository, so it is also readable as files, and the figures are documents under `.openlab/figures/`.',
  '- Attach as you go, not at the end: a file the user cannot find from the task is a file that does not exist.',
  '- A question, a one-line answer or a read gets no task.',
].join('\n');

/**
 * The plan is the lead's page, not a worker's.
 *
 * A worker's assignment leaves `plan_update` out of its surface, so teaching it to plan was
 * teaching it a call that could only fail.
 */
const PLAN_WORK = [
  'Plan the work:',
  '- More than a step or two: call plan_update with the goal and the steps before you start, and set each step active, done or skipped as you go. The reader sees the plan above the composer.',
  '- Keep a step to one line. A plan nobody reads is noise.',
].join('\n');

/**
 * Build the system prompt for one session.
 *
 * A worker gets a narrower brief: its own name and remit, its tools, and no delegation
 * guidance, because a worker that tried to delegate would be doing the lead's job.
 */
export function buildSystemPrompt(input: PromptInput): string {
  const scope = input.workspace
    ? `You are working in the folder ${input.workspace}. Paths are relative to it unless absolute.`
    : 'This project lives in memory: no folder is attached, so you cannot read or write files.';

  const heading = input.subagent
    ? `You are the ${input.subagent.name} worker of openlab, a research workbench agent from ScienceDelta. ${input.subagent.summary}`
    : input.agent && input.agent.name
      ? `You are ${input.agent.name}, an agent in openlab, a research workbench from ScienceDelta.`
      : 'You are openlab, a research workbench agent from ScienceDelta.';

  const tools = input.surface.toolIds
    .map((id) => {
      const tool = findTool(id);
      return tool ? `- ${tool.name}: ${tool.summary}` : undefined;
    })
    .filter((line): line is string => Boolean(line));

  const mcps = input.surface.mcpIds.length > 0 ? input.surface.mcpIds.join(', ') : 'none';
  const skills = input.surface.skillIds.length > 0 ? input.surface.skillIds.join(', ') : 'none';

  const prompts = input.prompts ?? DEFAULT_PROMPTS;
  const behaviour = prompts[input.mode].trim() || MODE_BEHAVIOUR[input.mode];
  const globalNote = prompts.global.trim();

  const lines = [
    heading,
    ...(globalNote ? ['', 'User instructions:', globalNote] : []),
    '',
    scope,
    '',
    behaviour,
    ...(input.subagent && prompts.worker.trim() ? ['', prompts.worker.trim()] : []),
    '',
    'Tools you may call:',
    ...(tools.length > 0 ? tools : ['- none, beyond answering']),
    '',
    `MCP servers your packs name: ${mcps}. openlab starts one only when the reader starts it on Settings → MCP servers; do not claim to have used one that is not running.`,
    `Procedures you can load with the skill tool: ${skills}.`,
    '',
    METHOD,
    ...(input.subagent ? [] : ['', PLAN_WORK]),
  ];

  // The reader's own settings, in their words. They are a standing choice, not a task, so
  // they sit after the method and before the agent's narrower instructions.
  const preferred = input.preferences
    ? preferenceLines(
        input.preferences,
        new Set(['theme', 'navMode', 'background:home-background', 'background:tint', 'background:glow']),
      )
    : [];
  if (preferred.length > 0) {
    lines.push('', ...preferred);
  }

  if (!input.subagent && input.mode === 'agent') {
    const titled = (input.sessionTitle ?? '').trim();
    // The name is the session's own, not the agent's to overrule: it is offered once, while
    // the list still says “Untitled session”.
    lines.push(
      '',
      titled.length > 0 && !/^untitled session$/i.test(titled)
        ? `This session is called “${titled}”; do not rename it.`
        : 'This session has no name yet. Once you know what the work is, and not before, call `session_title` with three to six words so it is findable in the session list, and do it once.',
    );
    // One session, one job. Only the model can tell that the reader has moved on to a
    // different piece of work, so the split is its call — but the bar is high, because a
    // session split for every other message loses the context the work actually shares.
    lines.push(
      '',
      'This session is one job. When the reader brings something that shares no work with it (a different dataset, a different question, a different deliverable), call `split_session` with a short title and the `new_prompt` that should run there, restated so it stands on its own. A follow-up, a correction or the next step of the same job is not a split. If they allow it, finish this turn and let the new session work; if they decline, stay here.',
    );
    lines.push(
      '',
      'When one part of the work will not inform another, delegate it and keep the synthesis. Call `tool_search` first and pass the worker the narrowest `tools` list it needs (or a pack, when the whole pack is the job); a worker with a tool it does not need is a worker that may use it.',
      'Every delegation opens its own session under this one, so give it a `description` of one line the reader can find later, and do not repeat the worker’s findings as your own work. Read its handoff and carry on.',
    );
    if (input.agent?.teammates && input.agent.teammates.length > 0) {
      lines.push('', `Your team, when you delegate: ${input.agent.teammates.join(', ')}.`);
    }
  }

  // The agent the user chose leads the turn; its own instructions come last so they win over
  // the generic ones above.
  if (!input.subagent && input.agent?.instructions.trim()) {
    lines.push('', 'Agent instructions:', input.agent.instructions.trim());
  }

  // The interface is part of the answer, not a separate mode: the lead is taught to draw one
  // when it helps, in the same turn as the prose. A worker hands facts back to the lead, so
  // the whole language would be tokens it never spends. A host without a renderer opts out.
  if (!input.subagent && input.interface !== false && input.mode !== 'plan') {
    lines.push('', INTERFACE);
  }

  return lines.join('\n');
}
