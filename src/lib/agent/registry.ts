/**
 * Tool execution.
 *
 * The inventory says what exists; this module says how each tool runs. An executor receives
 * already-parsed arguments and a context carrying the workspace, the abort signal and the
 * host that performs I/O, and returns text for the model to read next.
 *
 * Two rules hold for every executor. Arguments are validated here rather than trusted, because
 * a model can emit anything and a malformed call should come back as a readable error instead
 * of a thrown exception that ends the turn. And output is capped at a fixed size, with the
 * truncation stated, so one large read cannot swallow the context window.
 */

import * as stats from '../science/stats';
import type { ScienceRecord } from '../science/connectors';
import { newJob } from '@/store/compute';
import {
  currentWave,
  newTask,
  newWave,
  TASK_KINDS,
  WORK_STATUSES,
  waveDaysLeft,
  type Comment,
  type Evidence,
  type Task,
  type TaskKind,
  type Wave,
  type WorkStatus,
} from '@/store/research';
import { extensionCredentialKey, findExtensionTool } from '@/lib/extensions/registry';
import { findMcpTool } from '@/lib/mcp/registry';
import { formatRecords, type Row, type TabularFormat } from '@/lib/format/tabular';
import { experimentById, lockPreregistration, recordDeviation } from '@/components/experiments/store';
import type { PreregistrationPlan } from '@/components/experiments/preregistration';
import { allTools, findTool, type AgentToolId } from './tools';
import type { DomainHost } from './domain';
import type { PlanStep } from '@/store/types';
import type { ToolCall, ToolResult } from './transcript';
import type {
  ExperimentDomain,
  ExperimentOutcome,
  FieldDef,
  FieldKind,
} from '@/components/experiments/experiments';

/** Filesystem, process and network access the executors need. */
export interface ToolHost {
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  listDir(path: string): Promise<{ name: string; path: string; isDir: boolean }[]>;
  glob(pattern: string, path?: string): Promise<string[]>;
  grep(pattern: string, options: { path?: string; glob?: string }): Promise<string>;
  runCommand(command: string, cwd?: string): Promise<{ output: string; exitCode: number }>;
  fetchUrl(url: string, options?: FetchOptions): Promise<string>;
  /** Call a tool on a running MCP server. Absent where no server can run (the CLI). */
  mcpCall?(
    server: string,
    tool: string,
    arguments_: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }>;
}

/** What a fetch may carry. Credential values are resolved by Rust, never here. */
export interface FetchOptions {
  /** Literal request headers, as the extension declared them. */
  headers?: Record<string, string>;
  /** Header name → vault key. Rust reads the value and sets the header itself. */
  vaultHeaders?: Record<string, string>;
}

/** Everything an executor is given. */
export interface ToolContext {
  /** Absolute workspace root a relative path resolves against. */
  workspace: string;
  signal: AbortSignal;
  host: ToolHost;
  /** The app's own records — tracker tasks, targets, jobs. Absent in a scripted test. */
  domain?: DomainHost;
  /** The session this turn runs in, so a tool can associate a record with it. */
  sessionId?: string;
}

/** What one executor returns. */
export interface ToolOutcome {
  content: string;
  isError?: boolean;
}

/** Run one validated call. */
export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;

/**
 * Output past this size is cut and marked, per tool.
 *
 * A result is paid again on every later step of the turn, so the budget belongs to the tool:
 * a file read is cheaper than a build log, and a search hit list cheaper than both. The tail
 * is kept because the answer to "why did it fail" is almost always the last lines.
 */
const TOOL_LIMITS: Record<string, number> = {
  read_file: 15 * 1024,
  run_command: 20 * 1024,
  fetch_url: 15 * 1024,
  grep: 10 * 1024,
  glob: 8 * 1024,
  list_dir: 8 * 1024,
  science_search: 15 * 1024,
  query_database: 15 * 1024,
  // The interface guide is ~35 KB by design; a cut guide is worse than no guide.
  skill: 40 * 1024,
};

/** The default for a tool with no budget of its own. */
const DEFAULT_OUTPUT_BYTES = 20 * 1024;

/** How much of a result one call may add to the transcript. */
export function outputLimit(tool: string): number {
  return TOOL_LIMITS[tool] ?? DEFAULT_OUTPUT_BYTES;
}

/** Cut text at the limit, keeping both ends, and say how much was dropped. */
export function cap(text: string, limit: number = DEFAULT_OUTPUT_BYTES): string {
  if (text.length <= limit) {
    return text;
  }
  const head = Math.floor(limit * 0.7);
  const tail = limit - head;
  const dropped = text.length - limit;
  return `${text.slice(0, head)}\n\n… ${dropped} characters elided at ${limit} bytes; the end follows …\n\n${text.slice(-tail)}`;
}

/** A required string argument, or an explanation of what was missing. */
function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`\`${key}\` is required and must be a non-empty string`);
  }
  return value;
}

/** An optional string argument. */
function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** A numeric array argument. */
function numberArray(args: Record<string, unknown>, key: string): number[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

/** Wrap a required string read so a missing argument becomes a readable outcome. */
async function guard(run: () => Promise<ToolOutcome>): Promise<ToolOutcome> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: message, isError: true };
  }
}

/** Read a file, or one range of its lines. */
const readFile: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const path = requireString(args, 'path');
    const text = await ctx.host.readFile(path);
    const start = typeof args.start_line === 'number' ? Math.max(1, Math.floor(args.start_line)) : undefined;
    const end = typeof args.end_line === 'number' ? Math.floor(args.end_line) : undefined;
    if (start === undefined && end === undefined) {
      return { content: cap(text, outputLimit('read_file')) };
    }
    const lines = text.split('\n');
    const from = (start ?? 1) - 1;
    if (from >= lines.length) {
      return { content: `${path} has ${lines.length} line${lines.length === 1 ? '' : 's'}.`, isError: true };
    }
    const to = Math.min(end ?? lines.length, lines.length);
    const slice = lines.slice(from, Math.max(from, to));
    return {
      content: `# ${path} · lines ${from + 1}-${from + slice.length} of ${lines.length}\n${cap(
        slice.join('\n'),
        outputLimit('read_file'),
      )}`,
    };
  });

/** Write a file. */
const writeFile: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const path = requireString(args, 'path');
    const contents = requireString(args, 'contents');
    await ctx.host.writeFile(path, contents);
    return { content: `Wrote ${contents.length} characters to ${path}.` };
  });

/** List a directory. */
const listDir: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const entries = await ctx.host.listDir(optionalString(args, 'path') ?? ctx.workspace);
    const lines = entries.map((entry) => `${entry.isDir ? 'dir ' : 'file'} ${entry.name}`);
    return { content: lines.length > 0 ? lines.join('\n') : '(empty directory)' };
  });

/** Find files by glob. */
const glob: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const matches = await ctx.host.glob(requireString(args, 'pattern'), optionalString(args, 'path'));
    return { content: matches.length > 0 ? cap(matches.join('\n')) : 'No files matched.' };
  });

