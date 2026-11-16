/**
 * The agent's tool inventory.
 *
 * This module is the single place that says what an agent can do, what each action touches
 * and which domain pack unlocks it. Visibility is derived from here rather than discovered
 * at runtime, so a session can never call a tool the workbench did not open: a pack the user
 * has not enabled adds nothing to the model's surface.
 *
 * `scope: 'core'` is available to every session, subject to the permission gate; any other
 * scope names the pack that owns the tool. Execution lands with the run loop; what matters
 * here is ownership, because it is what makes pack gating and subagent assignment meaningful.
 */

import { extensionTools, findExtensionTool } from '@/lib/extensions/registry';
import { findMcpTool, mcpToolId, mcpTools, type McpToolDef } from '@/lib/mcp/registry';
import type { PackId } from './packs';

/** Every agent tool openlab knows. Referenced by {@link AgentTool.id}. */
export type AgentToolId =
  | 'read_file'
  | 'list_dir'
  | 'glob'
  | 'grep'
  | 'knowledge'
  | 'write_file'
  | 'run_command'
  | 'fetch_url'
  | 'skill'
  | 'task'
  | 'plan_update'
  | 'session_title'
  | 'split_session'
  | 'tool_search'
  | 'task_create'
  | 'task_search'
  | 'task_update'
  | 'wave_list'
  | 'wave_create'
  | 'wave_update'
  | 'target_search'
  | 'job_create'
  | 'statistics'
  | 'science_search'
  | 'science_fetch'
  | 'list_databases'
  | 'query_database'
  | 'run_review'
  | 'scan_pdf'
  | 'search_library'
  | 'experiment_search'
  | 'experiment_create'
  | 'experiment_log_trial'
  | 'experiment_set_outcome'
  | 'experiment_preregister'
  | 'experiment_deviation'
  | 'domain_list'
  | 'domain_create';

/**
 * Any tool id: the ones openlab ships, plus whatever an installed extension contributes.
 *
 * The literal union is what keeps autocomplete and exhaustiveness working for the built-ins;
 * the open string is what lets a manifest add a tool without a build step.
 */
export type ToolId = AgentToolId | (string & {});

/** What a tool is allowed to touch, read by the permission gate and the model brief. */
export interface ToolEffects {
  /** Reads from the workspace or the network but changes nothing. */
  readOnly: boolean;
  /** Reaches the network. */
  network: boolean;
  /** Writes files inside the workspace. */
  writes: boolean;
  /** Runs an external process. */
  executes: boolean;
}

/** One action the agent can take. */
export interface AgentTool {
  id: ToolId;
  /** The name the model calls. Snake case so it reads like a function. */
  name: string;
  /** One line the model reads to decide when to reach for it. */
  summary: string;
  /** `core` is always available; otherwise the pack that owns the tool. */
  scope: 'core' | PackId;
  effects: ToolEffects;
  /**
   * Ask the reader before running, even though nothing on disk changes.
   *
   * The gate exists for changes; a call that only rearranges the session is still the reader's
   * decision, so it says so here rather than borrowing `writes` and misdescribing itself.
   */
  confirm?: boolean;
}

