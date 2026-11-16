/**
 * The terminal layer, where it is not interactive.
 *
 * A test runner has no TTY, which is also what `openlab ... | jq` looks like: the spinner must
 * be silent, colour must be off, and a wrapped call must still return its value. That is the
 * contract the rest of the CLI relies on when it runs in a script or CI.
 */

import { describe, expect, test } from 'bun:test';

import { interactive, pc, spinner, withSpinner } from './ui';

describe('a piped terminal', () => {
  test('is not interactive', () => {
    expect(interactive).toBe(false);
  });

  test('draws no colour', () => {
    expect(pc.red('plain')).toBe('plain');
    expect(pc.bold('plain')).toBe('plain');
  });

  test('shows no spinner', () => {
    expect(spinner('working').isEnabled).toBe(false);
  });

  test('still returns what the wrapped work produced', async () => {
    expect(await withSpinner('working', async () => 42)).toBe(42);
  });

  test('propagates a failure unchanged', async () => {
    await expect(
      withSpinner('working', async () => {
        throw new Error('the work failed');
      }),
    ).rejects.toThrow('the work failed');
  });
});
