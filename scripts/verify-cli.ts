/**
 * Checks the CLI end to end.
 *
 * Run with: `bun scripts/verify-cli.ts`
 *
 * The CLI is the app without its window, so what matters is that it is the *same* workbench: a
 * lab made by `init` is a folder the app would open, the store it writes is the app's SQLite
 * file, and the statistics it prints come from the app's own engine with its reproduction
 * intact. Each command is run for real, against a scratch data directory, and its output is
 * read — a command that only exits zero is not evidence that it worked.
 *
 * Nothing here touches a real lab or the real database: `OPENLAB_DATA_DIR` points at a
 * temporary directory for every run.
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;

/** Assert equality and report the difference rather than throwing. */
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
}

/** Assert a condition. */
function checkTrue(label: string, value: unknown): void {
  check(label, Boolean(value), true);
}

const app = join(import.meta.dir, '..');
const data = mkdtempSync(join(tmpdir(), 'openlab-cli-data-'));
const lab = mkdtempSync(join(tmpdir(), 'openlab-cli-lab-'));

/** Run the CLI the way a user would, with the scratch data directory. */
function cli(args: string[], options: { input?: string } = {}): { code: number; out: string } {
  const result = Bun.spawnSync(['bun', join(app, 'cli', 'bin', 'run.js'), ...args], {
    cwd: app,
    env: { ...process.env, OPENLAB_DATA_DIR: data, NO_COLOR: '1' },
    stdin: options.input ? new TextEncoder().encode(options.input) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: result.exitCode, out: `${result.stdout.toString()}${result.stderr.toString()}` };
}

/** Run the CLI and parse its JSON, ignoring anything a warning wrote before it. */
function cliJson<T>(args: string[], options: { input?: string } = {}): { code: number; value: T | null; raw: string } {
  const result = cli([...args, '--json'], options);
  const start = result.out.search(/[[{]/);
  const json = start === -1 ? result.out : result.out.slice(start);
  try {
    return { code: result.code, value: JSON.parse(json) as T, raw: json };
  } catch {
    return { code: result.code, value: null, raw: json };
  }
}

try {
  // ---------------------------------------------------------------- the tree is complete
  const help = cli(['--help']);
  checkTrue('the help tree prints', help.code === 0 && help.out.includes('openlab'));
  for (const topic of ['research', 'files', 'git', 'analyze', 'compute', 'tools', 'session', 'wiki']) {
    const topicHelp = cli([topic, '--help']);
    checkTrue(`openlab ${topic} --help`, topicHelp.code === 0 && topicHelp.out.length > 0);
  }

  // ---------------------------------------------------------------- a lab is a folder
  const init = cli(['init', lab, '--name', 'verify-lab', '--git']);
  checkTrue('init reports success', init.code === 0 && init.out.includes('verify-lab'));
  for (const path of ['.labconfig', 'openwiki/index.md', 'AGENTS.md', 'data/.gitkeep', 'methods/README.md']) {
    checkTrue(`init wrote ${path}`, existsSync(join(lab, path)));
  }
  checkTrue('init wrote a manifest', readFileSync(join(lab, '.labconfig'), 'utf8').includes('name: verify-lab'));
  checkTrue('init made a repository', existsSync(join(lab, '.git')));

  // ---------------------------------------------------------------- the store is the app's
  const status = cliJson<{ root: string; name: string; counts: { sessions: number }; storage: { database: string } }>(
    ['status', '-w', lab],
  );
  checkTrue('status prints JSON', status.code === 0 && status.value !== null);
  check('status names the lab', status.value?.name, 'verify-lab');
  check('status names the folder', status.value?.root, lab);
  checkTrue('status names the app database', (status.value?.storage.database ?? '').endsWith('openlab.db'));
  checkTrue('the database file exists', existsSync(join(data, 'openlab.db')));

  const tables = cliJson<{ table: string; rows: number }[]>(['db', 'tables', '--data', data]);
  checkTrue('db tables reads the schema', (tables.value ?? []).some((table) => table.table === 'projects'));

  // ---------------------------------------------------------------- backup and restore
  const backups = mkdtempSync(join(tmpdir(), 'openlab-cli-backup-'));
  const taskOne = cliJson<{ id: string }>([
    'research', 'tasks', 'new', '-w', lab, '--title', 'Keep me', '--kind', 'analysis',
  ]);
  checkTrue('a task exists before the copy', Boolean(taskOne.value?.id));
  const copy = cliJson<{ path: string; size: number }>(['db', 'backup', '--dir', backups]);
  checkTrue('db backup writes a copy', copy.code === 0 && existsSync(copy.value?.path ?? ''));
  checkTrue('the copy has content', (copy.value?.size ?? 0) > 0);
  checkTrue('the copy is a database file', readFileSync(copy.value?.path ?? '').subarray(0, 15).toString() === 'SQLite format 3');

  cliJson<{ id: string }>(['research', 'tasks', 'new', '-w', lab, '--title', 'Lose me', '--kind', 'analysis']);
  const beforeRestore = cliJson<{ title: string }[]>(['research', 'tasks', 'list', '-w', lab]);
  checkTrue('the newer task is in the store', (beforeRestore.value ?? []).some((task) => task.title === 'Lose me'));

  const refused = cli(['db', 'restore', copy.value?.path ?? '', '--data', data]);
  checkTrue('restore refuses without --yes', refused.code !== 0 && refused.out.includes('--yes'));
  const restored = cliJson<{ restored: string; safety: string | null }>(['db', 'restore', copy.value?.path ?? '', '--yes']);
  checkTrue('db restore replaces the store', restored.code === 0 && existsSync(restored.value?.restored ?? ''));
  checkTrue('restore keeps the previous store', Boolean(restored.value?.safety && existsSync(restored.value.safety)));
  const afterRestore = cliJson<{ title: string }[]>(['research', 'tasks', 'list', '-w', lab]);
  checkTrue('the copy kept the older task', (afterRestore.value ?? []).some((task) => task.title === 'Keep me'));
  checkTrue('the newer task is gone', !(afterRestore.value ?? []).some((task) => task.title === 'Lose me'));

  const junk = join(backups, 'not-a-store.db');
  writeFileSync(junk, 'this is not sqlite');
  const bad = cli(['db', 'restore', junk, '--yes']);
  checkTrue('a copy that is not a database is refused', bad.code !== 0 && bad.out.includes('not a usable copy'));

  cliJson<{ path: string }>(['db', 'backup', '--dir', backups, '--keep', '1']);
  const kept = readdirSync(backups).filter((name) => name.startsWith('openlab-') && name.endsWith('.db'));
  check('--keep prunes the older copies', kept.length, 1);
  rmSync(backups, { recursive: true, force: true });

  // ---------------------------------------------------------------- files, search, git
  const written = cli(['files', 'write', 'notes/hello.txt', '--content', 'docking scores\n', '-w', lab]);
  checkTrue('files write', written.code === 0 && existsSync(join(lab, 'notes/hello.txt')));
  const cat = cli(['files', 'cat', 'notes/hello.txt', '-w', lab]);
  check('files cat reads it back', cat.out.trim(), 'docking scores');
  const grep = cliJson<{ matches: { path: string; line: number }[] }>([
    'search', 'grep', 'docking', '-w', lab, '--path', 'notes',
  ]);
  check('search grep finds the line', grep.value?.matches[0]?.line, 1);
  const glob = cliJson<{ path: string }[]>(['search', 'glob', '**/*.txt', '-w', lab]);
  checkTrue('search glob finds the file', (glob.value ?? []).some((match) => match.path === 'notes/hello.txt'));

  const git = cli(['git', 'status', '-w', lab]);
  checkTrue('git status reads the repository', git.code === 0 && git.out.includes('hello.txt'));
  const commit = cli(['git', 'commit', '-m', 'Add a note', '--all', '-w', lab]);
  checkTrue('git commit returns a hash', commit.code === 0 && /[0-9a-f]{4,}/.test(commit.out));
  const log = cliJson<{ hash: string; subject: string }[]>(['git', 'log', '-w', lab]);
  check('git log reads the commit', log.value?.[0]?.subject, 'Add a note');

  // ---------------------------------------------------------------- the science engine
  const ttest = cliJson<{
    test: string;
    values: { t: number; p: number; meanDifference: number };
    code: { r: string; python: string };
  }>(['analyze', 'statistics', 'ttest', '--a', '5.1,4.9,6.2,5.8,6.4', '--b', '4.2,4.4,3.9,4.8,4.1']);
  check('the test is named', ttest.value?.test, 'welch-t-test');
  checkTrue('the t statistic is computed', Math.abs((ttest.value?.values.t ?? 0) - 4.2059) < 0.01);
  checkTrue('the p value is computed', Math.abs((ttest.value?.values.p ?? 0) - 0.005651) < 0.001);
  checkTrue('the R reproduction is emitted', (ttest.value?.code.r ?? '').includes('t.test'));
  checkTrue('the Python reproduction is emitted', (ttest.value?.code.python ?? '').includes('scipy'));

  const anova = cliJson<{ values: { f: number } }>(
    ['analyze', 'statistics', 'anova', '--data', '-', '--groups', 'control,treatment'],
    { input: 'control,treatment\n5.1,4.2\n4.9,4.4\n6.2,3.9\n5.8,4.8\n6.4,4.1\n' },
  );
  checkTrue('anova reads CSV from stdin and computes F', (anova.value?.values.f ?? 0) > 1);

  // ---------------------------------------------------------------- the tracker and the plan
  const task = cliJson<{ id: string; title: string }>([
    'research', 'tasks', 'new', '-w', lab, '--title', 'Dock the panel', '--kind', 'analysis',
  ]);
  checkTrue('research tasks new returns an id', Boolean(task.value?.id));
  const tasks = cliJson<{ title: string; status: string }[]>(['research', 'tasks', 'list', '-w', lab]);
  check('the task is listed', tasks.value?.[0]?.title, 'Dock the panel');
  check('a new task starts in the backlog', tasks.value?.[0]?.status, 'backlog');

  const plan = cli(['plan', 'export', '-w', lab]);
  checkTrue('plan export writes the plan', plan.code === 0 && existsSync(join(lab, '.openlab/plan/backlog.md')));
  const backlog = existsSync(join(lab, '.openlab/plan/backlog.md'))
    ? readFileSync(join(lab, '.openlab/plan/backlog.md'), 'utf8')
    : '';
  checkTrue('the plan holds the task', backlog.includes('Dock the panel'));

  // ---------------------------------------------------------------- providers and models
  const providers = cliJson<{ id: string }[]>(['providers', 'list', '--data', data]);
  checkTrue('providers list includes anthropic', (providers.value ?? []).some((p) => p.id === 'anthropic'));
  const models = cliJson<{ ref: string }[]>(['models', 'search', 'claude', '--data', data, '--limit', '5']);
  checkTrue('models search finds a model', (models.value ?? []).length > 0);

  // ---------------------------------------------------------------- secrets
  const set = cli(['secrets', 'set', '--name', 'verify', '--value', 'hunter2', '--data', data]);
  checkTrue('secrets set stores a value', set.code === 0);
  const list = cliJson<{ stored: string[] }>(['secrets', 'list', '--data', data]);
  checkTrue(
    'secrets list names it without its value',
    (list.value?.stored ?? []).includes('verify') && !list.raw.includes('hunter2'),
  );

  // ---------------------------------------------------------------- the workspace files
  const wiki = cliJson<{ pages: { path: string }[] }>(['wiki', 'list', '-w', lab]);
  checkTrue(
    'wiki list finds the starter pages',
    (wiki.value?.pages ?? []).some((page) => page.path.includes('index.md')),
  );
  const config = cliJson<{ manifest: { name: string } }>(['workspace', 'info', '-w', lab]);
  check('workspace info reads the manifest', config.value?.manifest.name, 'verify-lab');

  const doctor = cli(['doctor', '-w', lab]);
  checkTrue('doctor reports', doctor.code === 0 && doctor.out.includes('store'));
} finally {
  rmSync(data, { recursive: true, force: true });
  rmSync(lab, { recursive: true, force: true });
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: the CLI is the workbench — same store, same folder, same engine');