/** Read a file from the workspace. */
const readFile: AgentTool = {
  id: 'read_file',
  name: 'read_file',
  summary: 'Read a UTF-8 text file from the workspace.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** List a directory. */
const listDir: AgentTool = {
  id: 'list_dir',
  name: 'list_dir',
  summary: 'List the entries of a directory in the workspace.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Find files by glob pattern. */
const glob: AgentTool = {
  id: 'glob',
  name: 'glob',
  summary: 'Find files by glob pattern, newest first.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Search file contents. */
const grep: AgentTool = {
  id: 'grep',
  name: 'grep',
  summary: 'Search file contents by regular expression and return matching lines.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/**
 * Read the workspace's OpenWiki.
 *
 * The wiki under `openwiki/` is the project's own account of itself, so it is the cheapest
 * way to learn how a workspace is organised before reading the code around it.
 */
const knowledge: AgentTool = {
  id: 'knowledge',
  name: 'knowledge',
  summary:
    'Read the workspace OpenWiki: the linked Markdown under `openwiki/`. List the pages, search them, or read one by name.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Write a file. */
const writeFile: AgentTool = {
  id: 'write_file',
  name: 'write_file',
  summary:
    'Write a UTF-8 text file inside the workspace, creating parents as needed. The path is relative to the workspace root, which openlab supplies. Pass a short relative path, and note that argument order does not matter.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: true, executes: false },
};

/** Run a shell command. */
const runCommand: AgentTool = {
  id: 'run_command',
  name: 'run_command',
  summary: 'Run a shell command in the workspace and return its output.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: true, executes: true },
};

/** Fetch a URL. */
const fetchUrl: AgentTool = {
  id: 'fetch_url',
  name: 'fetch_url',
  summary: 'Fetch a URL and return its body as text.',
  scope: 'core',
  effects: { readOnly: true, network: true, writes: false, executes: false },
};

/** Load a procedure. */
const skill: AgentTool = {
  id: 'skill',
  name: 'skill',
  summary:
    'Load a named procedure before following it. `openui-guide` is the interface language, needed before writing an openui-lang block.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/**
 * Delegate a bounded piece of work.
 *
 * This is the lead's tool and only the lead's: a worker's surface never includes it, so a
 * delegated task cannot re-delegate. It asks for no permission itself — the tools the worker
 * uses are what the gate sees.
 */
/** Find the tools a piece of work needs, before delegating it. */
const toolSearch: AgentTool = {
  id: 'tool_search',
  name: 'tool_search',
  summary:
    'Find the tools a piece of work needs, with what each one touches and the pack that owns it. Use it before delegating, so a worker gets the narrowest set rather than the whole workbench.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Replace the plan the reader sees above the composer. */
const planUpdate: AgentTool = {
  id: 'plan_update',
  name: 'plan_update',
  summary:
    'Write or update the session plan: the goal and the steps, with each step pending, active, done or skipped. It is shown above the composer as the work runs.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Name the session, once the work is clear. */
const sessionTitle: AgentTool = {
  id: 'session_title',
  name: 'session_title',
  summary:
    'Name this session with a short title the reader will recognise. Use it once, when the session is still untitled and you know what the work is.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Open a separate session when the reader turns to a different job. */
const splitSession: AgentTool = {
  id: 'split_session',
  name: 'split_session',
  summary:
    'Start a separate session for work that shares nothing with this one, and run the prompt there, so the two do not share a context.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
  confirm: true,
};

const task: AgentTool = {
  id: 'task',
  name: 'task',
  summary:
    'Delegate a bounded, independent piece of work to a worker with a specific set of domain packs, and get its handoff back.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/*
 * The app's own records. These do not touch the filesystem or the network; they read and
 * write the workspace's tracker and compute ledger, which is why their effects are neutral.
 */

/** Record a task in the tracker. */
const taskCreate: AgentTool = {
  id: 'task_create',
  name: 'task_create',
  summary:
    'Open a task in the workspace tracker before work that takes more than a step or two, so what it produces has somewhere to live.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Find tasks already in the tracker. */
const taskSearch: AgentTool = {
  id: 'task_search',
  name: 'task_search',
  summary: 'Find tasks in the workspace tracker by text or status, before creating one.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Find experiments already in the ledger. */
const experimentSearch: AgentTool = {
  id: 'experiment_search',
  name: 'experiment_search',
  summary: 'Find experiments in the ledger by text, outcome or domain, before creating one.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Record an experiment in the ledger. */
const experimentCreate: AgentTool = {
  id: 'experiment_create',
  name: 'experiment_create',
  summary:
    'Record an experiment: its question, hypothesis, design and the checks planned before it ran. The success criterion and trials follow.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Log one trial of an experiment. */
const experimentLogTrial: AgentTool = {
  id: 'experiment_log_trial',
  name: 'experiment_log_trial',
  summary: 'Log one trial of an experiment: what was varied, what was measured, and what came back.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Record an experiment's outcome. */
const experimentSetOutcome: AgentTool = {
  id: 'experiment_set_outcome',
  name: 'experiment_set_outcome',
  summary: 'Record an experiment outcome (supported, refuted or inconclusive) with its summary.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Lock the hypothesis and the analysis plan before the data is looked at. */
const experimentPreregister: AgentTool = {
  id: 'experiment_preregister',
  name: 'experiment_preregister',
  summary:
    "Lock an experiment's hypothesis, primary outcome, procedure, alpha, exclusions and stopping rule before analyzing it. A locked plan cannot be replaced; record a deviation instead.",
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Record a decision that departed from the locked plan. */
const experimentDeviation: AgentTool = {
  id: 'experiment_deviation',
  name: 'experiment_deviation',
  summary:
    'Record a decision that departed from a locked pre-registration, with its reason and whether it was made before or after the results.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** List the experiment domains. */
const domainList: AgentTool = {
  id: 'domain_list',
  name: 'domain_list',
  summary: 'List the experiment domains a new experiment can be filed under.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Define an experiment domain. */
const domainCreate: AgentTool = {
  id: 'domain_create',
  name: 'domain_create',
  summary: 'Define an experiment domain with its own design and trial fields.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Change a task already in the tracker. */
const taskUpdate: AgentTool = {
  id: 'task_update',
  name: 'task_update',
  summary:
    'Move a tracked task along, attach what the work produced (evidence: kind, title, path or id), or leave a note on it.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** List the waves a workspace plans in. */
const waveList: AgentTool = {
  id: 'wave_list',
  name: 'wave_list',
  summary:
    'List the waves the workspace plans in: the bounded stretches of work, with their dates, goals and what they carry.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Open a wave. */
const waveCreate: AgentTool = {
  id: 'wave_create',
  name: 'wave_create',
  summary:
    'Open a wave: a stretch of work with a start, an end and a goal. Plan tasks into it rather than leaving them loose.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Change a wave. */
const waveUpdate: AgentTool = {
  id: 'wave_update',
  name: 'wave_update',
  summary: "Change a wave's name, dates or goal, or close it.",
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Find a machine a job can run on. */
const targetSearch: AgentTool = {
  id: 'target_search',
  name: 'target_search',
  summary: 'List the compute targets a job can be sent to, with their readiness and hardware.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Queue a compute job. */
const jobCreate: AgentTool = {
  id: 'job_create',
  name: 'job_create',
  summary: 'Queue a compute job for a command on a target, recording it in the ledger.',
  scope: 'core',
  effects: { readOnly: false, network: false, writes: false, executes: false },
};

/** Compute a statistic. */
const statistics: AgentTool = {
  id: 'statistics',
  name: 'statistics',
  summary: 'Run a statistical procedure and return the result with reproducible R and Python.',
  scope: 'ml',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/** Search public research databases. */
const scienceSearch: AgentTool = {
  id: 'science_search',
  name: 'science_search',
  summary: 'Search the public research databases a stream of work needs.',
  scope: 'genomics',
  effects: { readOnly: true, network: true, writes: false, executes: false },
};

/** Fetch a record from a research database. */
const scienceFetch: AgentTool = {
  id: 'science_fetch',
  name: 'science_fetch',
  summary: 'Fetch one record from a research database by its identifier.',
  scope: 'genomics',
  effects: { readOnly: true, network: true, writes: false, executes: false },
};

/** List the databases in the workbench catalogue. */
const listDatabases: AgentTool = {
  id: 'list_databases',
  name: 'list_databases',
  summary: 'List the databases in the workbench catalogue: their id, family, access and state.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/**
 * Query a catalogue database.
 *
 * The catalogue (OpenAlex, PubMed, UniProt, RCSB PDB, ChEMBL, PubChem, Ensembl) is the same
 * list the Library screens show, so a request the agent runs is one the user can open and
 * repeat from the interface.
 */
const queryDatabase: AgentTool = {
  id: 'query_database',
  name: 'query_database',
  summary:
    'Run a request against a database in the catalogue and return its records. Pass the database id (see list_databases) and optionally a path such as `/works?search=CRISPR&per-page=5`.',
  scope: 'core',
  effects: { readOnly: true, network: true, writes: false, executes: false },
};

/**
 * Start a systematic review.
 *
 * The review runs in the background — retrieve, screen, extract, report — and lands in the
 * Reviews surface, so the agent starts the work and the reader can follow it there.
 */
const runReview: AgentTool = {
  id: 'run_review',
  name: 'run_review',
  summary:
    'Start a systematic literature review in the background against the saved sources: retrieve, screen and extract records, then write a report. Returns the review id.',
  scope: 'core',
  effects: { readOnly: false, network: true, writes: false, executes: false },
};

/**
 * Scan a PDF into the local full-text index.
 *
 * The name is deliberate: this is not an OCR tool — the worker decides how to read the
 * file (Surya, pdftotext or PyMuPDF) and what the record is (an open-access lookup, a
 * direct URL, or a file already in the workspace).
 */
const scanPdf: AgentTool = {
  id: 'scan_pdf',
  name: 'scan_pdf',
  summary:
    'Index a paper’s PDF for full-text search: give a `doi`, a `recordId`, a `url`, or a workspace `path`. Downloads the open-access copy when needed, then the text is searchable with search_library.',
  scope: 'core',
  effects: { readOnly: false, network: true, writes: false, executes: false },
};

/** Search the scanned PDFs. */
const searchLibrary: AgentTool = {
  id: 'search_library',
  name: 'search_library',
  summary:
    'Search the full text of the PDFs that have been scanned, and get the passage and page that matched. Use scan_pdf first for papers that are not indexed yet.',
  scope: 'core',
  effects: { readOnly: true, network: false, writes: false, executes: false },
};

/**
 * Every tool, in the order the model's brief should read.
 *
 * The two science tools appear under one scope for the inventory, but a pack grants a tool
 * by id — see {@link PACK_TOOL_OVERRIDES} — so the tool is not limited to its home scope.
 */
export const AGENT_TOOLS: readonly AgentTool[] = [
  readFile,
  listDir,
  glob,
  grep,
  knowledge,
  writeFile,
  runCommand,
  fetchUrl,
  skill,
  task,
  planUpdate,
  sessionTitle,
  splitSession,
  toolSearch,
  taskCreate,
  taskSearch,
  taskUpdate,
  waveList,
  waveCreate,
  waveUpdate,
  targetSearch,
  jobCreate,
  statistics,
  scienceSearch,
  scienceFetch,
  listDatabases,
  queryDatabase,
  runReview,
  scanPdf,
  searchLibrary,
  experimentSearch,
  experimentCreate,
  experimentLogTrial,
  experimentSetOutcome,
  experimentPreregister,
  experimentDeviation,
  domainList,
  domainCreate,
];

/** The tools available to every session, before any pack is considered. */
export const CORE_TOOL_IDS: readonly ToolId[] = AGENT_TOOLS.filter((tool) => tool.scope === 'core').map(
  (tool) => tool.id,
);

/**
 * Extra tools a pack grants beyond the tools whose home scope it is.
 *
 * The science tools are cross-domain: a transcriptomics session needs them even though the
 * inventory files them under genomics, and the point of a pack is to say which streams of
 * work are open rather than to own a tool exclusively. Keeping the grants here means a pack
 * and its tools cannot drift apart in two files.
 */
export const PACK_TOOL_OVERRIDES: Partial<Record<PackId, readonly ToolId[]>> = {
  genomics: ['science_search', 'science_fetch', 'statistics'],
  molecular: ['science_search', 'science_fetch'],
  ml: ['statistics'],
  'structural-biology': ['science_search', 'science_fetch'],
  cheminformatics: ['science_search', 'science_fetch', 'statistics'],
  proteomics: ['science_search', 'science_fetch', 'statistics'],
  transcriptomics: ['science_search', 'science_fetch', 'statistics'],
  imaging: ['statistics'],
  epidemiology: ['science_search', 'statistics'],
};

/**
 * An extension's tool, as the inventory describes it.
 *
 * The manifest is the definition; this is the same thing in the shape the runtime already
 * reads, with the extension's own id as the tool's scope — which is what makes an installed
 * pack gate its tools exactly like a built-in one.
 */
function fromExtension(
  extensionId: string,
  tool: ReturnType<typeof extensionTools>[number]['tool'],
): AgentTool {
  return {
    id: tool.id,
    name: tool.id,
    summary: tool.summary,
    scope: extensionId,
    effects: {
      readOnly: tool.effects?.readOnly ?? false,
      network: tool.effects?.network ?? false,
      writes: tool.effects?.writes ?? false,
      executes: tool.effects?.executes ?? false,
    },
  };
}

/** An MCP server's tool, as the inventory describes it. */
function fromMcpTool(tool: McpToolDef): AgentTool {
  return {
    id: mcpToolId(tool.server, tool.name),
    name: mcpToolId(tool.server, tool.name),
    summary: tool.description,
    scope: tool.server,
    effects: tool.effects,
  };
}

/** Look a tool up by id: the built-ins, an installed extension, then a running MCP server. */
export function findTool(id: ToolId): AgentTool | undefined {
  const builtIn = AGENT_TOOLS.find((tool) => tool.id === id);
  if (builtIn) return builtIn;
  const installed = findExtensionTool(id);
  if (installed) return fromExtension(installed.extensionId, installed.tool);
  const served = findMcpTool(id);
  return served ? fromMcpTool(served) : undefined;
}

/** Every tool available in this build: the inventory plus the enabled extensions'. */
export function allTools(): AgentTool[] {
  const seen = new Set<ToolId>(AGENT_TOOLS.map((tool) => tool.id));
  const installed = extensionTools().flatMap((entry) => {
    // A shipped tool always wins; an extension cannot take its name or widen its effects.
    if (seen.has(entry.tool.id)) return [];
    seen.add(entry.tool.id);
    return [fromExtension(entry.extensionId, entry.tool)];
  });
  const served = mcpTools().flatMap((tool) => {
    const id = mcpToolId(tool.server, tool.name);
    if (seen.has(id)) return [];
    seen.add(id);
    return [fromMcpTool(tool)];
  });
  return [...AGENT_TOOLS, ...installed, ...served];
}
