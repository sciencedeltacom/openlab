/**
 * Checks the folder mirror, against a filesystem.
 *
 * Run with: `bun scripts/verify-mirror.ts`
 *
 * The mirror is the one place openlab writes into a repository a lab commits to, so its two
 * safety rules have to hold against a real filesystem, not just in the abstract: openlab's
 * own output is never mistaken for an edit, and a file somebody changed is never written over
 * unread. Those rules live in code that talks to the desktop runtime, so this test puts a
 * filesystem behind that boundary — the same `invoke` surface Tauri exposes — and drives the
 * real functions through it.
 *
 * The fake is deliberately dumb: a map of path to content, a glob matcher, and nothing else.
 * What is being checked is the mirror, not the fake.
 */

/** A file the fake filesystem holds, so a read failure can be simulated. */
interface FakeFile {
  content: string;
}

/** The files, by path. */
const files = new Map<string, FakeFile>();

/** Every command the mirror is allowed to call, in order. */
const calls: string[] = [];

/** Paths the glob reports but a read cannot open — a file removed between the two. */
const vanishing = new Set<string>();

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
    case 'glob_files': {
      const pattern = String(args.pattern);
      return [...files.keys()].filter((candidate) => globToRegExp(pattern).test(candidate)).sort();
    }
    case 'read_file': {
      const file = files.get(path);
      if (!file || vanishing.has(path)) throw new Error(`no such file: ${path}`);
      return file.content;
    }
    case 'write_file':
      files.set(path, { content: String(args.contents) });
      return null;
    case 'remove_file':
      files.delete(path);
      return null;
    default:
      throw new Error(`the mirror called an unexpected command: ${command}`);
  }
}

/** A storage that only lives as long as this process. */
const stored = new Map<string, string>();

// Set before the mirror is imported: it reads its memory at module load, and it looks for the
// desktop runtime the same way the app does.
(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: { invoke } };
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
};

const { createMirror } = await import('../src/lib/workspace/mirror');

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

const ROOT = '/tmp/openlab-mirror-test';

/**
 * A fresh mirror and an empty filesystem, as a workspace nobody has opened yet.
 *
 * Each block gets its own mirror id: the memory of what was written is keyed by mirror and
 * root and lives for the life of the module, so two blocks sharing an id would share a memory
 * and stop testing what they mean to.
 */
function fresh(id: string) {
  files.clear();
  vanishing.clear();
  calls.length = 0;
  stored.clear();
  return createMirror({ id, pattern: '.openlab/plan/**/*.md' });
}

const FILES = new Map([
  ['.openlab/plan/README.md', '# Plan\n'],
  ['.openlab/plan/backlog.md', '# Backlog\n\n- TASK-1 A task\n'],
  ['.openlab/plan/waves/003-x.md', '# W3\n'],
]);

/* ================================================================================================
 * Reading
 * ============================================================================================== */

console.log('— reading —');
{
  const mirror = fresh('reading');
  const empty = await mirror.read(ROOT);
  check('an empty folder reads as no files', empty.files.size, 0);
  check('with nothing foreign in it', empty.foreign, []);
  check('and no problems', empty.problems, []);

  files.set('.openlab/plan/README.md', { content: '# Plan\n' });
  files.set('.openlab/plan/waves/003-x.md', { content: '# W3\n' });
  files.set('.openlab/notes.txt', { content: 'not ours\n' });

  const read = await mirror.read(ROOT);
  check('the folder reads its own files', [...read.files.keys()].sort(), [
    '.openlab/plan/README.md',
    '.openlab/plan/waves/003-x.md',
  ]);
  checkThat('and not a file the pattern does not name', !read.files.has('.openlab/notes.txt'));
  check('everything is foreign on first contact', read.foreign.length, 2);
}

/* ================================================================================================
 * Writing
 * ============================================================================================== */

console.log('\n— writing —');
{
  const mirror = fresh('writing');
  // Nothing may be written before the folder has been read: this is the rule that stops an
  // export landing on a colleague's commit before anyone has read it.
  check('a write before the read writes nothing', await mirror.write(ROOT, FILES), []);
  check('and leaves the folder empty', files.size, 0);

  await mirror.read(ROOT);
  mirror.ready(ROOT);
  const wrote = await mirror.write(ROOT, FILES);
  check('a write after the read writes every file', wrote.length, 3);
  check('the folder holds them', [...files.keys()].sort(), [
    '.openlab/plan/README.md',
    '.openlab/plan/backlog.md',
    '.openlab/plan/waves/003-x.md',
  ]);
  check(
    'with their content',
    files.get('.openlab/plan/backlog.md')?.content,
    '# Backlog\n\n- TASK-1 A task\n',
  );

  // The same record again is not rewritten: a file nobody touched is not touched.
  calls.length = 0;
  const again = await mirror.write(ROOT, FILES);
  check('writing the same record again writes nothing', again, []);
  check(
    'and does not touch the disk',
    calls.filter((call) => call === 'write_file'),
    [],
  );

  // One changed file is one write.
  const changed = new Map(FILES);
  changed.set('.openlab/plan/backlog.md', '# Backlog\n\n- TASK-1 A task\n- TASK-2 Another\n');
  calls.length = 0;
  check('a changed file is written', await mirror.write(ROOT, changed), ['.openlab/plan/backlog.md']);
  check('and only that one', calls.filter((call) => call === 'write_file').length, 1);

  // A record that is gone leaves no file behind.
  const trimmed = new Map(changed);
  trimmed.delete('.openlab/plan/waves/003-x.md');
  check('a file the record no longer has is removed', await mirror.write(ROOT, trimmed), []);
  checkThat('and is gone from the folder', !files.has('.openlab/plan/waves/003-x.md'));
  check('while the others stay', files.has('.openlab/plan/backlog.md'), true);
}