/** Search file contents. */
const grep: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const pattern = requireString(args, 'pattern');
    const output = await ctx.host.grep(pattern, {
      path: optionalString(args, 'path'),
      glob: optionalString(args, 'glob'),
    });
    return { content: cap(output || 'No matches.') };
  });

/** Read the workspace's OpenWiki. */
const knowledge: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const action = requireString(args, 'action');
    const limit =
      typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 50) : 20;
    const { loadWikiFrom, findWikiPage, searchWikiPages } = await import('../knowledge/wiki');
    const graph = await loadWikiFrom({
      glob: (pattern, path) => ctx.host.glob(pattern, path),
      read: (path) => ctx.host.readFile(path),
    });

    if (!graph) {
      return {
        content: 'This workspace has no OpenWiki: nothing under `openwiki/`. Read the files themselves.',
        isError: true,
      };
    }

    switch (action) {
      case 'list': {
        const pages = graph.pages.slice(0, limit);
        const lines = pages.map(
          (page) => `- ${page.id}: ${page.title}${page.summary ? `: ${page.summary}` : ''}`,
        );
        return { content: cap(`OpenWiki pages (${graph.pages.length}):\n${lines.join('\n')}`) };
      }
      case 'search': {
        const query = requireString(args, 'query');
        const matches = searchWikiPages(graph, query, limit);
        if (matches.length === 0) {
          return { content: `No OpenWiki page matches “${query}”. Try action "list".` };
        }
        return {
          content: cap(
            matches
              .map((page) => `## ${page.id}: ${page.title}\n${page.summary || page.content.slice(0, 400)}`)
              .join('\n\n'),
          ),
        };
      }
      case 'read': {
        const ref = requireString(args, 'page');
        const page = findWikiPage(graph, ref);
        if (!page) {
          return {
            content: `No OpenWiki page “${ref}”. Use action "list" to see the pages.`,
            isError: true,
          };
        }
        const links = page.links.length > 0 ? `\n\nLinks: ${page.links.join(', ')}` : '';
        return { content: cap(`# ${page.title}\n\n${page.content}${links}`) };
      }
      default:
        return { content: `Unknown action \`${action}\`. Use list, search or read.`, isError: true };
    }
  });

/** Output past this size is kept beside the work instead of in the context. */
const ARTIFACT_THRESHOLD = 24 * 1024;

/**
 * Write a large result into the workspace and return its path.
 *
 * A build log or a batch output is evidence the model may need, but reading it into the
 * transcript is the most expensive way to keep it. The file stays in the workspace, the model
 * gets the head and a way to read any range of the rest.
 */
async function keepArtifact(ctx: ToolContext, name: string, text: string): Promise<string | undefined> {
  if (!ctx.workspace || text.length < ARTIFACT_THRESHOLD) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `.openlab/artifacts/${name}-${stamp}.log`;
  try {
    await ctx.host.writeFile(path, text);
    return path;
  } catch {
    return undefined;
  }
}

/** Run a command. */
const runCommand: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const command = requireString(args, 'command');
    const result = await ctx.host.runCommand(command, optionalString(args, 'cwd'));
    const body = result.output.trim() || '(no output)';
    const artifact = await keepArtifact(ctx, 'command', body);
    const content = artifact
      ? `[exit code ${result.exitCode}] ${body.length} characters kept at ${artifact}.\n\n${body.slice(0, 2000)}\n\n… read a range with read_file (start_line, end_line) if you need more.`
      : `${body}\n\n[exit code ${result.exitCode}]`;
    return { content, isError: result.exitCode !== 0 };
  });

/** Fetch a URL. */
const fetchUrl: ToolExecutor = (args, ctx) =>
  guard(async () => ({
    content: cap(await ctx.host.fetchUrl(requireString(args, 'url'))),
  }));

/** Load a procedure. */
const skill: ToolExecutor = (args) =>
  guard(async () => {
    const id = requireString(args, 'id');
    // The interface language is a skill rather than a fixed block in the system prompt: it is
    // large, and most turns never draw a card.
    if (id === 'openui-guide') {
      const { openuiSystemPrompt } = await import('../openui');
      return { content: openuiSystemPrompt() };
    }
    const { BUILTIN_SCIENCE_SKILLS } = await import('../science/skills');
    const found = BUILTIN_SCIENCE_SKILLS.find((entry) => entry.id === id);
    if (!found) {
      return { content: `No built-in procedure is named \`${id}\`.`, isError: true };
    }
    const body = [
      `# ${found.name}`,
      '',
      found.summary,
      '',
      `When to use: ${found.whenToUse}`,
      '',
      'Steps:',
      ...found.steps.map((step, index) => `${index + 1}. ${step}`),
      '',
      `Inputs: ${found.contract.inputs.join(', ') || '—'}`,
      `Outputs: ${found.contract.outputs.join(', ') || '—'}`,
      `Verification: ${found.contract.verification}`,
    ].join('\n');
    return { content: body };
  });

/** Find the tools a piece of work needs, before delegating it. */
const toolSearch: ToolExecutor = (args) =>
  guard(async () => {
    const query = (optionalString(args, 'query') ?? '').toLowerCase().trim();
    const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(60, Math.round(args.limit))) : 20;
    const rows = allTools()
      .filter((tool) => {
        if (!query) return true;
        return tool.id.includes(query) || tool.summary.toLowerCase().includes(query);
      })
      .slice(0, limit)
      .map((tool) => {
        const effects = [
          tool.effects.readOnly ? 'reads' : '',
          tool.effects.writes ? 'writes' : '',
          tool.effects.executes ? 'executes' : '',
          tool.effects.network ? 'network' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `${tool.id}: ${tool.summary} [${effects || 'no effects'}] (${tool.scope})`;
      });
    return {
      content:
        rows.length > 0
          ? rows.join('\n')
          : `No tool matches “${query}”. Call tool_search with no query to see the inventory.`,
    };
  });

/** Replace the plan shown above the composer. */
const PLAN_STATUSES: readonly PlanStep['status'][] = ['pending', 'active', 'done', 'skipped'];

const planUpdate: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain?.setSessionPlan) {
      return { content: 'The plan is only available inside a session.', isError: true };
    }
    const raw = Array.isArray(args.steps) ? args.steps : [];
    const steps: PlanStep[] = raw.flatMap((entry, index) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const item = entry as Record<string, unknown>;
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!title) return [];
      const status =
        typeof item.status === 'string' && (PLAN_STATUSES as readonly string[]).includes(item.status)
          ? (item.status as PlanStep['status'])
          : 'pending';
      return [{ id: `p${index + 1}`, title, status }];
    });
    if (steps.length === 0) {
      return { content: 'A plan needs at least one step with a title.', isError: true };
    }
    ctx.domain.setSessionPlan({ goal: optionalString(args, 'goal') ?? '', steps, updatedAt: Date.now() });
    return {
      content: `Plan updated (${steps.length} steps): ${steps.map((step) => `[${step.status}] ${step.title}`).join('; ')}`,
    };
  });

