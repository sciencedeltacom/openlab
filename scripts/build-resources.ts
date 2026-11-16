/**
 * Build the release resources for this machine.
 *
 * Run with: `bun run resources:build`
 *
 * `tauri.conf.json` bundles `resources/worker`, `resources/bin` and `resources/mojo`; only the
 * worker is in git. This puts the other two in place and then writes the archive the release
 * workflow consumes:
 *
 *   - `mojo/`: compiled by `mojo/build.sh` when Mojo is installed. Optional: the worker falls
 *     back to its Python twin, and the release fails only if `bin` is missing.
 *   - `bin/`: the embedding server (`llama-server`, its dylibs and the GGUF is kept in app
 *     data). Fetch a pinned llama.cpp archive with `OPENLAB_LLAMA_URL` and
 *     `OPENLAB_LLAMA_SHA256`, or place the binary there yourself (see the worker README).
 *
 * The digest is checked before extraction. A resource build without a verified archive is
 * refused: the bundle is what every install runs.
 */

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dir, '..');
const RESOURCES = join(ROOT, 'src-tauri', 'resources');
const BIN = join(RESOURCES, 'bin');
const MOJO = join(RESOURCES, 'mojo');

let failures = 0;
const say = (message: string) => console.log(message);
const fail = (message: string) => {
  failures += 1;
  console.error(`FAIL ${message}`);
};

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** True when a binary runs and prints a version. */
function runs(binary: string): boolean {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  return result.status === 0;
}

/** Mojo is optional; the worker reports the fallback when the extension is absent. */
function buildMojo(): void {
  const script = join(MOJO, 'build.sh');
  if (!existsSync(script)) {
    fail('mojo/build.sh is missing');
    return;
  }
  const result = spawnSync('bash', [script], { stdio: 'inherit', cwd: MOJO });
  if (result.status !== 0) {
    fail('mojo/build.sh failed');
    return;
  }
  const extension = join(MOJO, 'openlab_scan.so');
  if (existsSync(extension)) {
    say(`ok   mojo hot path  ${sha256(extension).slice(0, 12)}…`);
  } else {
    say('warn mojo hot path absent; the Python twin will be used');
  }
}

/** Fetch and verify the llama archive, when one was named. */
async function fetchBin(): Promise<void> {
  const url = process.env.OPENLAB_LLAMA_URL?.trim();
  const expected = process.env.OPENLAB_LLAMA_SHA256?.trim().toLowerCase();
  const binary = join(BIN, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');

  if (!url) {
    if (existsSync(binary) && runs(binary)) {
      say(`ok   embedding server  ${binary}`);
      return;
    }
    fail(
      'resources/bin has no working llama-server. Set OPENLAB_LLAMA_URL and OPENLAB_LLAMA_SHA256, or build it per src-tauri/resources/worker/README.md.',
    );
    return;
  }
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    fail('OPENLAB_LLAMA_URL is set but OPENLAB_LLAMA_SHA256 is not a 64-character hex digest');
    return;
  }
  if (!/^https:\/\//.test(url)) {
    fail('OPENLAB_LLAMA_URL must be https');
    return;
  }

  const archive = join(RESOURCES, 'llama-archive');
  const response = await fetch(url, { headers: { 'User-Agent': 'openlab/1.0 (resources)' } });
  if (!response.ok) {
    fail(`the archive answered ${response.status}`);
    return;
  }
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  const actual = sha256(archive);
  if (actual !== expected) {
    rmSync(archive, { force: true });
    fail(`the archive's SHA-256 is ${actual}, not the pinned ${expected}`);
    return;
  }

  mkdirSync(BIN, { recursive: true });
  // bsdtar reads both tar.gz and zip; `--strip-components=1` drops the release folder.
  const extract = spawnSync('tar', ['-xf', archive, '-C', BIN, '--strip-components=1'], { stdio: 'inherit' });
  rmSync(archive, { force: true });
  if (extract.status !== 0) {
    fail('the archive could not be extracted');
    return;
  }
  if (!existsSync(binary)) {
    fail(`the archive held no ${binary}`);
    return;
  }
  if (process.platform !== 'win32') chmodSync(binary, 0o755);
  if (!runs(binary)) {
    fail(`${binary} does not run on this machine`);
    return;
  }
  say(`ok   embedding server  ${binary}`);
}

/** The archive the release workflow uploads, plus its digest. */
function pack(): void {
  const target = `${process.platform}-${process.arch}`;
  const archive = join(ROOT, `resources-${target}.tar.gz`);
  const result = spawnSync('tar', ['-czf', archive, '-C', RESOURCES, 'bin', 'mojo'], { stdio: 'inherit' });
  if (result.status !== 0) {
    fail('could not write the resources archive');
    return;
  }
  const digest = sha256(archive);
  writeFileSync(`${archive}.sha256`, `${digest}  ${archive}\n`);
  say(`ok   ${archive}`);
  say(`     sha256 ${digest}`);
}

console.log('— resources —');
buildMojo();
await fetchBin();
if (existsSync(BIN) && readdirSync(BIN).length > 0) {
  pack();
}
if (failures > 0) {
  console.error(`\n${failures} resource step(s) failed`);
  process.exit(1);
}
console.log('\nOK: the resources for this machine are in place');
