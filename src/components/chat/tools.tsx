/**
 * How each agent tool presents itself.
 *
 * A tool is not a JSON envelope and not a snake_case name read aloud. Each one carries a
 * display name, an icon for while it runs and another for when it is done, and a small
 * React body shaped to what it actually did — a file, a terminal, a listing. The raw input
 * is the fallback, not the default.
 */

import type { ReactNode } from 'react';
import {
  BookOpen,
  Check,
  Database,
  DatabaseZap,
  FileCheck,
  FilePenLine,
  FileText,
  Folder,
  FolderCheck,
  FolderSearch,
  Globe,
  ListChecks,
  ListPlus,
  ListTodo,
  Network,
  Server,
  Sigma,
  Split,
  SquareTerminal,
  Terminal,
  TextSearch,
  Timer,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import { FileRow, MonoText } from './ToolParts';
import { CodeBlock } from './CodeBlock';
import { Markdown } from './Markdown';

/** What a tool's body is given. */
export interface ToolContentProps {
  input?: Record<string, unknown>;
  output?: string;
}

/** A tool's whole presentation. */
export interface ToolPresentation {
  id: string;
  /** The name a reader sees, e.g. `Write` for `write_file`. */
  name: string;
  /** The icon while the call runs. */
  icon: LucideIcon;
  /** The icon once it has finished. */
  doneIcon: LucideIcon;
  /** The body, shown when the row is opened. */
  Content: (props: ToolContentProps) => ReactNode;
}

/** Extensions worth highlighting, mapped to the CodeMirror language name. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  py: 'python',
  pyi: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
};

function languageFor(path: string | undefined): string {
  const extension = path?.split('.').pop()?.toLowerCase();
  return extension ? (LANGUAGE_BY_EXTENSION[extension] ?? '') : '';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Split the `[exit code N]` suffix the run_command executor appends. */
function splitExit(output: string): { body: string; exit: number | null } {
  const match = /\s*\[exit code (-?\d+)\]\s*$/.exec(output);
  if (!match) {
    return { body: output.trim(), exit: null };
  }
  return { body: output.slice(0, match.index).trim(), exit: Number(match[1]) };
}

/** Pretty a JSON string if it parses; otherwise the text as-is. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/* ================================================================================================
 * Bodies
 * ============================================================================================== */

function WriteBody({ input }: ToolContentProps) {
  const path = asString(input?.path);
  return <CodeBlock code={asString(input?.contents) ?? ''} language={languageFor(path)} />;
}

function ReadBody({ input, output }: ToolContentProps) {
  const path = asString(input?.path);
  return output ? <CodeBlock code={output} language={languageFor(path)} /> : null;
}

function CommandBody({ input, output }: ToolContentProps) {
  const command = asString(input?.command) ?? '';
  const cwd = asString(input?.cwd);
  const { body, exit } = splitExit(output ?? '');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 font-mono text-meta">
        <span className="shrink-0 text-success">$</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{command}</span>
        {cwd && <span className="shrink-0 text-muted">{cwd}</span>}
        {exit !== null && (
          <span className={exit === 0 ? 'shrink-0 text-muted' : 'shrink-0 text-danger'}>{exit}</span>
        )}
      </div>
      {body && <MonoText>{body}</MonoText>}
    </div>
  );
}

function ListBody({ output }: ToolContentProps) {
  const lines = (output ?? '').split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines[0] === '(empty directory)') {
    return <p className="text-meta text-muted">Empty directory.</p>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, index) => (
        <FileRow key={index} directory={line.startsWith('dir ')} name={line.slice(4)} />
      ))}
    </div>
  );
}

function GlobBody({ output }: ToolContentProps) {
  const lines = (output ?? '').split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines[0] === 'No files matched.') {
    return <p className="text-meta text-muted">No files matched.</p>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((path, index) => (
        <FileRow key={index} name={path} />
      ))}
    </div>
  );
}

function TextBody({ output }: ToolContentProps) {
  return <MonoText>{output ?? ''}</MonoText>;
}