/** Name the session, once its work is clear. */
const sessionTitle: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain?.setSessionTitle) {
      return { content: 'A session can only be named from inside one.', isError: true };
    }
    const title = (optionalString(args, 'title') ?? '').replace(/\s+/g, ' ').trim();
    if (!title) {
      return { content: '`title` is required: three to six words.', isError: true };
    }
    // The first name wins: a session the reader has named is not the agent's to change.
    const current = (ctx.domain.sessionTitle?.() ?? '').trim();
    if (current.length > 0 && !/^untitled session$/i.test(current)) {
      return { content: `This session is already called “${current}”; its name is kept.` };
    }
    const short = title.replace(/\.$/, '').slice(0, 80);
    ctx.domain.setSessionTitle(short);
    return { content: `Session named “${short}”.` };
  });

/**
 * Start a separate session for a different job.
 *
 * The split is the reader's page, not a silent rewrite: the turn that asked for it finishes
 * where it started, and the next message opens in the new session, so the record keeps what
 * the work produced instead of losing it to a moved transcript.
 */
const splitSession: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain?.splitSession) {
      return { content: 'A session can only be split from inside one.', isError: true };
    }
    const raw = (optionalString(args, 'title') ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) {
      return { content: '`title` is required: three to six words for the new session.', isError: true };
    }
    const prompt = (optionalString(args, 'new_prompt') ?? '').trim();
    if (!prompt) {
      return {
        content:
          '`new_prompt` is required: the request restated so it stands on its own, not “continue as before”.',
        isError: true,
      };
    }
    const title = raw.replace(/\.$/, '').slice(0, 80);
    const id = ctx.domain.splitSession(title, prompt);
    if (!id) {
      return { content: 'The new session could not be opened.', isError: true };
    }
    return {
      content: `Opened “${title}” as its own session and started there. Finish this turn here; the reader is watching the new one.`,
    };
  });

/** Delegation is intercepted by the lead engine; this is the standalone fallback. */
const task: ToolExecutor = async () => ({
  content: 'Delegation is only available to the lead agent.',
  isError: true,
});

/** Run a statistical procedure, returning a result with code that recomputes it. */
const statistics: ToolExecutor = (args) =>
  guard(async () => {
    const test = requireString(args, 'test');
    const experimentId = optionalString(args, 'experiment');
    if (experimentId) {
      const experiment = experimentById(experimentId);
      if (!experiment) {
        return { content: `No experiment ${experimentId}.`, isError: true };
      }
      const plan = experiment.preregistration;
      if (!plan) {
        return {
          content: `Experiment ${experimentId} has no locked pre-registration. Lock the hypothesis and analysis plan before analyzing it (experiment_preregister).`,
          isError: true,
        };
      }
      const alpha = typeof args.confidence === 'number' ? 1 - args.confidence : 0.05;
      const side =
        args.alternative === 'greater' || args.alternative === 'less' ? args.alternative : 'two-sided';
      const changes: string[] = [];
      if (plan.test !== test) changes.push(`test: ${plan.test} → ${test}`);
      if (Math.abs(plan.alpha - alpha) > 1e-9) changes.push(`alpha: ${plan.alpha} → ${alpha}`);
      if (plan.alternative !== side) changes.push(`side: ${plan.alternative} → ${side}`);
      if (changes.length > 0) {
        const reason = optionalString(args, 'deviation_reason');
        if (!reason) {
          return {
            content: `This run departs from the locked plan (${changes.join('; ')}). Pass deviation_reason to record the deviation, or run the planned procedure.`,
            isError: true,
          };
        }
        recordDeviation(experimentId, {
          decision: changes.join('; '),
          reason,
          // The analysis step is after the data exists; the reader can reclassify it if not.
          phase: 'after-results',
          by: 'agent',
        });
      }
    }
    const a = numberArray(args, 'a');
    const b = numberArray(args, 'b');
    const groups = Array.isArray(args.groups)
      ? (args.groups as unknown[]).map((group) =>
          Array.isArray(group)
            ? group.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
            : [],
        )
      : undefined;
    const confidence = typeof args.confidence === 'number' ? args.confidence : undefined;
    const alternative =
      args.alternative === 'greater' || args.alternative === 'less' ? args.alternative : 'two-sided';

    const options = { confidence, alternative } as const;
    let result: stats.ReproducibleResult<unknown>;
    switch (test) {
      case 'descriptives':
        result = stats.describe(a ?? [], confidence ?? 0.95);
        break;
      case 'welch-t-test':
        result = stats.welchTTest(a ?? [], b ?? [], options);
        break;
      case 'paired-t-test':
        result = stats.pairedTTest(a ?? [], b ?? [], options);
        break;
      case 'one-sample-t-test':
        result = stats.oneSampleTTest(a ?? [], 0, options);
        break;
      case 'one-way-anova':
        result = stats.anovaOneWay(groups ?? [], {});
        break;
      case 'chi-square':
        result = stats.chiSquareTest(groups ?? []);
        break;
      case 'pearson-correlation':
        result = stats.pearsonCorrelation(a ?? [], b ?? [], { confidence });
        break;
      case 'linear-regression':
        result = stats.linearRegression(a ?? [], b ?? [], { confidence });
        break;
      default:
        return { content: `Unknown procedure \`${test}\`.`, isError: true };
    }
    return { content: cap(JSON.stringify(result)), isError: Boolean(result.error) };
  });

/** Search the public research databases. */
const scienceSearch: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const query = requireString(args, 'query');
    const limit = typeof args.limit === 'number' ? args.limit : 10;
    const [{ SCIENCE_CONNECTORS, findConnector }, { runPlan, extractIds }] = await Promise.all([
      import('../science/connectors'),
      import('../science/fetch'),
    ]);
    const requested = Array.isArray(args.sources)
      ? (args.sources as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const selected =
      requested.length > 0
        ? requested
            .map(findConnector)
            .filter((connector): connector is NonNullable<typeof connector> => Boolean(connector))
        : SCIENCE_CONNECTORS.slice(0, 3);

    const records: ScienceRecord[] = [];
    const failures: string[] = [];
    for (const connector of selected) {
      try {
        const payloads = await runPlan(connector.plan(query, limit), extractIds);
        records.push(...connector.parse(payloads));
      } catch (error) {
        failures.push(`${connector.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Keep the sources, so the model can cite one as `record:<id>` and the reader can open it.
    ctx.domain?.addRecords(records);
    const kept = records.slice(0, limit);
    const format = tabularFormat(args);
    const body =
      format === 'json'
        ? JSON.stringify({ records: kept, failures })
        : [
            `# ${kept.length} record${kept.length === 1 ? '' : 's'}`,
            formatRecords(kept as unknown as Row[], format),
            ...(failures.length > 0 ? ['', `# failures: ${failures.join('; ')}`] : []),
          ].join('\n');
    return { content: cap(body, outputLimit('science_search')), isError: records.length === 0 };
  });

/** Fetch one record by identifier. */
const scienceFetch: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const source = requireString(args, 'source');
    const id = requireString(args, 'id');
    const [{ findConnector }, { runPlan, extractIds }] = await Promise.all([
      import('../science/connectors'),
      import('../science/fetch'),
    ]);
    const connector = findConnector(source);
    if (!connector) {
      return { content: `Unknown source \`${source}\`.`, isError: true };
    }
    const payloads = await runPlan(connector.plan(id, 5), extractIds);
    const records = connector.parse(payloads);
    const match = records.find((record) => record.id === id) ?? records[0];
    if (match) {
      ctx.domain?.addRecords([match]);
    }
    return match
      ? { content: cap(JSON.stringify(match)) }
      : { content: `No record \`${id}\` from ${source}.`, isError: true };
  });

