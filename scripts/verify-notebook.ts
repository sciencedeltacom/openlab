/**
 * Checks the notebook reader and the ANSI it draws.
 *
 * Run with: `bun scripts/verify-notebook.ts`
 *
 * The renderer never touches nbformat JSON — `src/lib/notebook.ts` does — so the decisions
 * worth testing are here: which media type wins when a result carries several, how a split
 * stream is joined, where a never-run cell's prompt stops, and what an escape sequence turns
 * into. The fixture is the same notebook the end-to-end test opens.
 */

import { readFileSync } from 'node:fs';

import { ansiPlain, ansiSegments } from '../src/lib/ansi';
import {
  hasKernel,
  NOTEBOOK_DRIVER,
  NOTEBOOK_DRIVER_PATH,
  kernelLabel,
  notebookCounts,
  parseDocument,
  parseNotebook,
  runCommand,
  serializeDocument,
  withCellSource,
  withKernel,
  withPackages,
  type Notebook,
  type NotebookBlock,
  type NotebookCell,
} from '../src/lib/notebook';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
}

function checkThat(label: string, condition: boolean) {
  check(label, condition, true);
}

/** The one notebook both this and the end-to-end test read. */
const source = readFileSync('e2e/fixtures/analysis.ipynb', 'utf8');
const parsed = parseNotebook(source);
if (!parsed.ok) {
  console.log(`FAIL the fixture parses: ${parsed.error}`);
  process.exit(1);
}

// ── The notebook's shape ────────────────────────────────────────────────────────────────────

const notebook: Notebook = parsed.notebook;
check('the language comes from language_info', notebook.language, 'python');
check('the kernel name is kept for the bar', notebook.kernel, 'Python 3 (ipykernel)');
check('counts match the file', notebookCounts(notebook), { cells: 8, code: 5, outputs: 4 });

const code = notebook.cells.filter(
  (cell): cell is Extract<NotebookCell, { kind: 'code' }> => cell.kind === 'code',
);
const pending = code.find((cell) => cell.source.includes('fit_curve'));
check('a cell nobody ran has no count', pending?.executionCount, null);
check('a cell nobody ran has no outputs', pending?.blocks, []);

const boom = code.find((cell) => cell.id === 'boom');
const error = boom?.blocks[0] as Extract<NotebookBlock, { kind: 'error' }> | undefined;
check('an error keeps its name', error?.name, 'KeyError');
check('an error keeps its value', error?.value, "'dose'");
checkThat('an error keeps its traceback', (error?.traceback ?? '').includes('KeyError'));

const tableCell = code.find((cell) => cell.id === 'table');
const table = tableCell?.blocks[0];
check('an execute_result becomes html, not its text fallback', table?.kind, 'html');
checkThat('the html is the table', (table as { html: string }).html.includes('<table'));
check('an execute_result carries its prompt', (table as { prompt?: number | null }).prompt, 2);

const figure = code.find((cell) => cell.id === 'figure')?.blocks[0];
check('an image wins over its plain-text repr', figure?.kind, 'image');
checkThat(
  'the image is a data uri',
  (figure as { src: string } | undefined)?.src.startsWith('data:image/png;base64,') ?? false,
);

const raw = notebook.cells.find((cell) => cell.kind === 'raw');
check('a raw cell is kept as text', raw?.kind, 'raw');

// ── What a result prefers, and what it loses ───────────────────────────────────────────────

/** A one-cell notebook, to test one output shape at a time. */
function notebookWith(data: Record<string, unknown>): NotebookBlock | undefined {
  const one = parseNotebook(
    JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          execution_count: 1,
          source: 'x',
          outputs: [{ output_type: 'execute_result', execution_count: 1, data }],
        },
      ],
      metadata: {},
    }),
  );
  if (!one.ok) {
    return undefined;
  }
  const cell = one.notebook.cells[0];
  return cell?.kind === 'code' ? cell.blocks[0] : undefined;
}

check('an svg is inline, not base64', notebookWith({ 'image/svg+xml': '<svg/>' })?.kind, 'image');
checkThat(
  'the svg is encoded as a data uri',
  (notebookWith({ 'image/svg+xml': '<svg/>' }) as { src: string }).src.startsWith('data:image/svg+xml;utf8,'),
);
check(
  'html wins over the text fallback',
  notebookWith({ 'text/html': '<b>x</b>', 'text/plain': 'x' })?.kind,
  'html',
);
check('json is drawn as json', notebookWith({ 'application/json': { a: 1 } })?.kind, 'json');
check('plain text is the last resort', notebookWith({ 'text/plain': 'plain' })?.kind, 'text');
check(
  'a widget with no image says so instead of drawing a blank',
  notebookWith({ 'application/vnd.jupyter.widget-view+json': { model_id: 'x' } })?.kind,
  'note',
);
check(
  "plotly's html is not drawn as a dead frame",
  notebookWith({ 'application/vnd.plotly.v1+json': {}, 'text/html': '<div/>' })?.kind,
  'note',
);

