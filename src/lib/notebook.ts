import { quote } from './compute/adapters';

/**
 * A Jupyter notebook, parsed for reading.
 *
 * nbformat is JSON whose shape varies by version and by whatever wrote it: a `source` is a
 * string or a list of lines, an output's `data` is a map of media types, a traceback is a
 * list of lines that already carry colour, and a cell may have no id at all. This module
 * turns all of that into one small shape the renderer draws, and decides which media type to
 * draw when a result carries several.
 *
 * It is pure — no React, no DOM — so `scripts/verify-notebook.ts` can test the decisions.
 * The renderer never touches nbformat JSON: a single place reads it, and a single place can
 * be wrong.
 */

/** One way a cell's output can be drawn. */
export type NotebookBlock =
  | { kind: 'text'; text: string; stream: 'stdout' | 'stderr' | 'result'; prompt?: number | null }
  | { kind: 'error'; name: string; value: string; traceback: string; prompt?: number | null }
  | { kind: 'image'; src: string; prompt?: number | null }
  | { kind: 'html'; html: string; prompt?: number | null }
  | { kind: 'markdown'; text: string; prompt?: number | null }
  | { kind: 'json'; text: string; prompt?: number | null }
  | { kind: 'note'; text: string; prompt?: number | null };

/** A cell, in the three shapes a reader meets. */
export type NotebookCell =
  | { kind: 'markdown'; id: string; index: number; text: string }
  | { kind: 'raw'; id: string; index: number; text: string }
  | {
      kind: 'code';
      id: string;
      index: number;
      source: string;
      /** The kernel's count, or null when the cell was never run. */
      executionCount: number | null;
      blocks: NotebookBlock[];
    };

/** A notebook the reader can draw. */
export interface Notebook {
  /** nbformat's language name, e.g. `python` or `R`. */
  language: string;
  /** The kernel the notebook was written against, when it says. */
  kernel: string | null;
  /** The kernelspec name, e.g. `python3`, when the file has one. */
  kernelspec: string | null;
  /** The interpreter version the file records, e.g. `3.12.4`. */
  version: string | null;
  /**
   * Packages the run installs for this notebook (`metadata.openlab.packages`).
   *
   * A notebook says what it imports; a machine says what it has. This is the notebook's own
   * answer, kept in the file the way Colab keeps its environment, so the run can be reproduced
   * on a machine that has none of them.
   */
  packages: string[];
  cells: NotebookCell[];
}

/**
 * A notebook with the JSON it came from.
 *
 * The editor changes a cell's source and writes the file back, so it needs both: the cells it
 * draws and the document they are a view of. Everything the editor does not touch — outputs,
 * execution counts, cell metadata, the notebook's own metadata — is carried in `raw` and
 * written back unchanged.
 */
export interface NotebookDocument extends Notebook {
  raw: Record<string, unknown>;
}

/** The two answers parsing can give. */
export type ParsedNotebook = { ok: true; notebook: Notebook } | { ok: false; error: string };

/** nbformat's text fields are a string or a list of lines. */
export function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((line) => (typeof line === 'string' ? line : String(line))).join('');
  }
  return '';
}

/** A record from an unknown JSON value. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** A base64 payload, without the line breaks some writers leave in it. */
function base64(value: string): string {
  return value.replace(/\s+/g, '');
}

/** The data URI for an image output, whichever way the notebook stored it. */
function imageSource(mime: string, value: string): string {
  if (value.startsWith('data:')) {
    return value;
  }
  if (mime === 'image/svg+xml') {
    return `data:image/svg+xml;utf8,${encodeURIComponent(value)}`;
  }
  return `data:${mime};base64,${base64(value)}`;
}

/** Outputs that only a live kernel can draw, named so the reader is not left with a blank box. */
const INTERACTIVE = [
  'application/vnd.jupyter.widget-view+json',
  'application/vnd.plotly.v1+json',
  'application/vnd.vegalite.v5+json',
  'application/vnd.vega.v5+json',
];

/**
 * The one block a `data` map should be drawn as.
 *
 * A result usually carries several representations of the same thing; the order here is by
 * how much of the original it keeps — an image is the figure the author saw, HTML is the
 * table with its structure, plain text is the fallback that always exists.
 */