/* ================================================================================================
 * What a colleague changed
 * ============================================================================================== */

console.log('\n— a file somebody else changed —');
{
  const mirror = fresh('foreign');
  await mirror.read(ROOT);
  mirror.ready(ROOT);
  await mirror.write(ROOT, FILES);

  // Our own output is not an edit: a workspace nobody touched imports nothing.
  const quiet = await mirror.read(ROOT);
  check('openlab’s own output is not foreign', quiet.foreign, []);

  // Somebody commits a change, or edits the file in an editor.
  files.set('.openlab/plan/waves/003-x.md', { content: '# W3 — renamed by a colleague\n' });
  const edited = await mirror.read(ROOT);
  check('a file somebody changed is foreign', edited.foreign, ['.openlab/plan/waves/003-x.md']);
  check(
    'and its content is what the folder holds',
    edited.files.get('.openlab/plan/waves/003-x.md'),
    '# W3 — renamed by a colleague\n',
  );

  // A file added to the folder is read too, and is foreign by definition.
  files.set('.openlab/plan/waves/004-new.md', { content: '# W4\n' });
  const added = await mirror.read(ROOT);
  check('a file somebody added is read', added.files.size, 4);
  check('and is foreign', added.foreign.sort(), [
    '.openlab/plan/waves/003-x.md',
    '.openlab/plan/waves/004-new.md',
  ]);
}

/* ================================================================================================
 * The crash case
 *
 * A change made in the app and never exported must not be lost on the next open: the file
 * still holds what openlab last wrote, so the app's own record wins and the file is not
 * imported back over it.
 * ============================================================================================== */

console.log('\n— a change that was never written —');
{
  const mirror = fresh('crash');
  await mirror.read(ROOT);
  mirror.ready(ROOT);
  await mirror.write(ROOT, FILES);

  // The app changes the record, and quits before the debounced write — the folder still holds
  // the last written version.
  check('the folder holds what was written', files.size, 3);
  const afterCrash = await mirror.read(ROOT);
  check('the folder is unchanged, so nothing is imported', afterCrash.foreign, []);
  check(
    'and the app’s own record is what wins',
    afterCrash.files.get('.openlab/plan/backlog.md'),
    '# Backlog\n\n- TASK-1 A task\n',
  );
}

/* ================================================================================================
 * Two workspaces
 * ============================================================================================== */

console.log('\n— two workspaces —');
{
  const mirror = fresh('two');
  const other = '/tmp/openlab-mirror-other';
  await mirror.read(ROOT);
  mirror.ready(ROOT);
  await mirror.write(ROOT, FILES);

  // The second folder has never been read, so it is not written to — and the first folder's
  // memory does not leak into it.
  check('an unread folder is not written', await mirror.write(other, FILES), []);
  await mirror.read(other);
  mirror.ready(other);
  check('and once read, it is', (await mirror.write(other, FILES)).length, 3);

  // Back to the first: its own memory still holds, so nothing is rewritten.
  check('the first folder is not rewritten', await mirror.write(ROOT, FILES), []);

  mirror.forget(ROOT);
  check('forgetting a folder makes its files foreign again', (await mirror.read(ROOT)).foreign.length, 3);
  check('and does not touch the other folder', (await mirror.read(other)).foreign, []);
}

/* ================================================================================================
 * A folder that is not there
 * ============================================================================================== */

console.log('\n— a folder that is not there —');
{
  const mirror = fresh('missing');
  files.clear();
  const empty = await mirror.read(ROOT);
  check('a folder with no files reads as empty', empty.files.size, 0);
  check('and reports nothing wrong', empty.problems, []);

  // A read that fails is a problem, not a crash: the app must still open, and the file is
  // reported rather than silently missing.
  files.set('.openlab/plan/unreadable.md', { content: 'x' });
  files.set('.openlab/plan/readable.md', { content: 'y' });
  vanishing.add('.openlab/plan/unreadable.md');

  const problems = await mirror.read(ROOT);
  check('a file that cannot be read is reported', problems.problems.length, 1);
  checkThat('with the path in it', problems.problems[0]?.includes('unreadable.md') === true);
  check(
    'and the file that could be read is still there',
    [...problems.files.keys()],
    ['.openlab/plan/readable.md'],
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
