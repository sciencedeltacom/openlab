/**
 * The architecture benchmark.
 *
 * A plan is only worth its measurements, so this records the numbers the plan claims to move:
 * how the Rust vector index scales as the corpus grows, how the Python store scales as the
 * index grows, and how much module-global mutable state the frontend still carries. It writes
 * `benchmark/<label>.json`; `compare` prints two of them side by side.
 *
 *     bun scripts/benchmark.ts baseline     # before a change
 *     bun scripts/benchmark.ts after        # after
 *     bun scripts/benchmark.ts compare baseline after
 *
 * The Rust leg runs in the dev profile (what `cargo test` builds) so a baseline is quick; the
 * numbers are for comparing runs of the same profile, not for an absolute figure.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(import.meta.dir, '..');
const OUT_DIR = join(APP, 'benchmark');
const BENCH_ROWS = process.env.OPENLAB_BENCH_ROWS ?? '4000';

/** Run a command, returning stdout (and stderr appended on failure). */
function run(
  command: string,
  args: string[],
  cwd = APP,
  env: Record<string, string> = {},
): { ok: boolean; out: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { ok: result.status === 0, out };
}

/** The Rust leg: the index build over a synthetic corpus. */
function rustBench(): Record<string, unknown> | null {
  const result = run(
    'cargo',
    [
      'test',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--lib',
      '--',
      '--ignored',
      '--nocapture',
      '--exact',
      'commands::vectors::tests::bench_sync',
    ],
    APP,
    { OPENLAB_BENCH_ROWS: BENCH_ROWS },
  );
  const line = result.out.split('\n').find((candidate) => candidate.includes('BENCH {'));
  if (!line) {
    return { error: result.ok ? 'no BENCH line' : 'cargo test failed' };
  }
  const json = line.slice(line.indexOf('BENCH {') + 'BENCH '.length);
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { error: 'unparsable BENCH line', raw: line };
  }
}

/** The Rust leg's baseline: the pre-change algorithm, run in the same process batch. */
function rustLegacyBench(): Record<string, unknown> | null {
  const result = run(
    'cargo',
    [
      'test',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--lib',
      '--',
      '--ignored',
      '--nocapture',
      '--exact',
      'commands::vectors::tests::bench_sync_legacy',
    ],
    APP,
    { OPENLAB_BENCH_ROWS: BENCH_ROWS },
  );
  const line = result.out.split('\n').find((candidate) => candidate.includes('BENCH-LEGACY {'));
  if (!line) {
    return { error: result.ok ? 'no BENCH-LEGACY line' : 'cargo test failed' };
  }
  try {
    return JSON.parse(line.slice(line.indexOf('BENCH-LEGACY {') + 'BENCH-LEGACY '.length)) as Record<string, unknown>;
  } catch {
    return { error: 'unparsable BENCH-LEGACY line', raw: line };
  }
}

/** The Python leg: the store over a synthetic corpus, with its peak resident set. */
function pythonBench(): Record<string, unknown> | null {
  const bundled = join(APP, 'src-tauri', 'resources', 'python', 'bin', 'python3');
  const python = existsSync(bundled) ? bundled : 'python3';
  const worker = join(APP, 'src-tauri', 'resources', 'worker', 'worker.py');
  const result = run(python, [worker, '--bench', BENCH_ROWS]);
  const line = result.out.trim().split('\n').filter(Boolean).at(-1);
  if (!line) {
    return { error: result.ok ? 'no output' : 'the worker bench failed' };
  }
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { error: 'unparsable worker output', raw: line.slice(0, 400) };
  }
}

/** Every `.ts`/`.tsx` under a directory. */
function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      found.push(...sources(path));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The frontend leg: how much module-global mutable state the library still carries.
 *
 * These are the shapes the dependency-injection work is meant to remove — a mutable binding at
 * module scope, a listener registry, a cache with no ceiling, an external store.
 */
function frontendState(): Record<string, number> {
  const files = sources(join(APP, 'src', 'lib'));
  let moduleLet = 0;
  let listenerSets = 0;
  let moduleMaps = 0;
  let externalStores = 0;
  const storeFiles = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (/^let \w/.test(line)) moduleLet += 1;
      if (/^const \w+ = new Set/.test(line)) listenerSets += 1;
      if (/^const \w+ = new Map/.test(line)) moduleMaps += 1;
    }
    if (text.includes('useSyncExternalStore')) {
      externalStores += (text.match(/useSyncExternalStore\(/g) ?? []).length;
      storeFiles.add(file.replace(APP + '/', ''));
    }
  }
  return {
    files: files.length,
    moduleLet,
    listenerSets,
    moduleMaps,
    externalStores,
    storeFiles: storeFiles.size,
  };
}

/**
 * The frontend caps, measured in-process.
 *
 * Each is a bound the architecture work introduced: the LRU never exceeds its capacity, the
 * transcript never exceeds its window, a run list never exceeds its limit, and a scoped buffer
 * is empty after its scope is disposed.
 */
