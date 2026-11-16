/**
 * Checks the figures as files.
 *
 * Run with: `bun scripts/verify-figures.ts`
 *
 * A figure is the lab's output, so it is a file in the workspace rather than a note in the
 * app: `.openlab/figures/<id>-<caption>.json`. What that has to get right is the round trip —
 * a document written and read back is the same document — the naming, which is what makes a
 * folder of them readable, and the move, which must not lose the figures somebody already had.
 *
 * The store talks to the desktop runtime, so this test puts a filesystem behind that boundary
 * — the same `invoke` surface Tauri exposes — and drives the real functions through it.
 */

/** The files, by path. */
const files = new Map<string, string>();

/** Every command the store called, in order. */
const calls: string[] = [];

/** A glob pattern as a regular expression: `**` crosses folders, `*` does not. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${escaped
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')}$`,
  );
}

/** The `invoke` the desktop runtime would provide, backed by {@link files}. */
async function invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  calls.push(command);
  const path = typeof args.path === 'string' ? args.path : '';
  switch (command) {
    case 'glob_files':
      return [...files.keys()]
        .filter((candidate) => globToRegExp(String(args.pattern)).test(candidate))
        .sort();
    case 'read_file': {
      const content = files.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    }
    case 'write_file':
      files.set(path, String(args.contents));
      return null;
    case 'remove_file':
      files.delete(path);
      return null;
    default:
      throw new Error(`the figures called an unexpected command: ${command}`);
  }
}

/** A storage that only lives as long as this process. */
const stored = new Map<string, string>();

// Set before the store is imported: it looks for the desktop runtime the same way the app
// does, and it reads the key the previous build wrote.
(globalThis as Record<string, unknown>).window = {
  __TAURI_INTERNALS__: { invoke },
  addEventListener: () => {},
  setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
  clearTimeout: (timer: number) => clearTimeout(timer),
};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
};

const store = await import('../src/components/figures/store');
const { FIGURE_DIR, FIGURE_README, addExampleFigures, allFigures, figureFiles, flushFigures } = store;
const { figureSlug } = await import('../src/components/figures/types');
const { SEED_FIGURES } = await import('../src/components/figures/seed');
type Figure = import('../src/components/figures/types').Figure;

let failures = 0;

/** Assert equality and report the difference rather than throwing. */
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

/** Assert a condition the test states in words. */
function checkThat(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
}

