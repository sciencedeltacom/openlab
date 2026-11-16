/**
 * A job's codebase page.
 *
 * A run is not an anecdote: it happened in a folder, against files, with a command and a
 * log. This page is that folder — its folders and files as a drive lists them, and a
 * terminal holding the run's transcript with a prompt below it, so the folder the run was
 * launched from can be worked in rather than only read.
 *
 * The terminal runs one line at a time through the same command layer everything else uses,
 * which is what keeps the folder boundary, the time limit and the output cap in one place.
 * Both terminals render a run's record and take no keys; the prompt below the transcript is
 * an ordinary field. A file is not previewed here either: clicking one opens it in the
 * island, where the same file looks the same from anywhere.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import {
  CalendarClock,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Folder,
  FolderTree,
  Info,
  ListFilter,
  Search,
  Server,
  Terminal,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { Terminal as XTerm } from '@xterm/xterm';

import { Input, ScrollShadow, SectionLabel, Select, Tabs } from '@/components/ui';
import { Fact, FactGroup, RecordLink, RecordMissing, RecordPage } from '@/components/research/PageShell';
import { paths } from '@/app/routes';
import { useWorkspaceFiles } from '@/hooks/useWorkspaceFiles';
import { invokeCommand } from '@/lib/ipc';
import { executionPayload } from '@/lib/execution';
import { useTerminalPane } from '@/lib/terminal';
import { cn } from '@/lib/cn';
import { MOTION } from '@/theme/tokens';
import { useApp, usePageTitle } from '@/store/app';
import { activeProject } from '@/store/types';
import { JobStateMark, TargetKindMark } from '../compute/Marks';
import { JOB_STATE_META, elapsedLabel, type Job } from '../compute/data';
import {
  childrenOf,
  crumbsOf,
  dangerLine,
  exitCodeOf,
  fileKindOf,
  fileMeta,
  joinPath,
  logLinesOf,
  logText,
  mutedLine,
  terminalText,
  typedLine,
  type LogLevel,
  type WorkdirFile,
} from './codebase';

/** The three views of a run's working directory. */
type TabId = 'files' | 'terminal' | 'logs';

/** The log-level filter, plus the un-filtered view. */
type LevelFilter = 'all' | LogLevel;

const LEVELS: { value: LevelFilter; label: string; icon: LucideIcon; chip: string }[] = [
  { value: 'all', label: 'All', icon: ListFilter, chip: 'bg-surface-secondary text-foreground' },
  { value: 'info', label: 'Info', icon: Info, chip: 'bg-surface-secondary text-muted' },
  {
    value: 'warn',
    label: 'Warn',
    icon: TriangleAlert,
    chip: 'bg-warning-soft text-warning-soft-foreground',
  },
  { value: 'error', label: 'Error', icon: CircleAlert, chip: 'bg-danger-soft text-danger-soft-foreground' },
];

/** What `run_command` answers with. */
interface RunOutput {
  output: string;
  exitCode: number;
}

/* ================================================================================================
 * The terminal
 * ============================================================================================== */

/**
 * The run's transcript, with a prompt under it.
 *
 * One line is one process: nothing carries over between two of them, so `cd` moves this
 * terminal's own idea of where it is and every other line is handed to the command layer as
 * it was typed. That is the same layer the rest of the app runs through, which keeps the
 * folder boundary, the time limit and the output cap in one place rather than in a second
 * shell nobody is guarding.
 *
 * The prompt is a line of its own rather than text inside the terminal, so what is typed is
 * edited by the browser — selection, paste, an input method — and kept out of the run's
 * record until it is run.
 */