function blockFromData(data: Record<string, unknown>, prompt: number | null | undefined): NotebookBlock {
  for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']) {
    const value = data[mime];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { kind: 'image', src: imageSource(mime, value), prompt };
    }
  }

  const html = data['text/html'];
  if (typeof html === 'string' && html.trim().length > 0) {
    const interactive = INTERACTIVE.find((mime) => mime in data);
    if (interactive) {
      return { kind: 'note', text: 'An interactive output. Open the notebook in Jupyter to use it.', prompt };
    }
    return { kind: 'html', html, prompt };
  }

  const markdown = data['text/markdown'];
  if (typeof markdown === 'string' && markdown.trim().length > 0) {
    return { kind: 'markdown', text: markdown, prompt };
  }

  const json = data['application/json'];
  if (json !== undefined) {
    return { kind: 'json', text: JSON.stringify(json, null, 2), prompt };
  }

  const text = asText(data['text/plain']);
  if (text.trim().length > 0) {
    return { kind: 'text', text, stream: 'result', prompt };
  }

  const interactive = INTERACTIVE.find((mime) => mime in data);
  if (interactive) {
    return { kind: 'note', text: 'An interactive output. Open the notebook in Jupyter to use it.', prompt };
  }

  return { kind: 'note', text: 'This output has no readable form.', prompt };
}

/** The blocks one code cell produced, in order, with consecutive streams joined. */
function blocksOf(outputs: unknown, executionCount: number | null): NotebookBlock[] {
  const blocks: NotebookBlock[] = [];
  for (const raw of Array.isArray(outputs) ? outputs : []) {
    const output = record(raw);
    const type = String(output.output_type ?? '');

    if (type === 'clear_output') {
      blocks.length = 0;
      continue;
    }

    if (type === 'stream') {
      const name = output.name === 'stderr' ? 'stderr' : 'stdout';
      const text = asText(output.text);
      if (!text) {
        continue;
      }
      const last = blocks[blocks.length - 1];
      // IPython splits one print of a progress bar into many stream writes; joining them is
      // what makes it read as one block again.
      if (last?.kind === 'text' && last.stream === name && last.prompt === undefined) {
        last.text += text;
      } else {
        blocks.push({ kind: 'text', text, stream: name });
      }
      continue;
    }

    if (type === 'error') {
      blocks.push({
        kind: 'error',
        name: String(output.ename ?? 'Error'),
        value: String(output.evalue ?? ''),
        traceback: (Array.isArray(output.traceback) ? output.traceback : []).map(asText).join('\n'),
        prompt: null,
      });
      continue;
    }

    if (type === 'execute_result' || type === 'display_data') {
      const data = record(output.data);
      if (Object.keys(data).length === 0) {
        continue;
      }
      blocks.push(blockFromData(data, type === 'execute_result' ? executionCount : undefined));
    }
  }
  return blocks;
}

/** Parse the notebook a `.ipynb` file holds. */
export function parseNotebook(source: string): ParsedNotebook {
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(source));
  } catch {
    return { ok: false, error: 'This file is not valid notebook JSON.' };
  }

  const cells: NotebookCell[] = [];
  const rawCells = Array.isArray(raw.cells) ? raw.cells : [];
  rawCells.forEach((value, index) => {
    const cell = record(value);
    const type = String(cell.cell_type ?? '');
    const id = String(cell.id ?? `cell-${index}`);
    const text = asText(cell.source);

    if (type === 'markdown' || type === 'heading') {
      if (text.trim()) {
        cells.push({ kind: 'markdown', id, index, text });
      }
      return;
    }
    if (type === 'raw') {
      if (text.trim()) {
        cells.push({ kind: 'raw', id, index, text });
      }
      return;
    }
    if (type !== 'code') {
      return;
    }

    const count = cell.execution_count;
    const executionCount = typeof count === 'number' ? count : null;
    const blocks = blocksOf(cell.outputs, executionCount);
    // A code cell nobody ran and nobody wrote is a blank line in the file, not a card.
    if (!text.trim() && blocks.length === 0) {
      return;
    }
    cells.push({ kind: 'code', id, index, source: text, executionCount, blocks });
  });

  if (cells.length === 0) {
    return { ok: false, error: 'This notebook has no cells to read.' };
  }

  return { ok: true, notebook: { ...describe(raw), cells } };
}