/** The message every record tool gives when the store is not wired in. */
const NO_DOMAIN = 'The workspace records are not available in this session.';

/** Scan a paper's PDF into the local full-text index. */
const scanPdf: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.workspace) {
      return { content: 'Scanning needs a workspace folder; this session has none.', isError: true };
    }
    const doi = optionalString(args, 'doi');
    const recordId = optionalString(args, 'recordId');
    const url = optionalString(args, 'url');
    const local = optionalString(args, 'path');
    if (!doi && !recordId && !url && !local) {
      return { content: 'Give one of `doi`, `recordId`, `url` or `path`.', isError: true };
    }
    const absolute = local
      ? local.startsWith('/')
        ? local
        : `${ctx.workspace.replace(/\/$/, '')}/${local}`
      : undefined;
    const docId = optionalString(args, 'docId');
    const title = optionalString(args, 'title');

    const { scanPdf: run, scanRoot } = await import('@/lib/scan/ipc');
    const result = await run(scanRoot(ctx.workspace, ''), {
      ...(doi ? { doi } : {}),
      ...(recordId ? { recordId } : {}),
      ...(url ? { url } : {}),
      ...(absolute ? { path: absolute } : {}),
      ...(docId ? { docId } : {}),
      ...(title ? { title } : {}),
      force: args.force === true,
    });
    if (!result.ok) {
      return { content: `The scan failed: ${result.error.message}`, isError: true };
    }
    const document = result.value;
    return {
      content: `Indexed ${document.id}: ${document.pages ?? 0} pages, ${document.chunks ?? 0} chunks${
        document.cached ? ' (already indexed)' : ''
      }.`,
    };
  });

/** Search the full text of the scanned PDFs. */
const searchLibrary: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.workspace) {
      return {
        content: 'Searching the library needs a workspace folder; this session has none.',
        isError: true,
      };
    }
    const query = requireString(args, 'query');
    const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(25, Math.round(args.limit))) : 10;
    const docIds = Array.isArray(args.docIds)
      ? (args.docIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : undefined;

    const { searchLibrary: run, scanRoot } = await import('@/lib/scan/ipc');
    const result = await run(scanRoot(ctx.workspace, ''), query, { docIds, limit });
    if (!result.ok) {
      return { content: `The search failed: ${result.error.message}`, isError: true };
    }
    const { hits, mode } = result.value;
    if (hits.length === 0) {
      return {
        content: `Nothing indexed matches “${query}” (mode: ${mode}). Scan a paper first with scan_pdf.`,
        isError: true,
      };
    }
    return { content: cap(JSON.stringify({ mode, hits })) };
  }); /** List the databases in the catalogue. */
const listDatabases: ToolExecutor = (args) =>
  guard(async () => {
    const { allDatabases } = await import('@/components/databases/store');
    const query = optionalString(args, 'query')?.toLowerCase();
    const databases = allDatabases().filter(
      (database) =>
        !query ||
        `${database.name} ${database.family} ${database.purpose} ${database.holds}`
          .toLowerCase()
          .includes(query),
    );
    if (databases.length === 0) {
      return { content: 'No databases matched. The catalogue is under Library → Databases.', isError: true };
    }
    return {
      content: cap(
        databases
          .map(
            (database) =>
              `${database.id} [${database.state}] ${database.name}: ${database.family} · ${database.access} · ${database.holds}`,
          )
          .join('\n'),
      ),
    };
  });

/** Run a request against a catalogue database and return its records. */
const queryDatabase: ToolExecutor = (args, ctx) =>
  guard(async () => {
    const [{ allDatabases }, { runOperation }, { parseRecords }, { findOperation }] = await Promise.all([
      import('@/components/databases/store'),
      import('@/lib/catalog/request'),
      import('@/lib/catalog/sources'),
      import('@/components/databases/data'),
    ]);
    const ref = requireString(args, 'database');
    const database =
      allDatabases().find((candidate) => candidate.id === ref) ??
      allDatabases().find((candidate) => candidate.name.toLowerCase() === ref.toLowerCase());
    if (!database) {
      return { content: `No database named \`${ref}\`. Call list_databases for the ids.`, isError: true };
    }

    const operationId = optionalString(args, 'operation') ?? findOperation(database)?.id;
    const operation = database.operations.find((candidate) => candidate.id === operationId);
    if (!operation) {
      return {
        content: `${database.name} has no \`${operationId}\` operation. It offers: ${database.operations
          .map(
            (candidate) =>
              `${candidate.id} (${candidate.parameters.map((parameter) => parameter.name).join(', ')})`,
          )
          .join('; ')}.`,
        isError: true,
      };
    }

    const callArgs =
      typeof args.args === 'object' && args.args !== null ? (args.args as Record<string, unknown>) : {};
    const result = await runOperation(database, operation.id, callArgs);
    if (!result.ok) {
      return { content: `${database.name} answered: ${result.error}`, isError: true };
    }

    const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, Math.round(args.limit))) : 10;
    const records = parseRecords(result.data).slice(0, limit);
    if (records.length === 0) {
      return {
        content: `${database.name} answered, but nothing in the response looked like a record list.`,
        isError: true,
      };
    }
    const format = tabularFormat(args);
    const body =
      format === 'json'
        ? JSON.stringify({ database: database.id, operation: operation.id, count: records.length, records })
        : [
            `# ${database.id} · ${operation.id} · ${records.length} record${records.length === 1 ? '' : 's'}`,
            formatRecords(records as unknown as Row[], format),
          ].join('\n');
    return { content: cap(body, outputLimit('query_database')) };
  });

/** Start a systematic review in the background. */
const runReviewTool: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain?.startReview) {
      return { content: 'Starting a review is not available in this session.', isError: true };
    }
    const question = requireString(args, 'question');
    const sources = Array.isArray(args.sources)
      ? (args.sources as unknown[]).filter((id): id is string => typeof id === 'string')
      : undefined;
    const maxRecords =
      typeof args.max_records === 'number'
        ? Math.max(4, Math.min(60, Math.round(args.max_records)))
        : undefined;
    const id = ctx.domain.startReview({ question, sources, maxRecords });
    if (!id) {
      return {
        content: 'There are no saved sources to review. Create one under Library → Sources first.',
        isError: true,
      };
    }
    return { content: `Started review ${id}. It runs in the background; open Reviews to follow it.` };
  });

/** Task fields a create or update may set, validated against the tracker's vocabulary. */
function taskEdits(args: Record<string, unknown>): Partial<Task> {
  const patch: Partial<Task> = {};
  const title = optionalString(args, 'title');
  if (title) patch.title = title;
  const description = optionalString(args, 'description');
  if (description) patch.description = description;
  const kind = optionalString(args, 'kind');
  if (kind && TASK_KINDS.includes(kind as TaskKind)) patch.kind = kind as TaskKind;
  const status = optionalString(args, 'status');
  if (status && WORK_STATUSES.includes(status as WorkStatus)) patch.status = status as WorkStatus;
  if (typeof args.priority === 'number' && Number.isFinite(args.priority)) {
    patch.priority = Math.max(0, Math.min(4, Math.round(args.priority)));
  }
  return patch;
}

