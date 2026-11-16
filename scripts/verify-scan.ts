/**
 * Checks the PDF scan worker.
 *
 * Run with: `bun scripts/verify-scan.ts`
 *
 * The worker is the Python process the app spawns for Surya, embeddings and the index.
 * This script runs its offline selftest — no network, no models — and then drives the
 * JSON-lines protocol the Rust command speaks: health, a scan of a fixture document, a
 * search that must find the passage, and the progress events in between. The heavy engines
 * (Surya, llama.cpp, LanceDB, Mojo) are reported by `health` when they are installed; the
 * checks that must always hold are the ones that do not need them.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function checkTruthy(label: string, value: unknown) {
  if (value) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}`);
}

const worker = join(import.meta.dir, '..', 'src-tauri', 'resources', 'worker', 'worker.py');
// The bundled environment is the one the app ships; a checkout without it uses the path.
const bundledPython = join(import.meta.dir, '..', 'src-tauri', 'resources', 'python', 'bin', 'python3');
const python = existsSync(bundledPython) ? bundledPython : 'python3';

/* ================================================================================================
 * The worker's own checks
 * ============================================================================================== */

console.log('\n— the worker selftest —');
{
  const selftest = spawnSync(python, [worker, '--selftest'], { encoding: 'utf8', timeout: 120_000 });
  check('the selftest runs', selftest.status, 0);
  if (selftest.status !== 0) {
    console.log(selftest.stderr?.slice(0, 2000));
  } else {
    const payload = JSON.parse(selftest.stdout) as {
      ok: boolean;
      checks: { label: string; ok: boolean; detail: unknown }[];
      health: Record<string, unknown>;
    };
    for (const item of payload.checks) {
      check(item.label, item.ok, true);
    }
    check('every selftest check passed', payload.ok, true);
  }
}

/* ================================================================================================
 * The protocol the Rust command speaks
 * ============================================================================================== */

console.log('\n— the protocol —');
{
  const root = mkdtempSync(join(tmpdir(), 'openlab-scan-'));
  const fixture = join(root, 'fixture.md');
  writeFileSync(
    fixture,
    [
      '# Chromatin and off-target prediction',
      '',
      'Chromatin accessibility improves off-target prediction over sequence alone.',
      '',
      'Battery economics are unrelated to this fixture.',
      '',
    ].join('\n'),
    'utf8',
  );

  const requests = [
    { id: '1', op: 'health', args: {} },
    { id: '2', op: 'scan_pdf', args: { path: fixture, docId: 'fixture' } },
    { id: '3', op: 'search', args: { query: 'chromatin', limit: 5 } },
    { id: '4', op: 'status', args: { docIds: ['fixture'] } },
    { id: '5', op: 'nonsense', args: {} },
  ];

  const session = spawnSync(
    python,
    [worker, '--root', join(root, 'index'), '--embed-url', 'http://127.0.0.1:1'],
    {
      input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
      encoding: 'utf8',
      timeout: 120_000,
    },
  );

  const lines = session.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id?: string; event?: string; result?: any; error?: string });
  const done = (id: string) => lines.find((line) => line.id === id && line.event === 'done');

  checkTruthy('health answers', Boolean(done('1')?.result?.store));
  checkTruthy('and names the hot path', typeof done('1')?.result?.hot_path === 'string');
  checkTruthy(
    'and the Python it runs on',
    typeof done('1')?.result?.python === 'string' && done('1').result.python.startsWith('3.'),
    done('1')?.result?.python,
  );
  check('a fixture document is indexed', done('2')?.result?.status, 'indexed');
  checkTruthy('with chunks', (done('2')?.result?.chunks ?? 0) > 0);

  const hits = (done('3')?.result?.hits ?? []) as { snippet: string; page: number }[];
  checkTruthy('search finds the passage', hits.length > 0 && /chromatin/i.test(hits[0]?.snippet ?? ''));
  check('and carries the page', hits[0]?.page, 1);
  checkTruthy(
    'progress events were emitted',
    lines.some((line) => line.event === 'progress'),
  );
  check('status lists the document', (done('4')?.result ?? []).length, 1);

  const unknown = lines.find((line) => line.id === '5');
  check('an unknown op is a readable error', unknown?.event, 'error');
  checkTruthy('and names the op', (unknown?.error ?? '').includes('nonsense'));

  rmSync(root, { recursive: true, force: true });
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: the scan worker indexes a document and answers the protocol');
