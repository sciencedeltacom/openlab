/**
 * A Jupyter notebook: read as a document, edited as cells, and run on a compute target.
 *
 * Two surfaces from one reader:
 *
 *  - `NotebookView` draws a notebook it must not change — a demo, a record. It never runs
 *    anything, because it has no file to run.
 *  - `NotebookEditor` draws the same notebook with the cells writable and the file behind it
 *    a draft: an edit rewrites that cell's `source` inside the original JSON and nothing else,
 *    so outputs, counts and metadata survive a save untouched.
 *
 * Three decisions worth keeping in mind when changing it:
 *
 *  1. The prompt gutter is the notebook's one piece of structure. A markdown cell has none, so
 *     the prose flows like a document; a code cell's prompt is right-aligned against its own
 *     card and against the outputs that belong to it.
 *  2. An output written as HTML is drawn in a sandboxed frame, never in this document. That
 *     is what makes a saved pandas table keep its own markup without notebook HTML becoming a
 *     way into the app; scripts are off, and the frame may not fetch anything.
 *  3. Colour in an output is the notebook's, the palette is ours: `ansiSegments` turns the
 *     escape codes into runs, and the runs are painted with the theme's tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Info, Pencil, Play, Settings2 } from 'lucide-react';

import { CodeEditable, CodeReadOnly } from '@/components/chat/CodeBlock';
import { RichTextEditor } from '@/components/files/MarkdownEditor';
import { Markdown } from '@/components/chat/Markdown';
import { BrandGlyph, Button, IconButton, Popover, Spinner, TextArea, Tip } from '@/components/ui';
import { useCopy } from '@/hooks/useCopy';
import { useJobRunner } from '@/hooks/useCompute';
import { invokeCommand } from '@/lib/ipc';
import { ansiSegments } from '@/lib/ansi';
import { cn } from '@/lib/cn';
import { adapterFor } from '@/lib/compute/adapters';
import {
  hasKernel,
  kernelLabel,
  NOTEBOOK_DRIVER,
  NOTEBOOK_DRIVER_PATH,
  parseDocument,
  parseNotebook,
  PYTHON_KERNELS,
  runCommand,
  serializeDocument,
  withCellSource,
  withKernel,
  withPackages,
  type Notebook,
  type NotebookBlock,
  type NotebookCell,
  type NotebookDocument,
} from '@/lib/notebook';
import { notify } from '@/lib/toast';
import { newJob, newTarget, type Target } from '@/store/compute';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';

/** The language name a reader recognises, from nbformat's own. */
const LANGUAGE_LABEL: Record<string, string> = {
  python: 'Python',
  python3: 'Python',
  r: 'R',
  ir: 'R',
  julia: 'Julia',
  scala: 'Scala',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  bash: 'Shell',
  sh: 'Shell',
};

/** The packages a field names: commas or newlines, whichever the reader used. */
function splitPackages(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The prompt a reader sees: the kernel's count, or the blank Jupyter shows before a run. */
function promptOf(kind: 'in' | 'out', count: number | null | undefined): string {
  return `${kind === 'in' ? 'In' : 'Out'} [${count ?? ' '}]`;
}

/**
 * Text as the process wrote it, with its colours.
 *
 * `dim` is opacity rather than a colour, so a dimmed run reads as secondary in both themes;
 * a background is a wash, because a solid ANSI background would sit on top of the theme.
 */
function AnsiText({ text, tone }: { text: string; tone?: 'danger' | 'muted' }) {
  const segments = useMemo(() => ansiSegments(text), [text]);
  return (
    <pre
      className={cn(
        'whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed',
        tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-muted' : 'text-foreground/90',
      )}
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          style={{
            color: segment.style.color,
            background: segment.style.background,
            fontWeight: segment.style.bold ? 600 : undefined,
            fontStyle: segment.style.italic ? 'italic' : undefined,
            textDecoration: segment.style.underline ? 'underline' : undefined,
            opacity: segment.style.dim ? 0.65 : undefined,
          }}
        >
          {segment.text}
        </span>
      ))}
    </pre>
  );
}

/**
 * The stylesheet a saved HTML output is drawn inside.
 *
 * The frame is a separate document, so the app's variables do not cross into it and the
 * colours are resolved here. Resolved through a probe that carries the *asked-for* theme,
 * not through the document: the theme attribute lands in an effect, one render after the
 * state changes, and reading the live document would paint one theme's frame in the other's
 * colours for a frame.
 */
