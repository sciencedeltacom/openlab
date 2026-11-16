/**
 * The model-facing schema for every tool.
 *
 * A description says when to reach for a tool; a schema says what arguments it accepts. Both
 * are part of the prompt, so they are written for a model to read rather than for a type to
 * check: the descriptions stay short, and each schema forbids additional properties so a
 * model that guesses a field is told rather than silently ignored.
 *
 * The schema is the contract the loop validates against before an executor runs, which is why
 * it lives with the inventory rather than inside the executor.
 */

import { findExtensionTool } from '@/lib/extensions/registry';
import { findMcpTool } from '@/lib/mcp/registry';
import { findTool, type AgentToolId, type ToolId } from './tools';
import { PREREG_TESTS } from '@/components/experiments/preregistration';
import type { ToolSpec } from './transcript';

/** A single required path argument. */
function pathInput(description: string, required = true): Record<string, unknown> {
  return {
    type: 'object',
    properties: { path: { type: 'string', description } },
    required: required ? ['path'] : [],
    additionalProperties: false,
  };
}

/** The schemas, keyed by tool id. */
const SPECS: Record<AgentToolId, ToolSpec> = {
  read_file: {
    name: 'read_file',
    description:
      'Read a UTF-8 text file from the workspace and return its contents. For a long file, pass start_line and end_line and read the part you need rather than the whole file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file, relative to the workspace root (the root is supplied for you).',
        },
        start_line: { type: 'number', description: 'First line to return, 1-based.' },
        end_line: { type: 'number', description: 'Last line to return, inclusive.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  write_file: {
    name: 'write_file',
    description:
      'Write a UTF-8 text file inside the workspace, creating parent directories as needed. The workspace root is supplied for you, so pass a relative path (e.g. `results/table.csv`) rather than an absolute one; argument order does not matter.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root, e.g. `results/table.csv`.',
        },
        contents: { type: 'string', description: 'The full file contents.' },
      },
      required: ['path', 'contents'],
      additionalProperties: false,
    },
  },
  list_dir: {
    name: 'list_dir',
    description: 'List the entries of a workspace directory, directories first.',
    parameters: pathInput('Directory to list, relative to the workspace root; defaults to the root.', false),
  },
  glob: {
    name: 'glob',
    description: 'Find workspace files by glob pattern, newest first.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. `src/**/*.ts`.' },
        path: {
          type: 'string',
          description: 'Directory to search under, relative to the workspace root; defaults to the root.',
        },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  grep: {
    name: 'grep',
    description: 'Search workspace file contents by regular expression and return matching lines.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for.' },
        path: {
          type: 'string',
          description: 'Directory to search under, relative to the workspace root; defaults to the root.',
        },
        glob: { type: 'string', description: 'Restrict to files matching this glob.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  knowledge: {
    name: 'knowledge',
    description: 'Read the workspace OpenWiki.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'search', 'read'],
          description: '`list` every page, `search` their text, or `read` one page in full.',
        },
        query: { type: 'string', description: 'Search terms, for `search`.' },
        page: { type: 'string', description: 'Page id or title, for `read`, e.g. `architecture`.' },
        limit: { type: 'number', description: 'Maximum pages for `list`/`search`, default 20.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  run_command: {
    name: 'run_command',
    description: 'Run a shell command in the workspace and return its combined output and exit code.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run.' },
        cwd: { type: 'string', description: 'Working directory, relative to the workspace.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  fetch_url: {
    name: 'fetch_url',
    description: 'Fetch a URL with GET and return its body as text.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The absolute http(s) URL to fetch.' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  skill: {
    name: 'skill',
    description: 'Load a named procedure into context before following it.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Skill or recipe id.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  tool_search: {
    name: 'tool_search',
    description:
      'Find the tools a piece of work needs, with what each one touches and the pack that owns it. Search before delegating, then pass the exact ids to the `task` tool.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match against the tool id and its summary.' },
        limit: { type: 'number', description: 'Maximum tools to return, default 20.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  plan_update: {
    name: 'plan_update',
    description:
      'Write or replace the session plan shown above the composer. Use it for work past a step or two: state the goal, list the steps, and update each status as you go.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What the plan is for, in one line.' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'One line the reader can follow.' },
              status: {
                type: 'string',
                enum: ['pending', 'active', 'done', 'skipped'],
                description: 'Where this step stands; default pending.',
              },
            },
            required: ['title'],
          },
          description: 'The steps, in the order they will happen.',
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },
  session_title: {
    name: 'session_title',
    description:
      'Name this session with a short title the reader will recognise in the session list. Use it once, when the session is still untitled and you know what the work is. A named session is not renamed.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Three to six words, sentence case, no trailing period.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  split_session: {
    name: 'split_session',
    description:
      'Open a new session for a task that shares no work with this one (a different dataset, question or deliverable) and run `new_prompt` there, so the two do not share a context. The reader is asked before it happens: if they allow it, this turn finishes here and the new session starts working; if they decline, carry on in this one. A follow-up, a correction or the next step of the same job is not a split.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Three to six words naming the new work, sentence case, no trailing period.',
        },
        new_prompt: {
          type: 'string',
          description:
            'The prompt to run in the new session: the reader’s request restated so it stands on its own, with the files, constraints and deliverable it needs. Not “continue as before”.',
        },
        reason: {
          type: 'string',
          description: 'One line: why this is a separate job rather than a step of the current one.',
        },
      },
      required: ['title', 'new_prompt'],
      additionalProperties: false,
    },
  },
  task: {
    name: 'task',
    description:
      'Delegate a bounded, independent piece of work to a worker and get its handoff back. Give the worker the narrowest surface: call `tool_search` first and name the exact `tools` it needs, or a pack when the whole pack is the job. The worker gets only what is named, intersected with what the workbench has open.',
    parameters: {
      type: 'object',
      properties: {
        subagent_type: {
          type: 'string',
          description:
            'Which worker: explore, coding, literature, analyst, biologist, chemist, imager or epidemiologist.',
        },
        prompt: {
          type: 'string',
          description: 'The task, stated on its own so the worker needs nothing else.',
        },
        description: {
          type: 'string',
          description: 'A short label for the transcript.',
        },
        packs: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Domain packs to grant this worker, overriding the profile default. Only packs already open on the workbench take effect.',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description:
            "The exact tool ids this worker needs, from `tool_search`. When given, the worker gets those tools and nothing else; omit it only when the profile's packs are the right surface.",
        },
      },
      required: ['subagent_type', 'prompt'],
      additionalProperties: false,
    },
  },
  task_create: {
    name: 'task_create',
    description:
      'Record a task in the workspace tracker before starting work that takes more than a step or two, so what it produced has somewhere to live.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'One line naming the task.' },
        description: { type: 'string', description: 'What the task involves, in a sentence or two.' },
        kind: {
          type: 'string',
          enum: ['analysis', 'experiment', 'writing', 'review', 'data', 'engineering', 'admin'],
          description: 'What kind of work it is.',
        },
        status: {
          type: 'string',
          enum: ['backlog', 'planned', 'active', 'blocked', 'done', 'cancelled'],
          description: 'Where it starts; defaults to `backlog`.',
        },
        priority: { type: 'number', description: '0 none … 4 urgent.' },
        wave: {
          type: 'string',
          description:
            'The wave this work belongs to, by number (`3` or `W3`) or id. Use `wave_list` to see what is open.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  task_search: {
    name: 'task_search',
    description: 'Find tasks in the workspace tracker.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against a task key, title or description.' },
        status: {
          type: 'string',
          enum: ['backlog', 'planned', 'active', 'blocked', 'done', 'cancelled'],
          description: 'Restrict to one status.',
        },
      },
      additionalProperties: false,
    },
  },
  task_update: {
    name: 'task_update',
    description:
      'Change a tracked task, attach what it produced, or leave a note on it. This is how the work stays recorded: the task is the record, and the file it made belongs to it.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task key (e.g. `TASK-4`) or its id.' },
        title: { type: 'string', description: 'A new title.' },
        description: { type: 'string', description: 'A new description.' },
        evidence: {
          type: 'array',
          description:
            'Artefacts to attach to the task: the files, figures, datasets or jobs this work produced.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['dataset', 'figure', 'paper', 'run', 'notebook', 'code', 'protocol'],
                description: 'What kind of artefact it is.',
              },
              title: { type: 'string', description: 'What it is called, in a few words.' },
              ref: {
                type: 'string',
                description: 'Where it lives: a path relative to the workspace, a DOI, or a job id.',
              },
              verified: {
                type: 'boolean',
                description: 'True only when you opened or reran it in this turn.',
              },
            },
            required: ['kind', 'title', 'ref'],
          },
        },
        note: {
          type: 'string',
          description:
            'A line appended to the task as a comment, for a decision or a caveat that is not a status change.',
        },
        status: {
          type: 'string',
          enum: ['backlog', 'planned', 'active', 'blocked', 'done', 'cancelled'],
          description: 'A new status.',
        },
        priority: { type: 'number', description: '0 none … 4 urgent.' },
        wave: {
          type: 'string',
          description:
            'The wave to put this work in, by number (`3` or `W3`) or id; `none` takes it out of any wave.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  wave_list: {
    name: 'wave_list',
    description: 'List the waves the workspace plans in, with their dates, goals and what they carry.',
    parameters: {
      type: 'object',
      properties: {
        current: {
          type: 'boolean',
          description: 'True to list only the wave that contains today.',
        },
      },
      additionalProperties: false,
    },
  },
  wave_create: {
    name: 'wave_create',
    description:
      'Open a wave: a bounded stretch of work with a start, an end and a goal, which tasks are then planned into.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'One line naming the stretch, e.g. `Docking campaign`.' },
        goal: { type: 'string', description: 'What the stretch is for, in a sentence.' },
        start: { type: 'string', description: 'First day, `YYYY-MM-DD`; defaults to today.' },
        end: {
          type: 'string',
          description: 'Last day, `YYYY-MM-DD`; defaults to two weeks after the start.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  wave_update: {
    name: 'wave_update',
    description: "Change a wave's name, dates or goal.",
    parameters: {
      type: 'object',
      properties: {
        wave: { type: 'string', description: 'The wave number (`3` or `W3`) or its id.' },
        name: { type: 'string', description: 'A new name.' },
        goal: { type: 'string', description: 'A new goal.' },
        start: { type: 'string', description: 'A new first day, `YYYY-MM-DD`.' },
        end: { type: 'string', description: 'A new last day, `YYYY-MM-DD`.' },
      },
      required: ['wave'],
      additionalProperties: false,
    },
  },
  target_search: {
    name: 'target_search',
    description: 'List the compute targets a job can run on.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against a target name, host or kind.' },
      },
      additionalProperties: false,
    },
  },
  job_create: {
    name: 'job_create',
    description: 'Queue a compute job in the ledger.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'One line naming the run.' },
        command: { type: 'string', description: 'The command the run executes.' },
        target: { type: 'string', description: 'Target id or name; defaults to the first target.' },
        objective: { type: 'string', description: 'One sentence on what the run is for.' },
      },
      required: ['name', 'command'],
      additionalProperties: false,
    },
  },
  statistics: {
    name: 'statistics',
    description: 'Run a statistical procedure and return the result with R and Python that recompute it.',
    parameters: {
      type: 'object',
      properties: {
        test: {
          type: 'string',
          enum: [
            'descriptives',
            'welch-t-test',
            'paired-t-test',
            'one-sample-t-test',
            'one-way-anova',
            'chi-square',
            'pearson-correlation',
            'linear-regression',
          ],
          description: 'Which procedure to run.',
        },
        a: { type: 'array', items: { type: 'number' }, description: 'First sample or outcome.' },
        b: { type: 'array', items: { type: 'number' }, description: 'Second sample, when paired.' },
        groups: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Groups for a one-way ANOVA or a contingency table.',
        },
        confidence: { type: 'number', description: 'Confidence level, default 0.95.' },
        alternative: {
          type: 'string',
          enum: ['two-sided', 'greater', 'less'],
          description: 'Which side the p-value covers.',
        },
        experiment: {
          type: 'string',
          description:
            'The experiment this analysis belongs to. When set, the run is checked against its locked pre-registration.',
        },
        deviation_reason: {
          type: 'string',
          description:
            'Why this run departs from the planned procedure. Required when it does; recorded as a deviation.',
        },
      },
      required: ['test'],
      additionalProperties: false,
    },
  },
  science_search: {
    name: 'science_search',
    description: 'Search the public research databases a stream of work needs and return normalised records.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms.' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Connector ids to search; defaults to the enabled packs’ sources.',
        },
        limit: { type: 'number', description: 'Maximum records to return, default 10.' },
        format: {
          type: 'string',
          enum: ['csv', 'tsv', 'toon', 'json'],
          description:
            'How to shape the records. `csv` (default) is a header plus rows; `json` only when a nested value must stay structured.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  science_fetch: {
    name: 'science_fetch',
    description: 'Fetch one record from a research database by its identifier.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Connector id, e.g. `pubmed`.' },
        id: { type: 'string', description: 'The record identifier.' },
      },
      required: ['source', 'id'],
      additionalProperties: false,
    },
  },
  list_databases: {
    name: 'list_databases',
    description: 'List the databases in the workbench catalogue.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to filter by, over name, family and what it holds.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  query_database: {
    name: 'query_database',
    description:
      'Run a request against a database in the catalogue and return its records. Call list_databases first to get an id.',
    parameters: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database id, e.g. `openalex` or `uniprot`.' },
        path: {
          type: 'string',
          description:
            'Request path, e.g. `/works?search=CRISPR&per-page=5`; defaults to the database’s own.',
        },
        method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method, default GET.' },
        body: { type: 'string', description: 'Request body, for a database that takes one.' },
        limit: { type: 'number', description: 'Maximum records to return, default 10.' },
        format: {
          type: 'string',
          enum: ['csv', 'tsv', 'toon', 'json'],
          description:
            'How to shape the records. `csv` (default) is a header plus rows; `json` only when a nested value must stay structured.',
        },
      },
      required: ['database'],
      additionalProperties: false,
    },
  },
  run_review: {
    name: 'run_review',
    description:
      'Start a systematic literature review in the background against the saved sources. It runs on its own and appears under Reviews.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The review question.' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Saved source ids to search; defaults to the first few.',
        },
        max_records: { type: 'number', description: 'How many records to retrieve and screen, default 24.' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  scan_pdf: {
    name: 'scan_pdf',
    description:
      'Index a paper’s PDF so its full text can be searched. Give one of `doi`, `recordId`, `url` (a PDF URL), or `path` (a file in the workspace).',
    parameters: {
      type: 'object',
      properties: {
        doi: { type: 'string', description: 'DOI of the paper, e.g. `10.1038/nature12373`.' },
        recordId: { type: 'string', description: 'Source record id, e.g. an OpenAlex work id `W123`.' },
        url: { type: 'string', description: 'Direct URL to a PDF.' },
        path: {
          type: 'string',
          description: 'A PDF or text file already in the workspace, relative to its root.',
        },
        docId: {
          type: 'string',
          description: 'Index the document under this id instead of the derived one.',
        },
        title: { type: 'string', description: 'The paper title, kept with the index row.' },
        force: { type: 'boolean', description: 'Re-scan even when the document is already indexed.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  search_library: {
    name: 'search_library',
    description: 'Search the full text of the scanned PDFs and return the matching passages with their page.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        limit: { type: 'number', description: 'Maximum hits, default 10.' },
        docIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict to these indexed documents.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  experiment_search: {
    name: 'experiment_search',
    description: 'Find experiments in the ledger by text, outcome or domain, before creating one.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match in the objective, hypothesis or lesson.' },
        outcome: {
          type: 'string',
          enum: ['running', 'supported', 'refuted', 'inconclusive'],
          description: 'Restrict to experiments with this outcome.',
        },
        domain: { type: 'string', description: 'Restrict to a domain, by name or id.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  experiment_create: {
    name: 'experiment_create',
    description:
      'Record an experiment: its question, hypothesis, design and the checks planned before it ran. Returns the experiment id for logging trials. The success criterion is set with `experiment_set_criterion` on the record.',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'What the experiment is for.' },
        hypothesis: { type: 'string', description: 'What is expected, and why.' },
        design: { type: 'string', description: 'How it will be run.' },
        domain: { type: 'string', description: 'The domain, by name or id; call `domain_list` first.' },
        design_kind: { type: 'string', description: 'A short label for the design kind.' },
        checks: {
          type: 'array',
          items: { type: 'string' },
          description: 'The checks planned before the run.',
        },
      },
      required: ['objective'],
      additionalProperties: false,
    },
  },
  experiment_log_trial: {
    name: 'experiment_log_trial',
    description: 'Log one trial of an experiment: what was varied, what was measured, and what came back.',
    parameters: {
      type: 'object',
      properties: {
        experiment: { type: 'string', description: 'The experiment id, e.g. `EXP-1A2B`.' },
        run: { type: 'string', description: 'The run label, e.g. `T3`; one is assigned when omitted.' },
        condition: { type: 'string', description: 'What was varied in this run.' },
        metric: { type: 'string', description: 'What was measured.' },
        result: { type: 'string', description: 'What came back.' },
        params: { type: 'object', description: 'Domain-specific run parameters.' },
      },
      required: ['experiment', 'condition'],
      additionalProperties: false,
    },
  },
  experiment_set_outcome: {
    name: 'experiment_set_outcome',
    description: 'Record an experiment outcome (supported, refuted or inconclusive) with a one-line summary.',
    parameters: {
      type: 'object',
      properties: {
        experiment: { type: 'string', description: 'The experiment id.' },
        outcome: {
          type: 'string',
          enum: ['supported', 'refuted', 'inconclusive', 'running'],
          description: 'How the experiment ended.',
        },
        summary: { type: 'string', description: 'One or two sentences on what the outcome rests on.' },
      },
      required: ['experiment', 'outcome'],
      additionalProperties: false,
    },
  },
  experiment_preregister: {
    name: 'experiment_preregister',
    description:
      "Lock an experiment's hypothesis and analysis plan before looking at the results. The plan is signed; later changes are deviations, not edits.",
    parameters: {
      type: 'object',
      properties: {
        experiment: { type: 'string', description: 'The experiment id.' },
        hypothesis: { type: 'string', description: 'The claim being tested, in one or two sentences.' },
        primary_outcome: { type: 'string', description: 'The one outcome the test is judged on.' },
        test: {
          type: 'string',
          enum: [...PREREG_TESTS],
          description: 'The statistical procedure decided in advance.',
        },
        alpha: { type: 'number', description: 'The threshold a p-value is judged against, default 0.05.' },
        alternative: {
          type: 'string',
          enum: ['two-sided', 'greater', 'less'],
          description: 'Which side the test covers.',
        },
        exclusions: {
          type: 'string',
          description: 'Which rows, subjects or runs are left out, and by what rule.',
        },
        stopping: { type: 'string', description: 'What would stop the run early.' },
        notes: {
          type: 'string',
          description: 'Covariates, transformations, corrections decided in advance.',
        },
      },
      required: ['experiment', 'hypothesis', 'primary_outcome', 'test'],
      additionalProperties: false,
    },
  },
  experiment_deviation: {
    name: 'experiment_deviation',
    description:
      'Record a decision that departed from a locked pre-registration, with the reason and when it was made.',
    parameters: {
      type: 'object',
      properties: {
        experiment: { type: 'string', description: 'The experiment id.' },
        decision: { type: 'string', description: 'What changed, e.g. `test: welch-t-test → one-way-anova`.' },
        reason: {
          type: 'string',
          description: 'Why it changed. A deviation without a reason is not a record.',
        },
        phase: {
          type: 'string',
          enum: ['before-results', 'after-results'],
          description: 'When the decision was made, relative to seeing the results.',
        },
      },
      required: ['experiment', 'decision', 'reason'],
      additionalProperties: false,
    },
  },
  domain_list: {
    name: 'domain_list',
    description: 'List the experiment domains a new experiment can be filed under, with their fields.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  domain_create: {
    name: 'domain_create',
    description:
      'Define an experiment domain with its own design and trial fields, so experiments can be shaped to a particular kind of work.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The domain name, e.g. `Genomics`.' },
        summary: { type: 'string', description: 'One line on what it studies.' },
        design_fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              kind: { type: 'string', enum: ['text', 'number', 'select', 'tags'] },
              options: { type: 'array', items: { type: 'string' } },
            },
            required: ['key', 'label'],
          },
          description: 'The fields the design form asks for.',
        },
        trial_fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              kind: { type: 'string', enum: ['text', 'number', 'select', 'tags'] },
            },
            required: ['key', 'label'],
          },
          description: 'The fields each trial’s params ask for.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
};

