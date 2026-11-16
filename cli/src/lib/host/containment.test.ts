/**
 * Workspace containment.
 *
 * A path that leaves the workspace must be refused, and the sibling that merely shares the
 * root's prefix (`/lab` vs `/lab-evil`) must not slip through a `startsWith` check.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scopedDir, scopedRead, scopedWrite } from './fs';
import { globFiles, grepFiles } from './search';
import { workingDir } from './exec';

let parent: string;
let root: string;
let sibling: string;

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'openlab-contain-'));
  root = join(parent, 'lab');
  sibling = join(parent, 'lab-evil');
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(root, 'data', 'ok.txt'), 'inside\n');
  writeFileSync(join(sibling, 'secret.txt'), 'outside\n');
});

afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
});

describe('scopedRead', () => {
  test('reads an inside path', () => {
    expect(scopedRead('data/ok.txt', root)).toBe(realpathSync(join(root, 'data', 'ok.txt')));
  });

  test('refuses ..', () => {
    expect(() => scopedRead(`../${'lab-evil'}/secret.txt`, root)).toThrow(/outside/);
  });

  test('refuses a sibling that shares the prefix', () => {
    expect(() => scopedRead(`../lab-evil/secret.txt`, root)).toThrow(/outside/);
  });

  test('refuses an absolute path outside', () => {
    expect(() => scopedRead(join(sibling, 'secret.txt'), root)).toThrow(/outside/);
  });

  test('refuses a symlink that points outside', () => {
    symlinkSync(join(sibling, 'secret.txt'), join(root, 'link.txt'));
    expect(() => scopedRead('link.txt', root)).toThrow(/outside/);
  });
});

describe('scopedWrite', () => {
  test('creates parents inside the workspace', () => {
    const target = scopedWrite('new/nested/file.txt', root);
    writeFileSync(target, 'ok');
    expect(existsSync(target)).toBe(true);
  });

  test('refuses a path outside without creating directories', () => {
    expect(() => scopedWrite('../outside/new/file.txt', root)).toThrow(/outside/);
    expect(existsSync(join(parent, 'outside'))).toBe(false);
  });

  test('refuses a symlinked parent that points outside', () => {
    symlinkSync(sibling, join(root, 'escape'));
    expect(() => scopedWrite('escape/new/file.txt', root)).toThrow(/outside/);
    expect(existsSync(join(sibling, 'new'))).toBe(false);
  });
});

describe('search bases', () => {
  test('scopedDir refuses a sibling', () => {
    expect(() => scopedDir('../lab-evil', root)).toThrow(/outside/);
  });

  test('globFiles refuses a path outside', () => {
    expect(() => globFiles('*.txt', root, '../lab-evil')).toThrow(/outside/);
  });

  test('grepFiles refuses a path outside', () => {
    expect(() => grepFiles('outside', root, { path: '../lab-evil' })).toThrow(/outside/);
  });

  test('globFiles still finds inside files', () => {
    expect(globFiles('**/*.txt', root).map((match) => match.relative)).toEqual(['data/ok.txt']);
  });
});

describe('workingDir', () => {
  test('refuses a sibling', () => {
    expect(() => workingDir('../lab-evil', root)).toThrow(/outside/);
  });

  test('accepts an inside directory', () => {
    expect(workingDir('data', root)).toBe(realpathSync(join(root, 'data')));
  });
});