function outputCss(dark: boolean): string {
  const probe = document.createElement('span');
  probe.dataset.theme = dark ? 'openlab-dark' : 'openlab';
  probe.style.display = 'none';
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const read = (name: string, fallback = '') => style.getPropertyValue(name).trim() || fallback;
  const foreground = read('--foreground', '#3f3f3e');
  const muted = read('--muted', '#6f6e6b');
  const surface = read('--surface-secondary', '#efeeea');
  const separator = read('--separator', 'rgba(0,0,0,.1)');
  const mono = read('--font-mono', 'ui-monospace, SFMono-Regular, Menlo, monospace');
  probe.remove();
  return `:root{color-scheme:${dark ? 'dark' : 'light'}}
html,body{margin:0;padding:0;background:transparent;color:${foreground};
  font:13px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}
p{margin:0 0 .5em}
table{border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
th,td{border:1px solid ${separator};padding:4px 9px;text-align:left;vertical-align:top}
thead th{background:${surface};font-weight:600}
tbody tr:nth-child(even) td{background:color-mix(in oklch, ${surface} 45%, transparent)}
pre{margin:0;white-space:pre-wrap;font-family:${mono};font-size:12px}
code{font-family:${mono};font-size:12px}
img{max-width:100%;height:auto}
a{color:inherit}
figcaption,.caption{color:${muted};font-size:11px}
`;
}

/** The most height an HTML output may take before it scrolls inside its own frame. */
const OUTPUT_MAX_HEIGHT = 520;

/**
 * A saved HTML output, in its own document.
 *
 * `sandbox` without `allow-scripts` is the whole safety story: nothing in the notebook's
 * HTML can run, and `allow-same-origin` is there only so this component can read the
 * document's height and size the frame to it. The injected policy blocks every request, so
 * an output that references a remote image or font does not phone home from a document the
 * reader opened locally.
 */