function RunTerminal({ job, root }: { job: Job; root: string | null }) {
  const { state } = useApp();
  const { instance, ref } = useTerminalPane(state.theme === 'dark');
  const transcript = useMemo(() => terminalText(job), [job]);
  const prompt = useRef<HTMLInputElement>(null);
  const history = useRef<string[]>([]);
  const walked = useRef<number | null>(null);
  /** What this session has printed under the transcript, and the terminal it went to. */
  const session = useRef<string[]>([]);
  const built = useRef<XTerm | null>(null);
  const [cwd, setCwd] = useState('');
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);

  // The transcript is the run's record, written once per terminal, followed by the lines
  // typed here. A rebuilt terminal — a theme change starts one — begins empty, so what this
  // session printed is put back rather than vanishing out from under the reader.
  useEffect(() => {
    if (!instance || built.current === instance) return;
    built.current = instance;
    for (const text of transcript) instance.writeln(text);
    if (!root) instance.writeln(mutedLine('No folder is open, so there is nothing to run.'));
    for (const text of session.current) instance.write(text);
  }, [instance, transcript, root]);

  /** Print text and remember it, so a rebuilt terminal can be given it back. */
  const echo = (text: string) => {
    session.current.push(text);
    instance?.write(text);
  };

  /** Print one finished line. */
  const echoLine = (text: string) => echo(`${text}\r\n`);

  /** Print what a line produced. Its own output keeps the default colour: it is live. */
  const report = (output: string, exitCode: number) => {
    if (output) echo(output.endsWith('\n') ? output : `${output}\r\n`);
    if (exitCode !== 0) echoLine(mutedLine(`exit ${exitCode}`));
  };

  /** Run one line through the command layer, in the folder the terminal believes it is in. */
  const run = async (command: string) => {
    setBusy(true);
    const result = await invokeCommand<RunOutput>('run_command', {
      command,
      cwd: cwd || null,
      root,
      execution: executionPayload(state.execution),
    });
    setBusy(false);
    if (!result.ok) echoLine(dangerLine(result.error.message));
    else report(result.value.output, result.value.exitCode);
  };

  /**
   * `cd` moves this terminal, not a process.
   *
   * The candidate is handed to the command layer as a working directory: if that layer
   * accepts it the folder is inside the workspace and exists, and if it does not, its own
   * sentence is what the reader gets. Clamping `cd ..` at the root would be a quiet lie about
   * where the next command runs.
   */
  const changeDirectory = async (target: string) => {
    // `cd` with nothing after it goes back to the workspace root, which is the folder this
    // page is about; an absolute path is the command layer's to judge.
    const next = target ? joinPath(cwd, target) : '';
    setBusy(true);
    const probe = await invokeCommand<RunOutput>('run_command', {
      command: 'pwd',
      cwd: next || null,
      root,
      execution: executionPayload(state.execution),
    });
    setBusy(false);
    if (!probe.ok) echoLine(dangerLine(probe.error.message));
    else if (probe.value.exitCode !== 0) {
      echoLine(probe.value.output.trim() || 'cd: no such folder');
    } else setCwd(next);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const command = line.trim();
    if (!command || !root || !instance || busy) return;
    setLine('');
    history.current = [command, ...history.current].slice(0, 100);
    walked.current = null;
    echoLine(typedLine(command));
    if (command === 'clear') {
      session.current = [];
      instance.clear();
    } else if (/^cd(\s|$)/.test(command)) {
      void changeDirectory(command.replace(/^cd\s*/, '').trim());
    } else void run(command);
  };

  /** Walk back through the commands already run, the way a shell does. */
  const walk = (direction: 'up' | 'down') => {
    const past = history.current;
    if (past.length === 0) return;
    const at = walked.current;
    const next =
      direction === 'up'
        ? at === null
          ? 0
          : Math.min(at + 1, past.length - 1)
        : at === null
          ? null
          : at - 1;
    walked.current = next === null || next < 0 ? null : next;
    setLine(walked.current === null ? '' : past[walked.current]!);
  };

  const onPromptKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      walk(event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if (event.key === 'Escape') {
      walked.current = null;
      setLine('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Terminal className="size-3.5 shrink-0 text-muted" aria-hidden />
        <SectionLabel>Terminal</SectionLabel>
        <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-meta text-muted">
          one line at a time
        </span>
        {busy && <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-meta text-accent">running</span>}
        <span className="ml-auto text-meta tabular-nums text-muted">{job.id}</span>
      </div>

      {/* Clicking anywhere in the terminal puts the caret back at the prompt, as in a shell. */}
      <div
        onClick={() => prompt.current?.focus()}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-surface-secondary px-2 py-2 focus-within:ring-1 focus-within:ring-accent/30"
      >
        <div
          ref={ref}
          role="img"
          aria-label={`Output of ${job.id}`}
          className="openlab-terminal-readonly min-h-0 flex-1"
        />
        <form onSubmit={submit} className="flex items-center gap-2 px-1 pt-1">
          {cwd && (
            <span className="max-w-[24ch] shrink-0 truncate font-mono text-meta text-muted">{cwd}</span>
          )}
          <span aria-hidden className="shrink-0 font-mono text-meta text-accent">
            ❯
          </span>
          <input
            ref={prompt}
            value={line}
            onChange={(event) => setLine(event.target.value)}
            onKeyDown={onPromptKey}
            disabled={!root || busy}
            aria-label="Command to run in this folder"
            placeholder={root ? 'a command' : 'no folder is open'}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-meta text-foreground outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed"
          />
        </form>
      </div>
    </div>
  );
}

/* ================================================================================================
 * The log
 * ============================================================================================== */

/** A level, drawn the way the select draws it: the level's icon on its tint. */
function LevelOption({ level, label }: { level: LevelFilter; label: string }) {
  const meta = LEVELS.find((entry) => entry.value === level)!;
  const Icon = meta.icon;
  return (
    <span className={cn('flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-0.5', meta.chip)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate text-body">{label}</span>
    </span>
  );
}

/** The run's log, filterable by level and searchable by message. */
function LogPane({ job }: { job: Job }) {
  const { state } = useApp();
  const { instance, ref } = useTerminalPane(state.theme === 'dark');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [query, setQuery] = useState('');
  const lines = useMemo(() => logLinesOf(job), [job]);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      lines.filter((line) => {
        if (level !== 'all' && line.level !== level) return false;
        return !needle || line.message.toLowerCase().includes(needle);
      }),
    [lines, level, needle],
  );
  const text = useMemo(() => logText(shown), [shown]);

  useEffect(() => {
    if (!instance) return;
    instance.reset();
    for (const line of text) instance.writeln(line);
  }, [instance, text]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          variant="primary"
          value={level}
          options={LEVELS.map(({ value, label }) => ({ value, label }))}
          onChange={(value) => setLevel(value as LevelFilter)}
          label="Filter log by level"
          className="w-[132px]"
          renderOption={(option) => <LevelOption level={option.value as LevelFilter} label={option.label} />}
          renderValue={(option) =>
            option && <LevelOption level={option.value as LevelFilter} label={option.label} />
          }
        />

        <div className="relative flex min-w-0 flex-1 items-center sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the log"
            aria-label="Search the log"
            className="w-full pl-9"
          />
        </div>
        <span className="ml-auto text-meta tabular-nums text-muted">
          {shown.length} of {lines.length}
        </span>
      </div>

      <div
        ref={ref}
        role="img"
        aria-label={`Log of ${job.id}`}
        className="openlab-terminal-readonly h-full min-h-0 overflow-hidden rounded-xl bg-surface-secondary p-2"
      />
    </div>
  );
}

/* ================================================================================================
 * The folder
 * ============================================================================================== */

/** One entry in the folder: a folder that opens, or a file that opens in the island. */
function Tile({
  icon: Icon,
  mark,
  tone,
  name,
  meta,
  onClick,
}: {
  icon: LucideIcon;
  mark: string;
  tone: string;
  name: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-2xl bg-surface p-3 text-left transition-colors hover:bg-surface-tertiary"
    >
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', mark, tone)} aria-hidden>
        <Icon className="size-5" />
      </span>
      <span className="w-full min-w-0">
        <span className="block truncate text-body text-foreground">{name}</span>
        <span className="block truncate text-meta text-muted">{meta}</span>
      </span>
    </button>
  );
}

/**
 * The run's folder, one folder at a time.
 *
 * A drive lists a folder rather than a whole tree, and a file is opened where files are
 * read: the island. The breadcrumb appears only once there is somewhere to go back to.
 */
function FilesGrid({ files, error }: { files: readonly WorkdirFile[] | null; error: string | null }) {
  const { dispatch } = useApp();
  const [folder, setFolder] = useState('');
  const listing = useMemo(() => childrenOf(files ?? [], folder), [files, folder]);
  const crumbs = crumbsOf(folder);
  const total = listing.folders.length + listing.files.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {crumbs.length > 0 && (
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1">
          {['', ...crumbs].map((crumb, index) => (
            <span key={crumb || 'root'} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted" aria-hidden />}
              <button
                type="button"
                onClick={() => setFolder(crumb)}
                className={cn(
                  'max-w-[24ch] truncate rounded-lg px-1.5 py-0.5 text-meta transition-colors hover:bg-surface-secondary',
                  crumb === folder ? 'text-foreground' : 'text-muted',
                )}
              >
                {crumb.split('/').pop() || '…'}
              </button>
            </span>
          ))}
        </nav>
      )}

      <ScrollShadow className="min-h-0 flex-1">
        {files === null ? (
          <p className="text-meta text-muted">Reading the folder…</p>
        ) : total === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <Folder className="mx-auto size-4 text-muted" aria-hidden />
              <p className="mt-2 text-body text-muted">
                {files.length === 0 ? (error ?? 'This folder has no files in it.') : 'This folder is empty.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {listing.folders.map((name) => {
              const path = folder ? `${folder}/${name}` : name;
              return (
                <Tile
                  key={path}
                  icon={Folder}
                  mark="bg-default"
                  tone="text-muted"
                  name={name}
                  meta="folder"
                  onClick={() => setFolder(path)}
                />
              );
            })}
            {listing.files.map((file) => {
              const meta = fileMeta(file.name);
              return (
                <Tile
                  key={file.path}
                  icon={meta.icon}
                  mark={meta.mark}
                  tone={meta.tone}
                  name={file.name}
                  meta={fileKindOf(file.name)}
                  onClick={() => dispatch({ type: 'route/go', route: paths.file(file.path) })}
                />
              );
            })}
          </div>
        )}
      </ScrollShadow>
    </div>
  );
}