/** A cell whose outputs include a stream split in three, as IPython writes a progress bar. */
const split = parseNotebook(
  JSON.stringify({
    cells: [
      {
        cell_type: 'code',
        execution_count: 1,
        source: 'for x in y: print(x)',
        outputs: [
          { output_type: 'stream', name: 'stdout', text: 'a' },
          { output_type: 'stream', name: 'stdout', text: 'b' },
          { output_type: 'stream', name: 'stderr', text: 'c' },
        ],
      },
    ],
    metadata: {},
  }),
);
const splitBlocks =
  split.ok && split.notebook.cells[0]?.kind === 'code' ? split.notebook.cells[0].blocks : [];
check('streams of the same name are one block', splitBlocks.length, 2);
check('the joined stream keeps its text', (splitBlocks[0] as { text: string })?.text, 'ab');
check('stderr stays its own block', (splitBlocks[1] as { stream: string })?.stream, 'stderr');

/** A cell that cleared its output. */
const cleared = parseNotebook(
  JSON.stringify({
    cells: [
      {
        cell_type: 'code',
        execution_count: 1,
        source: 'x',
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'old' }, { output_type: 'clear_output' }],
      },
    ],
    metadata: {},
  }),
);
check(
  'clear_output drops what came before it',
  cleared.ok && cleared.notebook.cells[0]?.kind === 'code' ? cleared.notebook.cells[0].blocks : null,
  [],
);

// ── The files that are not notebooks ───────────────────────────────────────────────────────

check('bad JSON is refused with words', parseNotebook('{').ok, false);
check('an empty notebook is refused', parseNotebook('{"cells":[]}').ok, false);
check(
  'a blank code cell is not a card',
  parseNotebook(
    JSON.stringify({ cells: [{ cell_type: 'code', source: '  \n', execution_count: null, outputs: [] }] }),
  ).ok,
  false,
);

// ── ANSI ───────────────────────────────────────────────────────────────────────────────────

const red = ansiSegments('\x1b[31mboom\x1b[0m after');
check(
  'a colour is one run, the reset ends it',
  red.map((segment) => segment.text),
  ['boom', ' after'],
);
check('the run carries the danger token', red[0]?.style.color, 'var(--danger)');
check('text after the reset carries no colour', red[1]?.style.color, undefined);

const bold = ansiSegments('\x1b[1;34mhead\x1b[22m tail');
check('a compound code applies both', bold[0]?.style.bold, true);
check('a compound code keeps the colour', bold[0]?.style.color, 'var(--accent)');
check('22 clears bold and keeps the colour', bold[1]?.style.bold, undefined);

const faded = ansiSegments('\x1b[2mdim\x1b[0m');
check('dim is a style, not a colour', faded[0]?.style.dim, true);

check(
  'a 256-colour code is consumed, not printed',
  ansiSegments('\x1b[38;5;208mx\x1b[0m').map((segment) => segment.text),
  ['x'],
);
check(
  'a true-colour code is consumed too',
  ansiSegments('\x1b[38;2;10;20;30mx\x1b[0m').map((segment) => segment.text),
  ['x'],
);
check(
  'a title sequence never reaches the text',
  ansiSegments('\x1b]0;ipykernel\x07ok').map((segment) => segment.text),
  ['ok'],
);
check(
  'a cursor move is dropped, not printed',
  ansiSegments('\x1b[2Kdone').map((segment) => segment.text),
  ['done'],
);
check('plain text is one run', ansiSegments('plain')[0]?.text, 'plain');
check('the plain text helper drops the codes', ansiPlain('\x1b[31mred\x1b[0m'), 'red');
check('adjacent runs of the same style merge', ansiSegments('\x1b[31ma\x1b[31mb\x1b[0m').length, 1);

// ── Editing the file, not the view ─────────────────────────────────────────────────────────

const parsedDoc = parseDocument(source);
if (!parsedDoc.ok) {
  console.log(`FAIL the fixture parses as a document: ${parsedDoc.error}`);
  process.exit(1);
}
const document = parsedDoc.document;
check('the document keeps the file it came from', (document.raw as { nbformat?: number }).nbformat, 4);
check('and every cell with it', (document.raw.cells as unknown[]).length, 8);

const edited = withCellSource(document, 1, 'print("edited")');
const written = JSON.parse(serializeDocument(edited)) as {
  cells: { source: unknown; outputs?: unknown[]; execution_count?: number }[];
};
check('an edit is written as a list of lines', written.cells[1]?.source, ['print("edited")']);
check('an edit keeps the outputs', written.cells[1]?.outputs?.length, 1);
check('an edit keeps the execution count', written.cells[1]?.execution_count, 1);
const original = JSON.parse(source) as { cells: { source: unknown }[] };
check('an edit leaves the other cells alone', written.cells[0]?.source, original.cells[0]?.source);
check(
  'a multi-line edit keeps its line endings',
  JSON.parse(serializeDocument(withCellSource(document, 1, 'a\nb\n'))).cells[1].source,
  ['a\n', 'b\n'],
);