/**
 * The schema for a tool an extension contributed.
 *
 * The manifest's own `input` list is the schema, so a third party declares its arguments in
 * the same place it declares everything else — and the loop validates against it exactly as
 * it validates a built-in.
 */
function extensionSpec(id: string): ToolSpec | undefined {
  const entry = findExtensionTool(id);
  if (!entry) return undefined;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of entry.tool.input ?? []) {
    properties[field.name] = {
      type: field.type,
      ...(field.description ? { description: field.description } : {}),
    };
    if (field.required) required.push(field.name);
  }
  return {
    name: id,
    description: entry.tool.summary,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  };
}

/** The schema for a tool a running MCP server offers: the server published it. */
function mcpSpec(id: string): ToolSpec | undefined {
  const tool = findMcpTool(id);
  if (!tool) return undefined;
  return { name: id, description: tool.description, parameters: tool.inputSchema };
}

/** The schema for one tool, with its description carried on the inventory. */
export function specFor(id: ToolId): ToolSpec {
  const spec = SPECS[id as AgentToolId] ?? extensionSpec(id) ?? mcpSpec(id);
  const tool = findTool(id);
  if (!spec) {
    return {
      name: id,
      description: tool?.summary ?? id,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
    };
  }
  // The inventory is the single home for the wording; keep the two from drifting.
  return tool ? { ...spec, description: tool.summary } : spec;
}
