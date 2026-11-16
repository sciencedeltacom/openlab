/**
 * Checks how two paired folders are compared.
 *
 * Run with: `bun scripts/verify-sync.ts`
 *
 * A comparison decides which side a file has to move from, and a wrong call is an overwrite.
 * The rule is pinned here: matched by relative path, in sync when both sides report one size,
 * and a native Google document never claims an answer it cannot have.
 */

import { diffSides, isNative, type RemoteFile, type SyncRow } from '../src/lib/cloud/diff';
import type { WalkedFile } from '../src/lib/workspace-files';
import type { RemoteEntry } from '../src/lib/cloud/types';

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

/** A local file, with only the fields the comparison reads. */
function local(path: string, size: number): WalkedFile {
  return { path, name: path.split('/').pop() ?? path, size, modified: 0 };
}

/** A remote file, with only the fields the comparison reads. */
function remote(path: string, size: number | undefined, mime = 'text/csv'): RemoteFile {
  const entry: RemoteEntry = {
    key: `id-${path}`,
    name: path.split('/').pop() ?? path,
    size,
    mime,
  };
  return { path, entry };
}

/** Every row's path with its state, which is the whole answer of a comparison. */
function shape(rows: SyncRow[]): [string, string][] {
  return rows.map((row) => [row.path, row.state]);
}

console.log('\n— which side a file is on —');
{
  const diff = diffSides(
    [local('notes.md', 10), local('raw/a.csv', 40)],
    [remote('notes.md', 10), remote('raw/b.csv', 20)],
  );
  check('a file on one side only says which side', shape(diff.rows), [
    ['notes.md', 'same'],
    ['raw/a.csv', 'local-only'],
    ['raw/b.csv', 'remote-only'],
  ]);
  check('and the totals add up', diff.counts, {
    'local-only': 1,
    'remote-only': 1,
    same: 1,
    differs: 0,
    unknown: 0,
  });
}

console.log('\n— when the two copies disagree —');
{
  const diff = diffSides([local('raw/a.csv', 40)], [remote('raw/a.csv', 41)]);
  check('a different size is a conflict', shape(diff.rows), [['raw/a.csv', 'differs']]);

  const same = diffSides([local('raw/a.csv', 40)], [remote('raw/a.csv', 40)]);
  check('the same size is in sync', shape(same.rows), [['raw/a.csv', 'same']]);

  const unsized = diffSides([local('raw/a.csv', 40)], [remote('raw/a.csv', undefined)]);
  check('an unreported size is not a guess', shape(unsized.rows), [['raw/a.csv', 'unknown']]);
}

console.log('\n— matching is by path, not by name —');
{
  const diff = diffSides([local('a.csv', 1)], [remote('raw/a.csv', 1)]);
  check('a file in another folder is not the same file', shape(diff.rows), [
    ['a.csv', 'local-only'],
    ['raw/a.csv', 'remote-only'],
  ]);
}

console.log('\n— a Google document —');
{
  const doc = remote('plan', undefined, 'application/vnd.google-apps.document');
  check('is recognised by its type', isNative(doc.entry), true);
  check('a plain file is not', isNative(remote('plan.pdf', 12, 'application/pdf').entry), false);

  const diff = diffSides([local('plan.pdf', 12)], [doc]);
  check('two different names stay two rows', diff.rows.length, 2);

  const paired = diffSides(
    [local('plan', 12)],
    [{ path: 'plan', entry: { ...doc.entry, name: 'plan', size: 12 } }],
  );
  check('a native document never claims to be in sync', shape(paired.rows), [['plan', 'unknown']]);
  check('and it is marked as one', paired.rows[0]?.native, true);
}

console.log('\n— ordering —');
{
  const diff = diffSides([local('z.csv', 1), local('A.csv', 1)], [remote('m.csv', 1)]);
  check(
    'rows are sorted by path, so two comparisons read the same',
    diff.rows.map((row) => row.path),
    ['A.csv', 'm.csv', 'z.csv'],
  );
}

if (failures > 0) {
  console.log(`\n${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('\nall checks passed');