/** A `YYYY-MM-DD` day, as the tracker stores dates. */
function isDay(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(`${text}T00:00:00Z`));
}

/** Two weeks from a start day, or the fallback when the start is not a day. */
function defaultEnd(start: string, fallback: string): string {
  if (!isDay(start)) return fallback;
  return new Date(Date.parse(`${start}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The wave a call names, by number (`3`, `W3`), by id, or by name.
 *
 * A model will reach for whichever of those it just read, so all three resolve. `none` is
 * how a call takes a task back out of a wave, which is why it is not an error.
 */
function waveFor(ref: string, waves: readonly Wave[]): Wave | undefined | null {
  const text = ref.trim();
  if (!text || /^(none|null)$/i.test(text)) return null;
  const number = text.replace(/^w/i, '');
  const wanted = text.toLowerCase();
  return (
    waves.find((wave) => wave.id.toLowerCase() === wanted) ??
    waves.find((wave) => String(wave.number) === number) ??
    waves.find((wave) => wave.name.toLowerCase() === wanted)
  );
}

/** The wave field of a task call, as a patch, or an error to hand back. */
function wavePatch(
  args: Record<string, unknown>,
  waves: readonly Wave[],
): { patch: Partial<Task> } | { error: string } {
  const ref = optionalString(args, 'wave');
  if (ref === undefined) return { patch: {} };
  const wave = waveFor(ref, waves);
  if (wave === undefined) {
    const open = waves.map((candidate) => `W${candidate.number} ${candidate.name}`).join('; ') || 'none open';
    return { error: `No wave matches “${ref}”. Open waves: ${open}.` };
  }
  return { patch: { waveId: wave ? wave.id : null } };
}

/** Record a task in the tracker. */
const taskCreate: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const wave = wavePatch(args, ctx.domain.waves());
    if ('error' in wave) return { content: wave.error, isError: true };
    const task = {
      ...newTask(ctx.domain.tasks(), requireString(args, 'title')),
      ...taskEdits(args),
      ...wave.patch,
    };
    ctx.domain.addTask(task);
    const inWave = ctx.domain.waves().find((candidate) => candidate.id === task.waveId);
    return {
      content: `Created ${task.key} “${task.title}” (${task.status})${inWave ? ` in W${inWave.number}` : ''}.`,
    };
  });

/** Find tasks already in the tracker. */
const taskSearch: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const query = optionalString(args, 'query')?.toLowerCase();
    const status = optionalString(args, 'status');
    const tasks = ctx.domain.tasks().filter((task) => {
      if (status && task.status !== status) return false;
      if (!query) return true;
      return `${task.key} ${task.title} ${task.description}`.toLowerCase().includes(query);
    });
    if (tasks.length === 0) {
      return { content: 'No tasks matched.' };
    }
    return {
      content: tasks
        .slice(0, 50)
        .map((task) => `${task.key} [${task.status}] ${task.title}`)
        .join('\n'),
    };
  });

/**
 * The artefacts a call asked to attach.
 *
 * An attachment is a claim about where something lives, so `verified` is only true when the
 * model said it opened or reran it — an unverified attachment is still worth recording, and
 * the task shows it as unchecked rather than pretending otherwise.
 */
function attachments(args: Record<string, unknown>): Evidence[] {
  if (!Array.isArray(args.evidence)) return [];
  const kinds = ['dataset', 'figure', 'paper', 'run', 'notebook', 'code', 'protocol'];
  return args.evidence.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const item = entry as Record<string, unknown>;
    const kind = typeof item.kind === 'string' ? item.kind : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const ref = typeof item.ref === 'string' ? item.ref.trim() : '';
    if (!kinds.includes(kind) || !title || !ref) return [];
    return [
      {
        id: `e-${crypto.randomUUID().slice(0, 8)}`,
        kind: kind as Evidence['kind'],
        title,
        ref,
        verified: item.verified === true,
      },
    ];
  });
}

/** Change a tracked task, attach what it produced, or leave a note on it. */
const taskUpdate: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const ref = requireString(args, 'task');
    const found = ctx.domain
      .tasks()
      .find((task) => task.id === ref || task.key.toLowerCase() === ref.toLowerCase());
    if (!found) {
      return { content: `No task matches “${ref}”.`, isError: true };
    }

    const patch: Partial<Task> = taskEdits(args);
    const wave = wavePatch(args, ctx.domain.waves());
    if ('error' in wave) return { content: wave.error, isError: true };
    Object.assign(patch, wave.patch);
    const attached = attachments(args);
    if (attached.length > 0) {
      // Attaching the same path twice replaces the earlier claim rather than listing it twice.
      const byRef = new Map(found.evidence.map((item) => [item.ref, item]));
      for (const item of attached) byRef.set(item.ref, item);
      patch.evidence = [...byRef.values()];
    }

    const note = optionalString(args, 'note');
    if (note) {
      const comment: Comment = {
        id: `c-${crypto.randomUUID().slice(0, 8)}`,
        authorId: ctx.sessionId ?? 'agent',
        body: note,
        createdAt: Date.now(),
        reactions: {},
      };
      patch.comments = [...found.comments, comment];
    }

    if (Object.keys(patch).length === 0) {
      return { content: `Nothing to change on ${found.key}.`, isError: true };
    }
    ctx.domain.patchTask(found.id, { ...patch, updatedAt: Date.now() });
    const movedTo =
      patch.waveId !== undefined ? ctx.domain.waves().find((w) => w.id === patch.waveId) : undefined;
    const parts = [
      ...(patch.status ? [`status ${patch.status}`] : []),
      ...(patch.waveId !== undefined ? [movedTo ? `wave W${movedTo.number}` : 'out of its wave'] : []),
      ...(attached.length > 0 ? [`${attached.length} attachment${attached.length === 1 ? '' : 's'}`] : []),
      ...(note ? ['a note'] : []),
    ];
    return { content: `Updated ${found.key}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}.` };
  });

/** The days a wave has left, said the way the ledger says it. */
function wavePeriod(wave: Wave): string {
  const left = waveDaysLeft(wave);
  if (left > 1) return `${left} days left`;
  if (left === 1) return '1 day left';
  if (left === 0) return 'last day';
  return `${-left} days over`;
}

/** List the waves a workspace plans in. */
const waveList: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const waves = ctx.domain.waves();
    if (waves.length === 0) {
      return { content: 'No waves yet. `wave_create` opens one.', isError: true };
    }
    const current = currentWave(waves);
    const only = args.current === true;
    const shown = only ? waves.filter((wave) => wave.id === current?.id) : waves;
    if (shown.length === 0) {
      return { content: 'No wave contains today.', isError: true };
    }
    const tasks = ctx.domain.tasks();
    return {
      content: [...shown]
        .sort((a, b) => a.number - b.number)
        .map((wave) => {
          const mine = tasks.filter((task) => task.waveId === wave.id);
          const done = mine.filter((task) => task.status === 'done').length;
          const head = `W${wave.number} ${wave.name} [${wave.startDate} → ${wave.endDate}] · ${wavePeriod(wave)}${
            wave.id === current?.id ? ' · current' : ''
          }`;
          const goal = wave.goal ? `\n  goal: ${wave.goal}` : '';
          const items = mine.length > 0 ? `\n  ${mine.length} tasks, ${done} done` : '\n  no tasks yet';
          return `${head}${goal}${items}`;
        })
        .join('\n'),
    };
  });

/** Open a wave. */
const waveCreate: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const waves = ctx.domain.waves();
    const fresh = newWave(waves);
    const start = optionalString(args, 'start') ?? fresh.startDate;
    const end = optionalString(args, 'end') ?? defaultEnd(start, fresh.endDate);
    if (!isDay(start) || !isDay(end)) {
      return { content: 'Dates are `YYYY-MM-DD`.', isError: true };
    }
    const wave: Wave = {
      ...fresh,
      name: requireString(args, 'name'),
      goal: optionalString(args, 'goal') ?? '',
      startDate: start,
      endDate: end,
    };
    ctx.domain.addWave(wave);
    return { content: `Opened W${wave.number} “${wave.name}” (${wave.startDate} → ${wave.endDate}).` };
  });

/** Change a wave. */
const waveUpdate: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const ref = requireString(args, 'wave');
    const wave = waveFor(ref, ctx.domain.waves());
    if (!wave) {
      return { content: `No wave matches “${ref}”.`, isError: true };
    }
    const patch: Partial<Wave> = {};
    const name = optionalString(args, 'name');
    if (name) patch.name = name;
    const goal = optionalString(args, 'goal');
    if (goal !== undefined) patch.goal = goal;
    for (const key of ['start', 'end'] as const) {
      const day = optionalString(args, key);
      if (day === undefined) continue;
      if (!isDay(day)) return { content: `${key} is \`YYYY-MM-DD\`.`, isError: true };
      if (key === 'start') patch.startDate = day;
      else patch.endDate = day;
    }
    if (Object.keys(patch).length === 0) {
      return { content: `Nothing to change on W${wave.number}.`, isError: true };
    }
    ctx.domain.patchWave(wave.id, patch);
    return { content: `Updated W${wave.number} (${Object.keys(patch).join(', ')}).` };
  });