/** The language, kernel and version the file records. */
function describe(raw: Record<string, unknown>): Omit<Notebook, 'cells'> {
  const metadata = record(raw.metadata);
  const languageInfo = record(metadata.language_info);
  const kernelspec = record(metadata.kernelspec);
  const language =
    String(languageInfo.name ?? kernelspec.language ?? kernelspec.name ?? 'python').trim() || 'python';
  const kernel = String(kernelspec.display_name ?? kernelspec.name ?? '').trim() || null;
  const kernelspecName = String(kernelspec.name ?? '').trim() || null;
  const version = String(languageInfo.version ?? '').trim() || null;
  const own = record(metadata.openlab);
  const packages = (Array.isArray(own.packages) ? own.packages : [])
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
  return { language, kernel, kernelspec: kernelspecName, version, packages };
}

/**
 * Parse a notebook into the document an editor can change.
 *
 * The same walk as `parseNotebook`, keeping the JSON: an edit is a change to one cell's
 * `source`, so the rest of the file — outputs, counts, metadata — is never rebuilt from the
 * shapes this module draws.
 */
export function parseDocument(
  source: string,
): { ok: true; document: NotebookDocument } | { ok: false; error: string } {
  const parsed = parseNotebook(source);
  if (!parsed.ok) {
    return parsed;
  }
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(source));
  } catch {
    return { ok: false, error: 'This file is not valid notebook JSON.' };
  }
  return { ok: true, document: { ...parsed.notebook, raw } };
}

/** nbformat's own way to store text: a list of lines, each keeping its newline. */
function lines(text: string): string[] {
  const parts = text.split('\n');
  return parts
    .map((part, index) => (index === parts.length - 1 ? part : `${part}\n`))
    .filter((part, index) => part !== '' || index < parts.length - 1);
}

/** A copy of the document with one cell's source replaced. */
export function withCellSource(document: NotebookDocument, index: number, text: string): NotebookDocument {
  const rawCells = Array.isArray(document.raw.cells) ? (document.raw.cells as unknown[]) : [];
  const raw = {
    ...document.raw,
    cells: rawCells.map((value, at) => (at === index ? { ...record(value), source: lines(text) } : value)),
  };
  const cells = document.cells.map((cell) => {
    if (cell.index !== index) {
      return cell;
    }
    if (cell.kind === 'code') {
      return { ...cell, source: text };
    }
    return { ...cell, text };
  });
  return { ...document, raw, cells };
}

/** The kernels the version picker offers, and the name each one writes into the file. */
export const PYTHON_KERNELS: readonly { name: string; label: string; minor: string }[] = [
  { name: 'python3.10', label: 'Python 3.10', minor: '3.10' },
  { name: 'python3.11', label: 'Python 3.11', minor: '3.11' },
  { name: 'python3.12', label: 'Python 3.12', minor: '3.12' },
  { name: 'python3.13', label: 'Python 3.13', minor: '3.13' },
];

/** The major.minor a notebook declares, from its version or its kernelspec. */
function minorOf(notebook: Pick<Notebook, 'kernelspec' | 'version'>): string | null {
  const fromVersion = /^(\d+\.\d+)/.exec(notebook.version ?? '');
  if (fromVersion) {
    return fromVersion[1]!;
  }
  const fromKernel = /^python(\d+\.\d+)$/.exec(notebook.kernelspec ?? '');
  return fromKernel ? fromKernel[1]! : null;
}

/** The label the header shows for the notebook's kernel. */
export function kernelLabel(notebook: Pick<Notebook, 'kernelspec' | 'version' | 'kernel'>): string {
  const minor = minorOf(notebook);
  if (minor) {
    return `Python ${minor}`;
  }
  const known = PYTHON_KERNELS.find((kernel) => kernel.name === notebook.kernelspec);
  if (known) {
    return known.label;
  }
  return notebook.kernel ?? 'Python 3';
}