function HtmlOutput({ html }: { html: string }) {
  const { state } = useApp();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) {
      return;
    }
    const content = doc.documentElement?.scrollHeight ?? 0;
    setHeight(Math.min(OUTPUT_MAX_HEIGHT, Math.max(64, content + 2)));
  }, []);

  useEffect(() => {
    measure();
  }, [measure, state.theme, html]);

  const document_ = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` +
      `<style>${outputCss(state.theme === 'dark')}</style></head><body>${html}</body></html>`,
    // The document is rebuilt when the notebook or the theme changes: the theme decides the
    // colours inside, and the frame cannot see this document's variables.
    [html, state.theme],
  );

  return (
    <iframe
      ref={frame}
      title="Notebook output"
      sandbox="allow-same-origin"
      srcDoc={document_}
      onLoad={measure}
      style={{ height }}
      className="w-full rounded-lg border border-separator"
    />
  );
}

/** One output, in the form that keeps the most of it. */
function OutputBody({ block }: { block: NotebookBlock }) {
  switch (block.kind) {
    case 'text':
      return (
        <div className="max-h-[360px] overflow-auto rounded-lg bg-surface-secondary/70 px-3 py-2">
          <AnsiText text={block.text} tone={block.stream === 'stderr' ? 'danger' : undefined} />
        </div>
      );
    case 'error':
      return (
        <div className="flex flex-col gap-1 overflow-hidden rounded-lg border border-danger/25 bg-danger/5">
          <div className="border-b border-danger/20 bg-danger/10 px-3 py-1.5 font-mono text-[12px] font-semibold text-danger">
            {block.name}
            {block.value && <span className="font-normal">: {block.value}</span>}
          </div>
          <div className="max-h-[360px] overflow-auto px-3 py-2">
            <AnsiText text={block.traceback || `${block.name}: ${block.value}`} tone="danger" />
          </div>
        </div>
      );
    case 'image':
      return (
        <div className="overflow-hidden rounded-lg border border-separator bg-white p-2">
          <img src={block.src} alt="Notebook output" className="mx-auto max-h-[520px] max-w-full" />
        </div>
      );
    case 'html':
      return <HtmlOutput html={block.html} />;
    case 'markdown':
      return (
        <div className="rounded-lg bg-surface-secondary/50 px-4 py-3">
          <Markdown>{block.text}</Markdown>
        </div>
      );
    case 'json':
      return (
        <div className="max-h-[360px] overflow-auto rounded-lg bg-surface-secondary/70 px-3 py-2">
          <AnsiText text={block.text} />
        </div>
      );
    case 'note':
      return (
        <p className="flex items-center gap-1.5 text-meta text-muted">
          <Info className="size-3.5 shrink-0" aria-hidden />
          {block.text}
        </p>
      );
  }
}

/** One output row: the gutter keeps the prompt, the body keeps the output. */
function OutputRow({ block }: { block: NotebookBlock }) {
  const hasPrompt = block.prompt !== undefined && block.prompt !== null;
  return (
    <div className="flex gap-3">
      <div className="w-14 shrink-0 pt-1.5 text-end font-mono text-[11px] tabular-nums text-muted">
        {hasPrompt ? `Out[${block.prompt}]` : ''}
      </div>
      <div className="min-w-0 flex-1">
        <OutputBody block={block} />
      </div>
    </div>
  );
}

/** A markdown or raw cell: prose when read, a field when the reader is editing it. */
function ProseCell({
  cell,
  editable,
  onChange,
}: {
  cell: Extract<NotebookCell, { kind: 'markdown' | 'raw' }>;
  editable: boolean;
  onChange: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = cell.text;

  if (editable && editing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-xl border border-separator bg-surface px-4 py-3">
          {cell.kind === 'markdown' ? (
            // The same document editor as a file page — its bubble and floating menus are the
            // point: a cell is prose, and a textarea cannot make a heading out of a line.
            <RichTextEditor
              value={cell.text}
              onChange={onChange}
              autoFocus
              className="openlab-editor--cell"
              placeholder="Write the cell…"
            />
          ) : (
            <textarea
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={text}
              aria-label="Cell text"
              onChange={(event) => onChange(event.target.value)}
              className="min-h-[120px] w-full resize-y bg-transparent font-mono text-[12px] leading-relaxed text-foreground outline-none"
            />
          )}
        </div>
        <div>
          <Button size="sm" variant="secondary" onPress={() => setEditing(false)}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative min-w-0">
      {cell.kind === 'markdown' ? (
        <Markdown>{cell.text}</Markdown>
      ) : (
        <div className="flex gap-3">
          <div className="w-14 shrink-0 pt-1 text-end font-mono text-[11px] text-muted">Raw</div>
          <div className="min-w-0 flex-1 rounded-lg bg-surface-secondary/60 px-3 py-2">
            <AnsiText text={cell.text} tone="muted" />
          </div>
        </div>
      )}
      {editable && (
        <div className="absolute end-0 top-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tip content="Edit this cell">
            <IconButton aria-label="Edit this cell" onPress={() => setEditing(true)}>
              <Pencil className="size-3.5" />
            </IconButton>
          </Tip>
        </div>
      )}
    </div>
  );
}

/** A code cell: its prompt, its card, its outputs. */
function CodeCell({
  cell,
  language,
  editable,
  running,
  onChange,
}: {
  cell: Extract<NotebookCell, { kind: 'code' }>;
  language: string;
  editable: boolean;
  /** The cell the run is on right now: Jupyter's own `In [*]`. */
  running: boolean;
  onChange: (text: string) => void;
}) {
  const copy = useCopy();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <div
          className={cn(
            'w-14 shrink-0 pt-2.5 text-end font-mono text-[11px] tabular-nums',
            running ? 'text-accent' : 'text-muted',
          )}
          aria-live={running ? 'polite' : undefined}
        >
          {running ? 'In [*]' : promptOf('in', cell.executionCount)}
        </div>
        <div
          className={cn(
            'group relative min-w-0 flex-1 rounded-xl bg-code-wrapper p-1.5 transition-shadow focus-within:ring-1 focus-within:ring-accent/30',
            running && 'ring-1 ring-accent/40',
          )}
        >
          <div className="rounded-lg bg-code-card px-3 py-2.5">
            {editable ? (
              <CodeEditable
                value={cell.source}
                language={language}
                ariaLabel="Cell source"
                onChange={onChange}
              />
            ) : (
              <CodeReadOnly code={cell.source} language={language} />
            )}
          </div>
          <div className="absolute end-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Tip content="Copy the cell">
              <IconButton
                aria-label="Copy the cell"
                className="bg-code-card/90 backdrop-blur"
                onPress={() => copy(cell.source, 'cell')}
              >
                <Copy className="size-3.5" />
              </IconButton>
            </Tip>
          </div>
        </div>
      </div>

      {cell.blocks.map((block, index) => (
        <OutputRow key={`${cell.id}-${index}`} block={block} />
      ))}
    </div>
  );
}

/** The code cell a run is on: the first one the driver has not written a count for. */
function pendingCell(document: NotebookDocument): number | null {
  for (const cell of document.cells) {
    if (cell.kind === 'code' && cell.executionCount === null) {
      return cell.index;
    }
  }
  return null;
}

/** The local target the picker offers even before one exists. */
function machineTarget(): Target {
  return newTarget({
    name: 'This machine',
    kind: 'local',
    host: 'this machine',
    summary: 'Runs in the workspace, on this laptop.',
    readiness: 'ready',
    config: { workdir: '.' },
  });
}

/**
 * The notebook's bar: what it is on the left, what it can do on the right.
 *
 * The version picker writes the notebook's kernel — the file's own record of which Python it
 * was written against, and the kernel `nbconvert` will start. The run picker sends the file
 * to a compute target and queues it, so a notebook needs no detour through the Jobs screen.
 */
function NotebookHeader({
  notebook,
  path,
  onKernel,
  dirty = false,
  onSave,
  onRan,
  onRunStart,
  onPackages,
}: {
  notebook: Notebook;
  path?: string | null;
  onKernel?: (name: string) => void;
  /** The draft has unsaved edits, which a run would not see. */
  dirty?: boolean;
  onSave?: () => Promise<void> | void;
  /** A run finished and wrote the notebook, so the reader is given the new file. */
  onRan?: () => void;
  /** A run was submitted; `local` says whether this machine can watch the file change. */
  onRunStart?: (options: { local: boolean }) => void;
  /** Present when the notebook can be edited: its run environment lives in the file. */
  onPackages?: (packages: string[]) => void;
}) {
  const { state, dispatch } = useApp();
  const { run } = useJobRunner();
  const root = activeProject(state)?.path ?? null;
  const [versionOpen, setVersionOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [draftPackages, setDraftPackages] = useState(() => notebook.packages.join(', '));

  const local = state.targets.find((target) => target.kind === 'local');
  const rows = local ? state.targets : [machineTarget(), ...state.targets];

  const start = async (chosen: Target) => {
    if (!path || !root || starting) {
      return;
    }
    setStarting(true);
    try {
      // A run executes the file on disk, so what the reader sees is what runs.
      if (dirty) {
        await onSave?.();
      }
    } catch {
      setStarting(false);
      return;
    }
    // The driver is what executes the notebook; it is written into the workspace first, so a
    // failed write is a refusal to run rather than a job that cannot start.
    const driver = await invokeCommand('write_file', {
      path: NOTEBOOK_DRIVER_PATH,
      contents: NOTEBOOK_DRIVER,
      root,
    });
    if (!driver.ok) {
      notify(`The run driver could not be written: ${driver.error.message}`, { tone: 'danger' });
      setStarting(false);
      return;
    }
    // A target made for this press is not in the store yet; it exists as this object, and the
    // runner is given it so the job has something real to run on.
    const known = state.targets.some((target) => target.id === chosen.id) ? chosen : undefined;
    if (!known) {
      dispatch({ type: 'target/create', target: chosen });
    }
    const base =
      path
        .split('/')
        .pop()
        ?.replace(/\.ipynb$/i, '') ?? 'notebook';
    const job = newJob({
      name: `Run ${base}`,
      command: runCommand(path, {
        kernel: notebook.kernelspec,
        version: /^(\d+\.\d+)/.exec(notebook.version ?? '')?.[1] ?? null,
        packages: notebook.packages,
      }),
      targetId: chosen.id,
      objective: `Execute ${path} on ${chosen.name}`,
      // The runner waits at most half an hour for a local or ssh command, which is this job's
      // real ceiling; a scheduler target applies its own.
      resources: { cores: chosen.cores || 1, memoryGb: chosen.memoryGb || 2, wallClock: '30 min' },
    });
    dispatch({ type: 'job/create', job });
    notify(`Queued “${job.name}” on ${chosen.name}`, { tone: 'success' });
    onRunStart?.({ local: chosen.kind === 'local' });
    try {
      // `run` waits for a local or ssh submission, which is the whole execution: the file on
      // disk now holds the outputs, and the reader re-reads it. A scheduler returns here after
      // the submission, so there is nothing new to read yet.
      await run(job, chosen);
    } finally {
      setStarting(false);
      onRan?.();
    }
  };

  return (
    <div className="sticky top-0 z-10 flex items-center justify-end gap-1.5 bg-surface/85 px-5 py-2 backdrop-blur">
      {onKernel ? (
        <Popover
          isOpen={versionOpen}
          onOpenChange={setVersionOpen}
          placement="bottom end"
          className="w-[200px] p-1.5"
          trigger={
            <Button size="sm" variant="ghost" className="gap-1.5">
              <BrandGlyph name="python" />
              {kernelLabel(notebook)}
              <ChevronDown className="size-3" aria-hidden />
            </Button>
          }
        >
          <div className="flex flex-col">
            <span className="px-2 py-1 text-meta text-muted">Kernel</span>
            {PYTHON_KERNELS.map((kernel) => (
              <button
                key={kernel.name}
                type="button"
                onClick={() => {
                  setVersionOpen(false);
                  onKernel(kernel.name);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body transition-colors hover:bg-surface-secondary',
                  hasKernel(notebook, kernel.minor) ? 'text-foreground' : 'text-muted',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{kernel.label}</span>
                {hasKernel(notebook, kernel.minor) && <Check className="size-3.5 text-accent" aria-hidden />}
              </button>
            ))}
          </div>
        </Popover>
      ) : (
        <span className="flex items-center gap-1.5 text-meta text-muted">
          <BrandGlyph name="python" />
          {kernelLabel(notebook)}
        </span>
      )}

      {path && (
        <Popover
          isOpen={runOpen}
          onOpenChange={setRunOpen}
          placement="bottom end"
          className="w-[260px] p-1.5"
          trigger={
            <Button size="sm" variant="secondary" className="gap-1.5" isDisabled={!root || starting}>
              {starting ? <Spinner /> : <Play className="size-3 fill-current" aria-hidden />}
              Run
              <ChevronDown className="size-3" aria-hidden />
            </Button>
          }
        >
          <div className="flex flex-col">
            <span className="px-2 py-1 text-meta text-muted">Execute on</span>
            {rows.map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => {
                  setRunOpen(false);
                  void start(target);
                }}
                className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-secondary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-foreground">{target.name}</span>
                  <span className="block truncate text-meta text-muted">
                    {target.kind === 'local' ? 'Runs in the workspace' : adapterFor(target.kind).label}
                    {target.readiness === 'ready' ? '' : ` · ${target.readiness.replace('-', ' ')}`}
                  </span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setRunOpen(false);
                dispatch({ type: 'route/go', route: 'compute/targets' });
              }}
              className="mt-1 border-t border-separator px-2 py-1.5 pt-2 text-left text-meta text-accent"
            >
              Manage targets…
            </button>
          </div>
        </Popover>
      )}

      {onPackages && (
        <Popover
          isOpen={envOpen}
          onOpenChange={(open) => {
            setEnvOpen(open);
            if (open) {
              setDraftPackages(notebook.packages.join(', '));
            }
          }}
          placement="bottom end"
          className="w-[300px] p-3"
          trigger={
            <IconButton aria-label="Run environment">
              <Settings2 className="size-4" />
            </IconButton>
          }
        >
          <div className="flex flex-col gap-2">
            <span className="text-label text-foreground">Packages</span>
            <TextArea
              value={draftPackages}
              onChange={(event) => setDraftPackages((event.target as HTMLTextAreaElement).value)}
              rows={4}
              aria-label="Packages installed for this run"
              placeholder="torch, pandas>=2, scikit-learn"
              className="font-mono text-meta"
            />
            <p className="text-meta text-muted">Installed with uv for this run, and kept in the notebook.</p>
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onPress={() => setEnvOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  onPackages(splitPackages(draftPackages));
                  setEnvOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}

/** The notebook's cells, in order. */
function NotebookCells({
  notebook,
  editable,
  runningIndex,
  onChange,
}: {
  notebook: Notebook;
  editable: boolean;
  /** The raw cell index the run is on, when a run is in flight. */
  runningIndex?: number | null;
  onChange?: (index: number, text: string) => void;
}) {
  const languageKey = notebook.language.toLowerCase();
  return (
    <div className="flex flex-col gap-5 px-5 py-5">
      {notebook.cells.map((cell) => {
        if (cell.kind === 'markdown' || cell.kind === 'raw') {
          return (
            <ProseCell
              key={cell.id}
              cell={cell}
              editable={editable}
              onChange={(text) => onChange?.(cell.index, text)}
            />
          );
        }
        return (
          <CodeCell
            key={cell.id}
            cell={cell}
            language={languageKey}
            editable={editable}
            running={runningIndex === cell.index}
            onChange={(text) => onChange?.(cell.index, text)}
          />
        );
      })}
    </div>
  );
}

/** A notebook drawn for reading: no editing, and no run without a file. */
export function NotebookView({ source }: { source: string }) {
  const parsed = useMemo(() => parseNotebook(source), [source]);

  if (!parsed.ok) {
    return <p className="px-4 py-3.5 text-body text-muted">{parsed.error}</p>;
  }

  return (
    <div className="flex flex-col">
      <NotebookHeader notebook={parsed.notebook} />
      <NotebookCells notebook={parsed.notebook} editable={false} />
    </div>
  );
}

/**
 * A notebook being edited.
 *
 * The draft is the file's text, which the parent owns and saves; this component holds the
 * parsed document beside it, so an edit changes one cell's `source` and re-serializes, rather
 * than rebuilding the notebook from the shapes the reader draws.
 */
export function NotebookEditor({
  value,
  onChange,
  onSave,
  onRan,
  dirty,
  path,
}: {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  /** Called after a run wrote the notebook, so the reader reloads it. */
  onRan?: () => void;
  dirty?: boolean;
  path: string;
}) {
  const { state } = useApp();
  const root = activeProject(state)?.path ?? null;
  const [current, setCurrent] = useState(() => parseDocument(value));
  /** The last document this editor produced, so an echo from the parent is not re-parsed. */
  const emitted = useRef<string | null>(null);
  const latest = useRef<NotebookDocument | null>(current.ok ? current.document : null);
  /** The notebook as the run has written it so far, while the run is in flight. */
  const [live, setLive] = useState<NotebookDocument | null>(null);
  const [watching, setWatching] = useState(false);
  const [local, setLocal] = useState(false);

  // A parent-side change (a reload, another tab) replaces the document; our own edits do not.
  useEffect(() => {
    if (value === emitted.current) {
      return;
    }
    const next = parseDocument(value);
    setCurrent(next);
    latest.current = next.ok ? next.document : null;
    // The file changed under the run's copy, so the copy is no longer the newer one.
    setLive(null);
  }, [value]);

  /*
   * A local run writes the notebook after every cell, so reading it while the job runs is what
   * makes the preview live: a cell that has a count is done, and the first code cell without
   * one is the cell being executed. A remote target writes on the other machine, so there is
   * nothing here to watch.
   */
  useEffect(() => {
    if (!watching || !local || !root) {
      return;
    }
    let alive = true;
    const read = async () => {
      const result = await invokeCommand<string>('read_file', { path, root });
      if (!alive || !result.ok) {
        return;
      }
      const next = parseDocument(result.value);
      if (next.ok) {
        setLive(next.document);
      }
    };
    const timer = window.setInterval(() => void read(), 700);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [watching, local, path, root]);

  const commit = useCallback(
    (next: NotebookDocument) => {
      latest.current = next;
      setCurrent({ ok: true, document: next });
      const text = serializeDocument(next);
      emitted.current = text;
      onChange(text);
    },
    [onChange],
  );

  // Cmd/Ctrl+S saves, the way every other editor on this page does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave]);

  if (!current.ok) {
    return <p className="px-4 py-3.5 text-body text-muted">{current.error}</p>;
  }

  const document = current.document;
  /** What the page draws: the run's copy while it is being written, the draft otherwise. */
  const shown = live ?? document;

  return (
    <div className="flex flex-col">
      <NotebookHeader
        notebook={document}
        path={path}
        dirty={dirty}
        onSave={onSave}
        onKernel={(name) => commit(withKernel(latest.current ?? document, name))}
        onPackages={(packages) => commit(withPackages(latest.current ?? document, packages))}
        onRunStart={(options) => {
          setLive(null);
          setLocal(options.local);
          setWatching(true);
        }}
        onRan={() => {
          setWatching(false);
          setLive(null);
          onRan?.();
        }}
      />
      <NotebookCells
        notebook={shown}
        // The file is being rewritten cell by cell; editing it underneath the run would lose
        // the edit at the next save the run makes.
        editable={!watching}
        runningIndex={watching && live ? pendingCell(live) : null}
        onChange={(index, text) => commit(withCellSource(latest.current ?? document, index, text))}
      />
    </div>
  );
}
