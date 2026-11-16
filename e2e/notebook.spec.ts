/**
 * The notebook preview and editor, on a real notebook file.
 *
 * A notebook is the one file kind whose surface is a document rather than a text editor, and
 * it has four ways to go wrong that a screenshot would catch and a type check would not: the
 * prose not rendering, the prompts missing, a saved table drawn as its plain-text fallback,
 * and an error traceback losing its colour. This opens a fixture through the real Files page
 * and checks each of those.
 *
 * It also checks the two things a reader does with it: rewrite a cell and save (the outputs
 * must survive the save), and pick the kernel the file declares.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, type Page } from '@playwright/test';

import { installTauriShim } from './tauri-shim';

const NOTEBOOK = 'analysis.ipynb';
const SOURCE = readFileSync(join(import.meta.dirname, 'fixtures', NOTEBOOK), 'utf8');

/** Seed one notebook in a workspace, then open it from the Files page. */
async function openNotebook(page: Page): Promise<void> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));
  (page as unknown as { problems: string[] }).problems = problems;

  await page.addInitScript(installTauriShim);
  await page.addInitScript(
    ([name, text]) => {
      const internals = (window as unknown as Record<string, any>).__TAURI_INTERNALS__;
      const inner = internals.invoke;
      let ran = false;
      internals.invoke = (cmd: string, args: any) => {
        if (cmd === 'list_dir') {
          return Promise.resolve([
            { name, path: name, isDir: false, isSymlink: false, size: text.length, modifiedMs: Date.now() },
          ]);
        }
        if (cmd === 'read_file') {
          // `nbconvert --inplace` rewrites the file, so the read after a run answers with the
          // last saved notebook plus the output the run wrote into it.
          const writes = (window as any).__writes ?? [];
          if (ran && writes.length > 0) {
            const doc = JSON.parse(writes[writes.length - 1]);
            const cell = doc.cells.find((entry: any) => entry.cell_type === 'code');
            cell.execution_count = 7;
            cell.outputs = [{ output_type: 'stream', name: 'stdout', text: ['ran on the target\n'] }];
            return Promise.resolve(JSON.stringify(doc));
          }
          return Promise.resolve(text);
        }
        if (cmd === 'write_file') {
          // Only the notebook's own saves; the run's driver is written beside it.
          if (String(args?.path ?? '').endsWith('.ipynb')) {
            ((window as any).__writes ??= []).push(String(args?.contents ?? ''));
          }
          return Promise.resolve(null);
        }
        // A run of the notebook is a job; the harness answers the submission like a target
        // that has nbconvert installed, and keeps the command it was given.
        if (cmd === 'run_command') {
          ((window as any).__runs ??= []).push(String(args?.command ?? ''));
          ran = true;
          return Promise.resolve({ output: 'executed', exitCode: 0 });
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

/** The notebook JSON the last save wrote. */
async function lastWrite(page: Page): Promise<Record<string, any> | null> {
  const writes = await page.evaluate(() => (window as any).__writes ?? []);
  const text = writes[writes.length - 1];
  return text ? JSON.parse(text) : null;
}

test('a notebook reads, edits and declares its kernel', async ({ page }) => {
  await openNotebook(page);

  // The bar is the notebook's own controls: the kernel, the run, and its environment. No
  // language label on the left, no cell census.
  await expect(page.getByText('Python', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Python 3\.12/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run environment' })).toBeVisible();
  await expect(page.getByText(/cells ·/)).toHaveCount(0);

  // Markdown cells are prose, and the prompts are the kernel's own.
  await expect(page.getByRole('heading', { name: 'EGFR inhibitor response' })).toBeVisible();
  await expect(page.getByText('In [1]')).toBeVisible();
  await expect(page.getByText('In [ ]')).toBeVisible();

  // A stream is text, and an execute_result with HTML is the table it was saved as.
  await expect(page.getByText('loaded 79 wells from data/egfr-2024.csv')).toBeVisible();
  const table = page.frameLocator('iframe[title="Notebook output"]').locator('table.dataframe');
  await expect(table).toBeVisible();
  await expect(table.getByText('osimertinib')).toBeVisible();

  // A figure is drawn, not its repr; an error keeps its name, its value and its traceback.
  await expect(page.locator('img[alt="Notebook output"]')).toBeVisible();
  await expect(page.getByText('KeyError', { exact: true }).first()).toBeVisible();

  // ── Editing a cell writes the source back, and leaves the outputs alone ──────────────────
  const firstCell = page.locator('.cm-content').first();
  await firstCell.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('print("edited")');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const edited = await lastWrite(page);
  const cells = (edited as any)?.cells ?? [];
  expect(cells[1]?.source).toEqual(['print("edited")']);
  expect(cells[1]?.execution_count).toBe(1);
  expect((cells[1]?.outputs ?? []).length).toBeGreaterThan(0);

  // ── The kernel picker writes the version into the file ───────────────────────────────────
  await page.getByRole('button', { name: /Python 3\.12/ }).click();
  await page.getByRole('button', { name: 'Python 3.13' }).click();
  // The picker closes on the choice; the trigger is then the only button carrying the label.
  await expect(page.getByRole('dialog', { name: 'Python' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Python 3\.13/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const kernel = await lastWrite(page);
  expect((kernel as any)?.metadata?.kernelspec?.name).toBe('python3.13');
  expect((kernel as any)?.metadata?.language_info?.version).toBe('3.13');

  // ── The run environment is the notebook's own, kept in the file ──────────────────────────
  await page.getByRole('button', { name: 'Run environment' }).click();
  await page.getByRole('textbox', { name: 'Packages installed for this run' }).fill('torch, pandas>=2');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const environment = await lastWrite(page);
  expect((environment as any)?.metadata?.openlab?.packages).toEqual(['torch', 'pandas>=2']);

  // ── Run sends the file to a target and writes the outputs back into it ───────────────────
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: /This machine/ }).click();
  await expect(page.getByText(/submitted to This machine/)).toBeVisible();

  // The job runs the workspace driver, with the notebook's kernel, and never a sibling file.
  const runs = await page.evaluate(() => (window as any).__runs ?? []);
  expect(runs[0]).toContain('.openlab/notebook-run.py');
  expect(runs[0]).toContain('OPENLAB_KERNEL');
  expect(runs[0]).not.toContain('--output ');
  // The declared packages are installed for the run, which is what makes uv the runner.
  expect(runs[0]).toContain('--with torch');
  expect(runs[0]).toContain('--with pandas>=2');
  expect(runs[0]).toContain(NOTEBOOK);

  // The reader was reloaded from the file, so the run's output is on the page.
  await expect(page.getByText('ran on the target')).toBeVisible();
  await expect(page.getByText('In [7]')).toBeVisible();

  const problems = (page as unknown as { problems: string[] }).problems;
  expect(problems, problems.join('\n')).toEqual([]);
});