/* ================================================================================================
 * The page
 * ============================================================================================== */

/** The page body, keyed by id so another job re-reads cleanly. */
function JobCodebaseBody({ job }: { job: Job }) {
  const { state } = useApp();
  usePageTitle('Working directory');
  const root = activeProject(state)?.path ?? null;
  const target = state.targets.find((candidate) => candidate.id === job.targetId);
  const exitCode = exitCodeOf(job);
  const { files, error: filesError } = useWorkspaceFiles(root);
  const [tab, setTab] = useState<TabId>('files');

  const started =
    job.startedMinutesAgo !== null ? `${elapsedLabel(job.startedMinutesAgo)} ago` : 'not started';
  const ExitIcon = exitCode === 0 ? CircleCheck : CircleAlert;

  return (
    <RecordPage
      eyebrow={
        <>
          <SectionLabel>Codebase</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{job.id}</span>
        </>
      }
      title="Working directory"
      status={
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label',
            JOB_STATE_META[job.state].chip,
          )}
        >
          <JobStateMark state={job.state} className="size-4 rounded" />
          {JOB_STATE_META[job.state].label}
        </span>
      }
      aside={
        <>
          <FactGroup>
            <Fact icon={Server} label="Target">
              {target ? (
                <RecordLink
                  route={paths.target(target.id)}
                  className="flex w-full items-center gap-2 truncate text-link hover:underline"
                >
                  <TargetKindMark kind={target.kind} className="size-4 rounded" />
                  <span className="truncate">{target.name}</span>
                </RecordLink>
              ) : (
                <span className="text-muted">{job.targetId}</span>
              )}
            </Fact>
            <Fact icon={Terminal} label="Command">
              <span className="break-all text-meta">{job.command}</span>
            </Fact>
            <Fact icon={CalendarClock} label="Started">
              <span className="tabular-nums">{started}</span>
            </Fact>
            <Fact icon={Timer} label="Duration">
              <span className="tabular-nums">{job.duration}</span>
            </Fact>
            {exitCode !== null && (
              <Fact icon={ExitIcon} label="Exit code">
                <span className={cn('tabular-nums', exitCode === 0 ? 'text-success' : 'text-danger')}>
                  {exitCode}
                </span>
              </Fact>
            )}
            <Fact icon={FolderTree} label="Directory">
              <span className="break-all text-meta">{root ?? 'No folder is open'}</span>
            </Fact>
          </FactGroup>

          <RecordLink
            route={paths.job(job.id)}
            className="group flex w-full items-center gap-3 rounded-2xl bg-surface p-4 transition-colors hover:bg-surface-tertiary"
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-secondary"
              aria-hidden
            >
              <Timer className="size-4 text-muted" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body text-foreground">Job record</span>
              <span className="block truncate text-meta text-muted">
                {job.id} · {job.name}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
          </RecordLink>
        </>
      }
    >
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as TabId)}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Working directory views">
              <Tabs.Tab id="files">
                Files
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="terminal">
                Terminal
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="logs">
                Logs
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="files" className="pt-3">
            <div className="h-[min(70vh,540px)] min-h-[380px]">
              <FilesGrid files={files} error={filesError} />
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="terminal" className="pt-3">
            <div className="h-[min(70vh,540px)] min-h-[380px]">
              <RunTerminal job={job} root={root} />
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="logs" className="pt-3">
            <div className="h-[min(70vh,540px)] min-h-[380px]">
              <LogPane job={job} />
            </div>
          </Tabs.Panel>
        </Tabs>
      </motion.div>
    </RecordPage>
  );
}

/** A job's codebase page; an unknown id gets the shared not-found state. */
export function JobCodebase({ jobId }: { jobId: string }) {
  const { state } = useApp();
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    return <RecordMissing what="job" back="compute/jobs" backLabel="Jobs" />;
  }
  return <JobCodebaseBody key={job.id} job={job} />;
}