/** List the machines a job can run on. */
const targetSearch: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const query = optionalString(args, 'query')?.toLowerCase();
    const targets = ctx.domain
      .targets()
      .filter(
        (target) =>
          !query ||
          `${target.name} ${target.host} ${target.kind} ${target.summary}`.toLowerCase().includes(query),
      );
    if (targets.length === 0) {
      return { content: 'No targets matched. Add one under Compute → Targets first.', isError: true };
    }
    return {
      content: targets
        .slice(0, 50)
        .map(
          (target) =>
            `${target.id} [${target.readiness}] ${target.name}: ${target.kind} · ${target.host}${target.gpus ? ` · ${target.gpus}` : ''}`,
        )
        .join('\n'),
    };
  });

/** Queue a compute job. */
const jobCreate: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const targets = ctx.domain.targets();
    const ref = optionalString(args, 'target');
    const target = ref
      ? targets.find(
          (candidate) => candidate.id === ref || candidate.name.toLowerCase() === ref.toLowerCase(),
        )
      : targets[0];
    const job = newJob({
      name: requireString(args, 'name'),
      command: requireString(args, 'command'),
      targetId: target?.id ?? '',
      objective: optionalString(args, 'objective'),
    });
    ctx.domain.addJob(job);
    return {
      content: `Queued ${job.id} “${job.name}”${target ? ` on ${target.name}` : ' with no target set'}.`,
    };
  });

/** Find experiments already in the ledger. */
const experimentSearch: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const query = optionalString(args, 'query')?.toLowerCase();
    const outcome = optionalString(args, 'outcome');
    const domainQuery = optionalString(args, 'domain')?.toLowerCase();
    const domains = ctx.domain.domains();
    const items = ctx.domain.experiments().filter((experiment) => {
      if (outcome && experiment.outcome !== outcome) {
        return false;
      }
      if (domainQuery) {
        const domain = domains.find((candidate) => candidate.id === experiment.domainId);
        if (!`${domain?.id ?? ''} ${domain?.name ?? ''}`.toLowerCase().includes(domainQuery)) {
          return false;
        }
      }
      if (!query) {
        return true;
      }
      return `${experiment.id} ${experiment.objective} ${experiment.hypothesis} ${experiment.lesson}`
        .toLowerCase()
        .includes(query);
    });
    if (items.length === 0) {
      return { content: 'No experiments matched.' };
    }
    return {
      content: items
        .slice(0, 50)
        .map((experiment) => `${experiment.id} [${experiment.outcome}] ${experiment.objective}`)
        .join('\n'),
    };
  });

/** Record an experiment in the ledger. */
const experimentCreate: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const domainQuery = optionalString(args, 'domain')?.toLowerCase();
    const domain = domainQuery
      ? ctx.domain
          .domains()
          .find(
            (candidate) =>
              candidate.id.toLowerCase() === domainQuery || candidate.name.toLowerCase() === domainQuery,
          )
      : undefined;
    const checks = Array.isArray(args.checks)
      ? (args.checks as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    const experiment = ctx.domain.createExperiment({
      objective: requireString(args, 'objective'),
      hypothesis: optionalString(args, 'hypothesis') ?? '',
      design: optionalString(args, 'design') ?? '',
      designKind: optionalString(args, 'design_kind') ?? domain?.name ?? '',
      ...(domain ? { domainId: domain.id } : {}),
      checks,
    });
    // File the experiment under the session that made it, so the ledger and the AI page agree.
    if (ctx.sessionId && ctx.domain.linkExperiment) {
      ctx.domain.linkExperiment(ctx.sessionId, experiment.id);
    }
    return {
      content: `Created ${experiment.id}: ${experiment.objective}${domain ? ` (domain: ${domain.name})` : ''}. Log trials with experiment_log_trial; set the outcome with experiment_set_outcome.`,
    };
  });

/** Log one trial of an experiment. */
const experimentLogTrial: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const id = requireString(args, 'experiment');
    const params =
      typeof args.params === 'object' && args.params !== null
        ? (args.params as Record<string, unknown>)
        : undefined;
    const ok = ctx.domain.logTrial(id, {
      run: optionalString(args, 'run') ?? `T${Date.now() % 1000}`,
      condition: requireString(args, 'condition'),
      metric: optionalString(args, 'metric') ?? '',
      result: optionalString(args, 'result') ?? '',
      status: 'done',
      ...(params ? { params } : {}),
    });
    return ok ? { content: `Logged a trial on ${id}.` } : { content: `No experiment ${id}.`, isError: true };
  });

