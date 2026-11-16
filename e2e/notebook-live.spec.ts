/**
 * A notebook run, while it runs.
 *
 * The driver saves the notebook after every cell, so the page can follow the run: a cell with
 * a count is done, and the first code cell without one is the one being executed — Jupyter's
 * `In [*]`. This test drives a fake run that writes one more cell every time the page reads
 * the file, and checks that the star is on the right cell and then leaves.
 *
 * It also checks the thing that makes the run live at all: the driver is written into the
 * workspace first, so what executes is a file a reader can open.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, type Page } from '@playwright/test';

import { installTauriShim } from './tauri-shim';

const NOTEBOOK = 'analysis.ipynb';
const SOURCE = readFileSync(join(import.meta.dirname, 'fixtures', NOTEBOOK), 'utf8');

async function openNotebook(page: Page): Promise<void> {
  await page.addInitScript(installTauriShim);
  await page.addInitScript(
    ([name, text]) => {
      const internals = (window as unknown as Record<string, any>).__TAURI_INTERNALS__;
      const inner = internals.invoke;
      /** The notebook as a run would have left it after `done` code cells. */
      const staged = (done: number) => {
        const doc = JSON.parse(String(text));
        let index = 0;
        for (const cell of doc.cells) {
          if (cell.cell_type !== 'code') continue;
          index += 1;
          if (index <= done) {
            cell.execution_count = index;
            cell.outputs = [{ output_type: 'stream', name: 'stdout', text: [`cell ${index}\n`] }];
          } else {
            cell.execution_count = null;
            cell.outputs = [];
          }
        }
        return JSON.stringify(doc);
      };
      let started = false;
      let polls = 0;
      internals.invoke = (cmd: string, args: any) => {
        if (cmd === 'list_dir')
          return Promise.resolve([
            { name, path: name, isDir: false, isSymlink: false, size: text.length, modifiedMs: Date.now() },
          ]);
        if (cmd === 'read_file') {
          if (!started) return Promise.resolve(text);
          polls += 1;
          return Promise.resolve(staged(Math.min(3, polls)));
        }
        if (cmd === 'write_file') {
          if (String(args?.path ?? '').endsWith('notebook-run.py')) {
            (window as any).__driver = String(args?.contents ?? '');
          }
          return Promise.resolve(null);
        }
        if (cmd === 'run_command') {
          started = true;
          // A run that takes long enough for the page to read the file a few times.
          return new Promise((resolve) =>
            setTimeout(() => resolve({ output: 'openlab: 5 cells executed', exitCode: 0 }), 4000),
          );
        }
        if (cmd === 'secrets_status') return Promise.resolve([]);
        return inner(cmd, args);
      };
    },
    [NOTEBOOK, SOURCE],
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Create workspace…' }).click();
  await page.getByRole('button', { name: /Choose a folder/ }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('tab', { name: 'Files' }).click();
  await page
    .getByRole('button', { name: new RegExp(NOTEBOOK) })
    .first()
    .click();
}

test('a run marks the cell it is on, then clears', async ({ page }) => {
  await openNotebook(page);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: /This machine/ }).click();

  // The cell being executed carries the star; the finished ones carry their counts.
  await expect(page.getByText('In [*]').first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('In [1]')).toBeVisible();

  // The driver reached the workspace, and it is the one that drives a kernel.
  const driver = await page.evaluate(() => (window as any).__driver ?? '');
  expect(driver).toContain('NotebookClient');
  expect(driver).toContain('setup_kernel');

  // When the run returns, the star leaves and the counts stay.
  await expect(page.getByText('In [*]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('In [3]')).toBeVisible();
});