/** Whether the picker should mark a kernel as the notebook's current one. */
export function hasKernel(notebook: Pick<Notebook, 'kernelspec' | 'version'>, minor: string): boolean {
  return minorOf(notebook) === minor;
}

/** A copy of the document that declares another kernel. */
export function withKernel(document: NotebookDocument, name: string): NotebookDocument {
  const known = PYTHON_KERNELS.find((kernel) => kernel.name === name);
  if (!known || hasKernel(document, known.minor)) {
    return document;
  }
  const metadata = record(document.raw.metadata);
  const kernelspec = {
    ...record(metadata.kernelspec),
    name: known.name,
    display_name: known.label,
    language: 'python',
  };
  const languageInfo = { ...record(metadata.language_info), name: 'python', version: known.minor };
  const raw = {
    ...document.raw,
    metadata: { ...metadata, kernelspec, language_info: languageInfo },
  };
  return {
    ...document,
    raw,
    kernelspec: known.name,
    kernel: known.label,
    language: 'python',
    version: known.minor,
  };
}

/** A package name a shell can take: letters, digits and the version operators. */
function safePackage(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._+=<>,~!-]/g, '');
}

/** A copy of the document that declares the packages its run installs. */
export function withPackages(document: NotebookDocument, packages: readonly string[]): NotebookDocument {
  const clean = packages.map(safePackage).filter((entry) => entry.length > 0);
  const metadata: Record<string, unknown> = { ...record(document.raw.metadata) };
  const own: Record<string, unknown> = { ...record(metadata.openlab) };
  if (clean.length > 0) {
    own.packages = clean;
  } else {
    delete own.packages;
  }
  // An empty `openlab` object is not information; the key leaves with its last field.
  if (Object.keys(own).length > 0) {
    metadata.openlab = own;
  } else {
    delete metadata.openlab;
  }
  return { ...document, raw: { ...document.raw, metadata }, packages: clean };
}

/** The file the editor writes back: the document, with the edits in it. */
export function serializeDocument(document: NotebookDocument): string {
  return `${JSON.stringify(document.raw, null, 1)}\n`;
}

/** Where the run's driver lives in the workspace, so a reader can inspect what ran. */
export const NOTEBOOK_DRIVER_PATH = '.openlab/notebook-run.py';

/**
 * The program a run executes, cell by cell.
 *
 * `nbconvert` writes the notebook once, at the end, which is why a reader watching a long
 * notebook sees nothing until it finishes. This driver saves after every cell, so the preview
 * can follow the run — the running cell is the first code cell without a count — and it
 * records a failed cell and carries on, the way Run all does.
 *
 * It is written into the workspace before the run rather than buried in the command, so the
 * file that produced the outputs is the file a reader can open and read.
 */
export const NOTEBOOK_DRIVER = `"""Execute an openlab notebook, saving after every cell.

Written by openlab before a run. A cell that raises is recorded as that cell's output and the
run continues; the outputs are saved into the notebook itself.
"""

import os
import sys
import tempfile

import nbformat
from nbclient import NotebookClient

path = sys.argv[1]
kernel = os.environ.get("OPENLAB_KERNEL") or "python3"
timeout = int(os.environ.get("OPENLAB_TIMEOUT") or "600")
notebook = nbformat.read(path, as_version=4)


def save():
    """Write the notebook in one move, so a reader never sees half a file."""
    directory = os.path.dirname(os.path.abspath(path)) or "."
    handle, temporary = tempfile.mkstemp(dir=directory, suffix=".ipynb")
    with os.fdopen(handle, "w", encoding="utf-8") as stream:
        nbformat.write(notebook, stream)
    os.replace(temporary, path)


client = NotebookClient(
    notebook,
    kernel_name=kernel,
    timeout=timeout,
    allow_errors=True,
    record_timing=False,
)

# The kernel first: a machine without it should leave the notebook exactly as it was.
with client.setup_kernel():
    # A run starts from a clean slate; the counts it writes are its own.
    for cell in notebook.cells:
        if cell.cell_type == "code":
            cell["outputs"] = []
            cell["execution_count"] = None
    save()

    executed = 0
    # execute_cell takes the cell's place in the notebook, not its ordinal among code cells.
    for index, cell in enumerate(notebook.cells):
        if cell.cell_type != "code":
            continue
        executed += 1
        print(f"openlab: cell {executed} running", flush=True)
        client.execute_cell(cell, index)
        save()
        print(f"openlab: cell {executed} done", flush=True)

print(f"openlab: {executed} cells executed", flush=True)
`;