/** Record an experiment's outcome. */
const experimentSetOutcome: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const id = requireString(args, 'experiment');
    const experiment = experimentById(id);
    if (!experiment) {
      return { content: `No experiment ${id}.`, isError: true };
    }
    if (!experiment.preregistration) {
      return {
        content: `Experiment ${id} has no locked pre-registration. An outcome recorded without a plan is a story, not a test; lock one with experiment_preregister first.`,
        isError: true,
      };
    }
    const outcome = requireString(args, 'outcome') as ExperimentOutcome;
    const ok = ctx.domain.setOutcome(id, outcome, optionalString(args, 'summary'));
    return ok ? { content: `${id} marked ${outcome}.` } : { content: `No experiment ${id}.`, isError: true };
  });

/** Lock the plan before the data is looked at. */
const experimentPreregister: ToolExecutor = (args) =>
  guard(async () => {
    const id = requireString(args, 'experiment');
    const primaryOutcome = requireString(args, 'primary_outcome');
    const test = requireString(args, 'test');
    const hypothesis = requireString(args, 'hypothesis');
    const alpha = typeof args.alpha === 'number' ? args.alpha : 0.05;
    const alternative =
      args.alternative === 'greater' || args.alternative === 'less' ? args.alternative : 'two-sided';
    const plan: PreregistrationPlan = {
      hypothesis,
      primaryOutcome,
      test,
      alpha,
      alternative,
      exclusions: optionalString(args, 'exclusions') ?? '',
      stoppingRule: optionalString(args, 'stopping') ?? '',
      analysisNotes: optionalString(args, 'notes') ?? '',
    };
    const updated = await lockPreregistration(id, plan, 'agent');
    if (!updated?.preregistration) {
      return {
        content: `No experiment ${id}, or it already has a locked pre-registration. A locked plan cannot be replaced; record a deviation instead.`,
        isError: true,
      };
    }
    return {
      content: `Locked the pre-registration for ${id}. Procedure: ${plan.test}, alpha ${plan.alpha}, ${plan.alternative}. Signature ${updated.preregistration.hash.slice(0, 12)}….`,
    };
  });

/** Record a decision that departed from the locked plan. */
const experimentDeviation: ToolExecutor = (args) =>
  guard(async () => {
    const id = requireString(args, 'experiment');
    const decision = requireString(args, 'decision');
    const reason = requireString(args, 'reason');
    const phase = args.phase === 'before-results' ? 'before-results' : 'after-results';
    const ok = recordDeviation(id, { decision, reason, phase, by: 'agent' });
    return ok
      ? {
          content: `Recorded the deviation on ${id} (${phase}). It appears in the pre-registration report.`,
        }
      : {
          content: `No experiment ${id}, or it has no locked pre-registration to deviate from.`,
          isError: true,
        };
  });

/** List the experiment domains. */
const domainList: ToolExecutor = (_args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const domains = ctx.domain.domains();
    if (domains.length === 0) {
      return { content: 'No domains defined. Define one with domain_create.' };
    }
    return {
      content: domains
        .map(
          (domain) =>
            `${domain.id} (${domain.name}): ${domain.summary} (design: ${
              domain.fields.design.map((field) => field.key).join(', ') || '—'
            })`,
        )
        .join('\n'),
    };
  });

/** The fields a domain_create call declares. */
function fieldsArg(value: unknown): FieldDef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((raw, index) => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const key = typeof item.key === 'string' && item.key ? item.key : `field-${index + 1}`;
    const label = typeof item.label === 'string' && item.label ? item.label : key;
    const kind = (
      ['text', 'number', 'select', 'tags'].includes(String(item.kind)) ? item.kind : 'text'
    ) as FieldKind;
    const options = Array.isArray(item.options)
      ? item.options.filter((option): option is string => typeof option === 'string')
      : undefined;
    return { key, label, kind, ...(kind === 'select' && options ? { options } : {}) };
  });
}

/** Define an experiment domain. */
const domainCreate: ToolExecutor = (args, ctx) =>
  guard(async () => {
    if (!ctx.domain) {
      return { content: NO_DOMAIN, isError: true };
    }
    const name = requireString(args, 'name');
    const domain: ExperimentDomain = {
      id: `domain-${crypto.randomUUID().slice(0, 8)}`,
      name,
      summary: optionalString(args, 'summary') ?? '',
      mark: 'check',
      builtIn: false,
      fields: { design: fieldsArg(args.design_fields), trial: fieldsArg(args.trial_fields), metrics: [] },
    };
    ctx.domain.createDomain(domain);
    return { content: `Defined domain “${name}”.` };
  });

/** Every executor, one per tool. */
export const TOOL_EXECUTORS: Record<AgentToolId, ToolExecutor> = {
  read_file: readFile,
  write_file: writeFile,
  list_dir: listDir,
  glob,
  grep,
  knowledge,
  run_command: runCommand,
  fetch_url: fetchUrl,
  skill,
  plan_update: planUpdate,
  session_title: sessionTitle,
  split_session: splitSession,
  tool_search: toolSearch,
  task,
  task_create: taskCreate,
  task_search: taskSearch,
  task_update: taskUpdate,
  wave_list: waveList,
  wave_create: waveCreate,
  wave_update: waveUpdate,
  target_search: targetSearch,
  job_create: jobCreate,
  statistics,
  science_search: scienceSearch,
  science_fetch: scienceFetch,
  list_databases: listDatabases,
  query_database: queryDatabase,
  run_review: runReviewTool,
  scan_pdf: scanPdf,
  search_library: searchLibrary,
  experiment_search: experimentSearch,
  experiment_create: experimentCreate,
  experiment_log_trial: experimentLogTrial,
  experiment_set_outcome: experimentSetOutcome,
  experiment_preregister: experimentPreregister,
  experiment_deviation: experimentDeviation,
  domain_list: domainList,
  domain_create: domainCreate,
};

/**
 * Describe a call in one line, for the transcript and the permission prompt.
 *
 * It reads from the raw arguments rather than the parsed ones so a malformed call still shows
 * what the model tried to do, which is the case where the description matters most.
 */