function SkillBody({ output }: ToolContentProps) {
  return <Markdown>{output ?? ''}</Markdown>;
}

function JsonBody({ output }: ToolContentProps) {
  return <CodeBlock code={prettyJson(output ?? '')} language="json" />;
}

function GenericBody({ input, output }: ToolContentProps) {
  return (
    <div className="flex flex-col gap-2">
      {input && Object.keys(input).length > 0 && <MonoText>{JSON.stringify(input, null, 2)}</MonoText>}
      {output && <MonoText>{output}</MonoText>}
    </div>
  );
}

/* ================================================================================================
 * Registry
 * ============================================================================================== */

const TOOLS: Record<string, ToolPresentation> = {
  read_file: { id: 'read_file', name: 'Read', icon: FileText, doneIcon: FileCheck, Content: ReadBody },
  write_file: { id: 'write_file', name: 'Write', icon: FilePenLine, doneIcon: FileCheck, Content: WriteBody },
  list_dir: { id: 'list_dir', name: 'List', icon: Folder, doneIcon: FolderCheck, Content: ListBody },
  glob: { id: 'glob', name: 'Find', icon: FolderSearch, doneIcon: FolderCheck, Content: GlobBody },
  grep: { id: 'grep', name: 'Search', icon: TextSearch, doneIcon: Check, Content: TextBody },
  run_command: {
    id: 'run_command',
    name: 'Run',
    icon: Terminal,
    doneIcon: SquareTerminal,
    Content: CommandBody,
  },
  fetch_url: { id: 'fetch_url', name: 'Fetch', icon: Globe, doneIcon: Check, Content: TextBody },
  skill: { id: 'skill', name: 'Skill', icon: BookOpen, doneIcon: Check, Content: SkillBody },
  task: { id: 'task', name: 'Delegate', icon: Network, doneIcon: Check, Content: GenericBody },
  split_session: {
    id: 'split_session',
    name: 'Split session',
    icon: Split,
    doneIcon: Check,
    Content: TextBody,
  },
  task_create: { id: 'task_create', name: 'Task', icon: ListPlus, doneIcon: ListChecks, Content: TextBody },
  task_search: {
    id: 'task_search',
    name: 'Find tasks',
    icon: ListChecks,
    doneIcon: Check,
    Content: TextBody,
  },
  task_update: { id: 'task_update', name: 'Update task', icon: ListTodo, doneIcon: Check, Content: TextBody },
  target_search: { id: 'target_search', name: 'Targets', icon: Server, doneIcon: Check, Content: TextBody },
  job_create: { id: 'job_create', name: 'Queue job', icon: Timer, doneIcon: Check, Content: TextBody },
  statistics: { id: 'statistics', name: 'Stats', icon: Sigma, doneIcon: Check, Content: JsonBody },
  science_search: {
    id: 'science_search',
    name: 'Search',
    icon: Database,
    doneIcon: Check,
    Content: JsonBody,
  },
  science_fetch: {
    id: 'science_fetch',
    name: 'Fetch record',
    icon: DatabaseZap,
    doneIcon: Check,
    Content: JsonBody,
  },
};

/** `some_tool_name` → `Some tool name`, for a tool not in the registry. */
function humanize(id: string): string {
  const spaced = id.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** How one tool presents itself, with a sensible default for anything unknown. */
export function toolPresentation(id: string): ToolPresentation {
  return (
    TOOLS[id] ?? {
      id,
      name: humanize(id),
      icon: Wrench,
      doneIcon: Check,
      Content: GenericBody,
    }
  );
}

/** Whether there is anything worth opening for a call. */
export function toolHasDetail(
  name: string,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
): boolean {
  if (output) {
    return true;
  }
  if (name === 'write_file') {
    return typeof input?.contents === 'string' && input.contents.length > 0;
  }
  if (name === 'run_command') {
    return typeof input?.command === 'string';
  }
  return Boolean(input && Object.keys(input).length > 0);
}