async function frontendCaps(): Promise<Record<string, unknown>> {
  const { LruCache } = await import('../src/lib/cache/lru');
  const { windowMessages, TRANSCRIPT_WINDOW } = await import('../src/store/transcript');
  const { root, services } = await import('../src/lib/container');
  const { startReview } = await import('../src/lib/literature/runner');
  const { seedState } = await import('../src/store/seed');

  // A cache with a ceiling stays at the ceiling.
  const lru = new LruCache<string, number>(100);
  for (let index = 0; index < 10_000; index += 1) lru.set(`k${index}`, index);
  const lruAtCap = lru.size;

  // A transcript keeps the window, however long the session ran.
  const messages = Array.from({ length: TRANSCRIPT_WINDOW + 5_000 }, (_, index) => ({ id: `m${index}` }));
  const transcriptKept = windowMessages(messages as never[]).length;

  // A scoped buffer is created per run and empty after its scope is disposed.
  const scope = root.createScope();
  const buffer = scope.get('runBuffer');
  for (let index = 0; index < 1_000; index += 1) buffer.mark(`p${index}`);
  const scopedHeld = buffer.count;
  await scope.dispose();
  const scopedAfterDispose = buffer.count;

  // The run list keeps its limit even after many runs.
  const inputs = {
    question: 'cap test',
    inclusion: '',
    exclusion: '',
    dateRange: '',
    sources: [],
    maxRecords: 1,
    depth: 'quick' as const,
    analysis: [],
    format: 'report',
  };
  const runner = async () => ({}) as never;
  for (let index = 0; index < 80; index += 1) {
    startReview(seedState(), inputs, runner);
  }
  const runsKept = services.reviewRuns.store.get().length;

  return { lruAtCap, transcriptKept, transcriptWindow: TRANSCRIPT_WINDOW, scopedHeld, scopedAfterDispose, runsKept };
}

/** Collect every leg and write the record. */
async function collect(label: string): Promise<void> {
  console.log(`benchmark: ${label} (rows=${BENCH_ROWS})`);
  const rust = rustBench();
  const rustLegacy = rustLegacyBench();
  const python = pythonBench();
  const frontend = { ...frontendState(), ...(await frontendCaps()) };
  const record = {
    label,
    at: new Date().toISOString(),
    rows: Number(BENCH_ROWS),
    rust,
    rustLegacy,
    python,
    frontend,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${label}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`wrote ${path.replace(APP + '/', '')}`);
  console.log(JSON.stringify(record, null, 2));
}

/** Print two records side by side. */
function compare(beforeLabel: string, afterLabel: string): void {
  const load = (label: string) =>
    JSON.parse(readFileSync(join(OUT_DIR, `${label}.json`), 'utf8')) as Record<string, any>;
  const before = load(beforeLabel);
  const after = load(afterLabel);

  const rows: [string, unknown, unknown][] = [
    ['rust sync_ms', before.rust?.sync_ms, after.rust?.sync_ms],
    ['rust rss_after_mb', before.rust?.rss_after_mb, after.rust?.rss_after_mb],
    ['python bm25_ms', before.python?.timings?.bm25_ms, after.python?.timings?.bm25_ms],
    ['python search_ms', before.python?.timings?.search_ms, after.python?.timings?.search_ms],
    ['python peak_rss_mb', before.python?.peak_rss_mb, after.python?.peak_rss_mb],
    ['frontend moduleLet', before.frontend?.moduleLet, after.frontend?.moduleLet],
    ['frontend listenerSets', before.frontend?.listenerSets, after.frontend?.listenerSets],
    ['frontend externalStores', before.frontend?.externalStores, after.frontend?.externalStores],
    ['frontend lruAtCap', before.frontend?.lruAtCap, after.frontend?.lruAtCap],
    ['frontend transcriptKept', before.frontend?.transcriptKept, after.frontend?.transcriptKept],
    ['frontend scopedAfterDispose', before.frontend?.scopedAfterDispose, after.frontend?.scopedAfterDispose],
    ['frontend runsKept', before.frontend?.runsKept, after.frontend?.runsKept],
  ];

  console.log(`\n${beforeLabel} → ${afterLabel}\n`);
  console.log('metric'.padEnd(24), beforeLabel.padStart(12), afterLabel.padStart(12), 'change'.padStart(12));
  for (const [name, left, right] of rows) {
    const change =
      typeof left === 'number' && typeof right === 'number' && left !== 0
        ? `${(((right - left) / left) * 100).toFixed(1)}%`
        : '—';
    console.log(
      name.padEnd(24),
      String(left ?? '—').padStart(12),
      String(right ?? '—').padStart(12),
      change.padStart(12),
    );
  }

  // The Rust timing rows above span two system loads, so they are not comparable. This is the
  // same-run pair: the pre-change algorithm against the streaming one, measured together.
  if (after.rustLegacy && after.rust) {
    console.log('\nsame run — the baseline algorithm against the streaming one (after record)\n');
    const pair: [string, unknown, unknown][] = [
      ['rust rss_after_mb', after.rustLegacy.rss_after_mb, after.rust.rss_after_mb],
      ['rust sync_ms', after.rustLegacy.sync_ms, after.rust.sync_ms],
    ];
    for (const [name, legacy, streaming] of pair) {
      const change =
        typeof legacy === 'number' && typeof streaming === 'number' && legacy !== 0
          ? `${(((streaming - legacy) / legacy) * 100).toFixed(1)}%`
          : '—';
      console.log(
        name.padEnd(24),
        String(legacy ?? '—').padStart(12),
        String(streaming ?? '—').padStart(12),
        change.padStart(12),
      );
    }
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'compare') {
  compare(rest[0] ?? 'baseline', rest[1] ?? 'after');
} else {
  await collect(command && command !== '' ? command : 'baseline');
}