export function describeToolCall(call: ToolCall): string {
  const args = parseArguments(call.arguments);
  const text = (key: string): string | undefined =>
    typeof args[key] === 'string' ? (args[key] as string) : undefined;

  switch (call.name) {
    case 'read_file':
    case 'write_file':
    case 'list_dir':
      return text('path') ?? call.name;
    case 'glob':
      return text('pattern') ?? 'glob';
    case 'grep':
      return text('pattern') ?? 'grep';
    case 'knowledge':
      return text('page') ?? text('query') ?? text('action') ?? 'knowledge';
    case 'run_command':
      return text('command') ?? 'run_command';
    case 'fetch_url':
      return text('url') ?? 'fetch_url';
    case 'skill':
      return text('id') ?? 'skill';
    case 'tool_search':
      return text('query') ?? 'tool_search';
    case 'plan_update':
      return text('goal') ?? `${Array.isArray(args.steps) ? args.steps.length : 0} steps`;
    case 'session_title':
      return text('title') ?? 'session_title';
    case 'split_session':
      return text('title') ?? 'split_session';
    case 'task':
      return `${text('subagent_type') ?? '?'}: ${text('description') ?? text('prompt') ?? ''}`.trim();
    case 'task_create':
      return text('title') ?? 'task_create';
    case 'task_search':
      return text('query') ?? text('status') ?? 'task_search';
    case 'task_update':
      return text('task') ?? 'task_update';
    case 'target_search':
      return text('query') ?? 'target_search';
    case 'job_create':
      return `${text('name') ?? 'job'}: ${text('command') ?? ''}`.trim();
    case 'statistics':
      return text('test') ?? 'statistics';
    case 'science_search':
      return text('query') ?? 'science_search';
    case 'science_fetch':
      return `${text('source') ?? '?'}:${text('id') ?? '?'}`;
    case 'list_databases':
      return text('query') ?? 'list_databases';
    case 'query_database':
      return `${text('database') ?? '?'}: ${text('path') ?? ''}`.trim();
    case 'run_review':
      return text('question') ?? 'run_review';
    case 'scan_pdf':
      return text('doi') ?? text('recordId') ?? text('url') ?? text('path') ?? 'scan_pdf';
    case 'search_library':
      return text('query') ?? 'search_library';
    case 'experiment_search':
      return text('query') ?? text('outcome') ?? text('domain') ?? 'experiment_search';
    case 'experiment_create':
      return text('objective') ?? 'experiment_create';
    case 'experiment_log_trial':
      return `${text('experiment') ?? '?'}: ${text('condition') ?? ''}`.trim();
    case 'experiment_set_outcome':
      return `${text('experiment') ?? '?'} → ${text('outcome') ?? '?'}`;
    case 'experiment_preregister':
      return `${text('experiment') ?? '?'}: ${text('primary_outcome') ?? 'plan'}`;
    case 'experiment_deviation':
      return `${text('experiment') ?? '?'}: ${text('decision') ?? 'deviation'}`;
    case 'domain_list':
      return 'domain_list';
    case 'domain_create':
      return text('name') ?? 'domain_create';
    default:
      return call.name;
  }
}

/** Parse a tool call's argument string, returning an empty object when it is not usable. */
export function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** True when `raw` parses to a JSON object, so a truncated payload can be told apart. */
function isJsonObject(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** How a tool should shape a record list. CSV is the default: a header plus rows. */
function tabularFormat(args: Record<string, unknown>): TabularFormat {
  return args.format === 'json' || args.format === 'tsv' || args.format === 'toon' ? args.format : 'csv';
}

/** Quote one argument for a shell, so a value with a space is one argument. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run a tool an installed extension declared.
 *
 * The manifest's transport is the whole implementation: a GET against the service it names, a
 * program run in the workspace with the call's arguments appended, or a hand-off to an MCP
 * server. Every path says what it could not do — an extension that silently returned nothing
 * would be a capability the model believes it has.
 */
async function runExtensionTool(
  id: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const entry = findExtensionTool(id);
  if (!entry) {
    return { content: `No tool named \`${id}\` is available.`, isError: true };
  }

  // Declared inputs are checked before anything runs, so a missing argument is named.
  const missing = (entry.tool.input ?? [])
    .filter((field) => field.required && args[field.name] === undefined)
    .map((field) => field.name);
  if (missing.length > 0) {
    return { content: `${id} needs ${missing.join(', ')}.`, isError: true };
  }

  const transport = entry.tool.transport;
  const supplied = Object.entries(args).filter(([, value]) => value !== undefined && value !== null);

  try {
    if (transport.kind === 'http') {
      const url = new URL(transport.url);
      for (const [key, value] of supplied) url.searchParams.set(key, String(value));
      const headers: Record<string, string> = {};
      const vaultHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(transport.headers ?? {})) {
        const reference = /^\{\{credential:([a-z0-9]+(?:[._-][a-z0-9]+)*)\}\}$/.exec(value.trim());
        if (reference) {
          vaultHeaders[name] = extensionCredentialKey(entry.extensionId, reference[1]!);
        } else {
          headers[name] = value;
        }
      }
      const content = await ctx.host.fetchUrl(url.toString(), { headers, vaultHeaders });
      return { content: cap(content, outputLimit(entry.tool.id)) };
    }

    if (transport.kind === 'command') {
      const parts = [
        transport.command,
        ...(transport.args ?? []),
        ...supplied.map(([key, value]) => `--${key}=${shellQuote(String(value))}`),
      ];
      const result = await ctx.host.runCommand(parts.join(' '));
      const text = result.exitCode === 0 ? result.output : `${result.output}\n(exit ${result.exitCode})`;
      return { content: cap(text, TOOL_LIMITS.run_command), isError: result.exitCode !== 0 };
    }

    return {
      content: `${entry.tool.id} is served by the MCP server “${transport.server}”, which this build declares but does not start. Start the server, then call again.`,
      isError: true,
    };
  } catch (error) {
    return {
      content: `${id} could not run: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/**
 * Run a tool a running MCP server offers.
 *
 * The server is the implementation; this only carries the arguments across and turns the
 * answer into a result the loop already understands.
 */
async function runMcpTool(id: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = findMcpTool(id);
  if (!tool) {
    return { content: `No tool named \`${id}\` is available.`, isError: true };
  }
  if (!ctx.host.mcpCall) {
    return {
      content: `${id} is served by ${tool.server}, which only the desktop app can start.`,
      isError: true,
    };
  }
  try {
    const result = await ctx.host.mcpCall(tool.server, tool.name, args);
    return { content: cap(result.text, outputLimit(id)), isError: result.isError };
  } catch (error) {
    return {
      content: `${id} could not run: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/** Execute one call against the registry, turning every failure into a result. */
export async function executeToolCall(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const tool = findTool(call.name);
  const executor = tool ? TOOL_EXECUTORS[tool.id as AgentToolId] : undefined;
  if (!tool) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: `No tool named \`${call.name}\` is available.`,
      isError: true,
    };
  }
  // Not one of ours: an installed extension or a running MCP server serves it.
  if (!executor) {
    const arguments_ = parseArguments(call.arguments);
    const outcome = findMcpTool(tool.id)
      ? await runMcpTool(tool.id, arguments_, ctx)
      : await runExtensionTool(tool.id, arguments_, ctx);
    return {
      toolCallId: call.id,
      name: call.name,
      content: outcome.content,
      isError: outcome.isError ?? false,
    };
  }
  // A call whose arguments are not valid JSON must not run: the executor would see an empty
  // object and blame a missing argument that the model did send. Say what actually happened,
  // because a truncated payload is the usual cause and the fix is to write less at once.
  if (call.arguments.trim().length > 0 && !isJsonObject(call.arguments)) {
    return {
      toolCallId: call.id,
      name: call.name,
      content:
        'This call did not run: its arguments were not valid JSON, which usually means the payload was cut off. Write a smaller file, or split it into parts, and try again.',
      isError: true,
    };
  }
  const outcome = await executor(parseArguments(call.arguments), ctx);
  return {
    toolCallId: call.id,
    name: call.name,
    // The budget is applied once, at the boundary, so no executor can forget it.
    content: cap(outcome.content, outputLimit(tool.id)),
    isError: outcome.isError ?? false,
  };
}