const custom = withKernel(edited, 'python3.13');
check('the kernel picker writes the name', custom.kernelspec, 'python3.13');
check('and the version', custom.version, '3.13');
check('and both land in the file', (custom.raw.metadata as any).kernelspec.name, 'python3.13');
check('the label follows the version', kernelLabel(custom), 'Python 3.13');
check('the current version is marked', hasKernel(custom, '3.13'), true);
check('another one is not', hasKernel(custom, '3.12'), false);
check('picking the same kernel changes nothing', withKernel(custom, 'python3.13') === custom, true);
check('the written file parses again', parseDocument(serializeDocument(custom)).ok, true);

// ── The environment the notebook asks for ──────────────────────────────────────────────────

check('a notebook without packages declares none', parsed.notebook.packages, []);

const withTorch = withPackages(document, ['torch', 'pandas>=2']);
check('packages land in the file', (withTorch.raw.metadata as any).openlab.packages, ['torch', 'pandas>=2']);
check('and on the notebook', withTorch.packages, ['torch', 'pandas>=2']);
const reread = parseDocument(serializeDocument(withTorch));
check('and survive a save', reread.ok ? reread.document.packages : null, ['torch', 'pandas>=2']);
check('a package cannot carry a shell command', withPackages(document, ['torch; rm -rf /']).packages, [
  'torchrm-rf',
]);
check(
  'an empty list takes the key with it',
  'openlab' in ((withPackages(withTorch, []).raw.metadata as Record<string, unknown>) ?? {}),
  false,
);

// ── The command a target runs ──────────────────────────────────────────────────────────────

const command = runCommand('analysis.ipynb');
checkThat('a run executes the driver in the workspace', command.includes(NOTEBOOK_DRIVER_PATH));
checkThat('and never a sibling notebook', !command.includes('--output '));
checkThat('the driver is chosen by what it needs to import', command.includes('import nbclient, nbformat'));
checkThat('a machine with those uses its python3', command.includes('PY=python3;'));
checkThat('one with neither falls back to uv', command.includes('--with jupyter'));
checkThat('and a machine with none is told what to install', command.includes('install jupyter, or uv'));
checkThat('a failing cell does not stop the run', NOTEBOOK_DRIVER.includes('allow_errors=True'));
checkThat('and a runner timeout is passed in', command.includes('OPENLAB_TIMEOUT=600'));
checkThat('the kernel is passed to the driver', command.includes('OPENLAB_KERNEL="$KERNEL"'));
checkThat("and the notebook's kernel is only used if it exists", command.includes('kernelspec list'));
checkThat('with a working kernel as the fallback', command.includes('KERNEL=python3;'));
checkThat('the log says which kernel ran', command.includes('echo "kernel: $KERNEL"'));
checkThat('the path is quoted', command.endsWith(`\'analysis.ipynb\'`));
checkThat(
  'a path with a space stays one word',
  runCommand('notebooks/egfr analysis.ipynb').endsWith(`\'notebooks/egfr analysis.ipynb\'`),
);

// What the driver does, since it is the thing that actually runs the notebook.
checkThat('the driver reads the notebook as nbformat', NOTEBOOK_DRIVER.includes('nbformat.read'));
checkThat('starts the kernel before touching the file', NOTEBOOK_DRIVER.includes('setup_kernel()'));
checkThat('saves atomically, so a reader never sees half a file', NOTEBOOK_DRIVER.includes('os.replace'));
checkThat('clears the previous run', NOTEBOOK_DRIVER.includes('cell["outputs"] = []'));
checkThat(
  'saves after every cell, which is what makes the preview live',
  NOTEBOOK_DRIVER.includes('client.execute_cell(cell, index)'),
);
checkThat('and announces each cell', NOTEBOOK_DRIVER.includes('openlab: cell {executed} running'));

// The version reaches uv as a bare number: quoting it inside the runner variable would hand
// `uv --python` the quotes as part of the version, and it answers "no interpreter found".
const versioned = runCommand('analysis.ipynb', { kernel: 'python3.13', version: '3.13' });
checkThat('the picked version reaches the runner', versioned.includes('--python 3.13 python'));
checkThat('with no quotes attached to it', !versioned.includes("--python '3.13'"));
checkThat("and the notebook's kernel is preferred", versioned.includes("KERNEL='python3.13'"));
check(
  'a version that is not a version is dropped',
  runCommand('x.ipynb', { version: '3.13; rm -rf /' }).includes('--python 3.13'),
  true,
);

// A notebook that names packages cannot run in a bare environment, so uv becomes the runner.
const packagesCommand = runCommand('analysis.ipynb', { packages: ['torch'] });
checkThat('declared packages make uv the runner', packagesCommand.startsWith('if command -v uv'));
checkThat('and are installed for the run', packagesCommand.includes('--with torch'));
checkThat("and the machine's own python is not a fallback for them", !packagesCommand.includes('PY=python3'));
checkThat(
  'and a machine with neither is told what to install',
  packagesCommand.includes('needs uv to install'),
);

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: a notebook parses, the right output is drawn, and ANSI becomes theme colour');