/**
 * The command a compute target runs for this notebook.
 *
 * Two things have to hold on an arbitrary machine:
 *
 *  1. **A Python that can drive a kernel.** The driver imports `nbclient` and `nbformat`, so a
 *     runner is chosen by that, not by whether a `jupyter` command exists: this machine's
 *     `python3` when it can import them, otherwise `uv run --with jupyter`, otherwise the
 *     interpreter behind a `jupyter` install. The last answer is a sentence a reader can act on
 *     rather than a Python traceback.
 *  2. **A kernel that exists.** A notebook records the kernel it was written against, and a
 *     machine may not have it — `No such kernel named python3.13` is what that looks like. The
 *     notebook's kernel is used when this machine lists it, and the runner's own `python3` when
 *     it does not; the log says which one ran. On the uv path the chosen Python version is what
 *     uv installs, so the version the reader picked is the interpreter that runs.
 *
 * A notebook that declares packages can only be served by uv, so uv becomes the runner then.
 */
export function runCommand(
  path: string,
  preferred?: {
    kernel?: string | null;
    version?: string | null;
    /** What the notebook's run installs. Present means uv is the runner. */
    packages?: readonly string[];
  },
): string {
  const file = quote(path);
  const kernel = preferred?.kernel?.trim() || 'python3';
  // A version is digits and dots by construction, and it goes inside a variable later:
  // quoting it here would reach `uv` with the quotes attached to the number.
  const minor = (preferred?.version ?? '').replace(/[^0-9.]/g, '');
  const python = minor ? `--python ${minor} ` : '';
  const packages = (preferred?.packages ?? []).map(safePackage).filter((entry) => entry.length > 0);
  const withs = packages.map((name) => `--with ${name} `).join('');
  const uv = `uv run --no-project --with jupyter ${withs}${python}python`;
  const driver = quote(NOTEBOOK_DRIVER_PATH);
  const uvFirst = packages.length > 0;
  // With declared packages only uv can supply them, so the machine's own Python is not a
  // fallback: it would start without the packages and fail on the first import.
  const branches = uvFirst
    ? [
        `if command -v uv >/dev/null 2>&1; then PY="${uv}";`,
        'else echo "openlab needs uv to install this notebook\'s packages: https://docs.astral.sh/uv/" >&2; exit 127; fi;',
      ]
    : [
        'if python3 -c "import nbclient, nbformat" >/dev/null 2>&1; then PY=python3;',
        `elif command -v uv >/dev/null 2>&1; then PY="${uv}";`,
        'elif command -v jupyter >/dev/null 2>&1; then PY=$(head -1 "$(command -v jupyter)" | sed "s/^#!//");',
        'else echo "openlab needs Jupyter to run a notebook: install jupyter, or uv (https://docs.astral.sh/uv/)" >&2; exit 127; fi;',
      ];
  return [
    ...branches,
    `KERNEL=${quote(kernel)};`,
    // The notebook's kernel only runs if this machine has it.
    '$PY -m jupyter kernelspec list 2>/dev/null | grep -qw "$KERNEL" || KERNEL=python3;',
    'echo "kernel: $KERNEL";',
    `OPENLAB_KERNEL="$KERNEL" OPENLAB_TIMEOUT=600 $PY ${driver} ${file}`,
  ].join(' ');
}

/** What the notebook's toolbar says: cells, code cells and how many produced output. */
export function notebookCounts(notebook: Notebook): { cells: number; code: number; outputs: number } {
  let code = 0;
  let outputs = 0;
  for (const cell of notebook.cells) {
    if (cell.kind === 'code') {
      code += 1;
      if (cell.blocks.length > 0) {
        outputs += 1;
      }
    }
  }
  return { cells: notebook.cells.length, code, outputs };
}