/** Wait for the store's debounced write, and for the queued write behind it. */
async function settle(): Promise<void> {
  flushFigures();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ROOT = '/tmp/openlab-figures-test';

function figure(overrides: Partial<Figure> = {}): Figure {
  const base = SEED_FIGURES[0]!;
  return { ...base, id: 'F-1234', caption: 'Selectivity heatmap', ...overrides };
}

/* ================================================================================================
 * Naming
 * ============================================================================================== */

console.log('— slugs —');
{
  check('a slug is the id and the caption', figureSlug(figure()), 'f-1234-selectivity-heatmap');
  check('accents fold', figureSlug(figure({ caption: 'Seçicilik ölçümü' })), 'f-1234-secicilik-olcumu');
  check(
    'punctuation and case fold',
    figureSlug(figure({ caption: 'Panel (A): IC50 vs. Time!' })),
    'f-1234-panel-a-ic50-vs-time',
  );
  check(
    'a long caption is cut to six words',
    figureSlug(figure({ caption: 'one two three four five six seven eight' })),
    'f-1234-one-two-three-four-five-six',
  );
  check('a caption with nothing to name falls back', figureSlug(figure({ caption: '!!!' })), 'f-1234-figure');
  check('the id is lowercased', figureSlug(figure({ id: 'F-9ABC' })), 'f-9abc-selectivity-heatmap');
}

/* ================================================================================================
 * The files of a workspace
 * ============================================================================================== */

console.log('\n— the files —');
{
  const heatmap = figure();
  const panel = figure({ id: 'F-5678', caption: 'Kinase panel' });
  const written = figureFiles([heatmap, panel]);

  check('a figure is a file, and the folder explains itself', [...written.keys()].sort(), [
    FIGURE_README,
    `${FIGURE_DIR}/f-1234-selectivity-heatmap.json`,
    `${FIGURE_DIR}/f-5678-kinase-panel.json`,
  ]);
  checkThat('the README says where an export belongs', written.get(FIGURE_README)!.includes('results/'));

  const text = written.get(`${FIGURE_DIR}/f-1234-selectivity-heatmap.json`)!;
  checkThat('a document is pretty-printed, so a diff reads', text.includes('\n  "caption"'));
  check('and round-trips', JSON.parse(text), heatmap);
  checkThat('and ends with a newline', text.endsWith('}\n'));
  check('the artboard survives', JSON.parse(text).doc.width, heatmap.doc.width);
  check('a workspace with no figures still gets the README', figureFiles([]).size, 1);
}

/* ================================================================================================
 * Writing a workspace
 * ============================================================================================== */

console.log('\n— writing —');
{
  await store.loadWorkspaceFigures(ROOT);
  check('a workspace with no figures reads as none', allFigures(), []);

  const added = addExampleFigures();
  check('the examples are all of them', added, SEED_FIGURES.length);
  check('and they are in the workspace now', allFigures().length, SEED_FIGURES.length);
  await settle();

  check('a file per figure, and the README', files.size, SEED_FIGURES.length + 1);
  checkThat('the README is in the folder', files.has(FIGURE_README));
  checkThat(
    'and a document per figure',
    allFigures().every((one) => files.has(`${FIGURE_DIR}/${figureSlug(one)}.json`)),
  );

  // Nothing changed, so nothing is written.
  calls.length = 0;
  await settle();
  check(
    'writing an unchanged workspace writes nothing',
    calls.filter((call) => call === 'write_file'),
    [],
  );

  // One edit is one file.
  const first = allFigures()[0]!;
  store.patchFigure(first.id, { caption: 'Renamed by the studio' });
  calls.length = 0;
  await settle();
  check('an edit writes one file', calls.filter((call) => call === 'write_file').length, 1);
  checkThat(
    'the renamed file is in the folder',
    files.has(`${FIGURE_DIR}/${figureSlug({ ...first, caption: 'Renamed by the studio' })}.json`),
  );

  // A deleted figure leaves no file behind.
  const removed = allFigures()[1]!;
  const path = `${FIGURE_DIR}/${figureSlug(removed)}.json`;
  store.removeFigure(removed.id);
  await settle();
  checkThat('a deleted figure leaves no file', !files.has(path));
}

/* ================================================================================================
 * Reading a workspace back
 * ============================================================================================== */

console.log('\n— reading back —');
{
  const before = allFigures().length;
  const load = await store.loadWorkspaceFigures(ROOT);
  check('the folder reads as the same figures', allFigures().length, before);
  check('with nothing foreign', load.foreign, 0);
  check('and nothing migrated', load.migrated, false);

  // A colleague commits a figure: it arrives on the next open.
  const theirs: Figure = { ...figure(), id: 'F-7777', caption: 'A figure from a colleague' };
  files.set(`${FIGURE_DIR}/${figureSlug(theirs)}.json`, `${JSON.stringify(theirs, null, 2)}\n`);
  const arriving = await store.loadWorkspaceFigures(ROOT);
  check('a committed figure is read', arriving.foreign, 1);
  checkThat(
    'and is in the gallery',
    allFigures().some((one) => one.id === 'F-7777'),
  );

  // A document that is not JSON is a problem, not a crash.
  files.set(`${FIGURE_DIR}/f-0000-broken.json`, 'not json at all');
  const broken = await store.loadWorkspaceFigures(ROOT);
  check('a broken document is reported', broken.problems.length, 1);
  checkThat('with its path', broken.problems[0]?.includes('f-0000-broken.json') === true);
  files.delete(`${FIGURE_DIR}/f-0000-broken.json`);
}

/* ================================================================================================
 * The move
 *
 * The figures the previous build kept in app storage had no workspace of their own. The first
 * one opened claims them — and the key is removed, so it happens once.
 * ============================================================================================== */

console.log('\n— the move —');
{
  files.clear();
  stored.clear();
  // The mirror's memory of what it wrote lives for the life of the module, so this block
  // starts from a workspace openlab has never written to.
  store.forgetFigureMemory(ROOT);
  const mine = [figure({ id: 'F-101', caption: 'Mine, from the old build' })];
  stored.set('openlab.figures.v1', JSON.stringify({ version: 1, figures: mine }));

  const load = await store.loadWorkspaceFigures(ROOT);
  check('the old list is adopted', load.migrated, true);
  check(
    'and is the workspace now',
    allFigures().map((one) => one.id),
    ['F-101'],
  );
  check('the old key is gone', stored.has('openlab.figures.v1'), false);
  await settle();

  check('and the folder holds them', files.size, 2);
  checkThat('including the README', files.has(FIGURE_README));
  checkThat(
    'and the document itself',
    files.get(`${FIGURE_DIR}/${figureSlug(mine[0]!)}.json`) === `${JSON.stringify(mine[0], null, 2)}\n`,
  );

  // A second open finds the folder full, so the move does not happen again.
  stored.set('openlab.figures.v1', JSON.stringify({ version: 1, figures: [figure({ id: 'F-999' })] }));
  const second = await store.loadWorkspaceFigures(ROOT);
  check('a full folder is not migrated into', second.migrated, false);
  check(
    'and the old list is left alone',
    allFigures().map((one) => one.id),
    ['F-101'],
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
