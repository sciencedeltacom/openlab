/**
 * The statistics workbench, driven the way a reader drives it.
 *
 * Two properties the rewrite exists for are asserted here and cannot be asserted in a unit
 * test: a CSV dropped on the panel becomes columns the picker can name, and a manifest saved
 * from the dialog builds the parameter form. Both run against the shipped bundle with the
 * Tauri IPC shim, so the reducer, the router and the real components are what is under test.
 *
 * Running a custom procedure is deliberately not asserted: that needs a desktop runtime and
 * a Python, and the browser shim has neither. `scripts/verify-statistics.ts` covers the
 * protocol and the readback instead.
 */

import { test, expect } from '@playwright/test';

import { installTauriShim } from './tauri-shim';

async function createWorkspace(page: import('@playwright/test').Page) {
  await page.addInitScript(installTauriShim);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create workspace…' }).click();
  await page.getByRole('button', { name: /Choose a folder/ }).click();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('tablist', { name: 'Open pages' })).toBeVisible();
}

async function openStatistics(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'New tab' }).click();
  await page.getByLabel('Open a page').fill('Statistics');
  await page.getByText('Statistics', { exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
}

test('statistics: csv import, roles and a run', async ({ page }) => {
  await createWorkspace(page);
  await openStatistics(page);

  const data = page.getByRole('textbox', { name: 'Data' });
  await expect(data).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
  await expect(page.getByText('2 group(s) · 8 / 8 values')).toBeVisible();

  // A posted CSV: header, a group column, a value column.
  await page.locator('input[type=file]').setInputFiles({
    name: 'groups.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'group,value\ncontrol,9.8\ntreated,11.2\ncontrol,10.1\ntreated,10.9\ncontrol,9.5\ntreated,11.6\n',
    ),
  });
  await expect(page.getByText(/csv · ,/)).toBeVisible();
  await expect(page.getByText('2 group(s) · 3 / 3 values')).toBeVisible();

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('welch t test')).toBeVisible();
  await expect(page.getByText('t =', { exact: false }).first()).toBeVisible();

  // A different procedure reads one value column.
  await page
    .getByRole('button', { name: /Descriptives/ })
    .first()
    .click();
  await expect(page.getByText('12 value(s)', { exact: false })).toBeVisible();

  // JSON keeps its own names, in the procedure it is pasted into.
  await page.getByRole('button', { name: /Welch/ }).first().click();
  await page.getByRole('textbox', { name: 'Data' }).fill('[{"group":"a","value":1},{"group":"b","value":2}]');
  await expect(page.getByText('json', { exact: true })).toBeVisible();
});

test('statistics: the form builds a procedure', async ({ page }) => {
  await createWorkspace(page);
  await openStatistics(page);

  await page.getByRole('button', { name: 'New procedure' }).click();
  // The editor is a page of its own, not a dialog over the workbench.
  await expect(page.getByRole('heading', { name: 'New procedure' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Statistics', exact: true })).toBeVisible();

  // A procedure without its script is refused.
  await page.getByRole('button', { name: 'Save procedure' }).click();
  await expect(page.getByText('Select the Python file')).toBeVisible();

  // The example fills the form and shows the script it would copy in.
  await page.getByRole('button', { name: 'Example' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
    'Bootstrap CI of a mean difference',
  );
  await expect(page.getByRole('textbox', { name: 'Id', exact: true })).toHaveValue('bootstrap-diff');
  await expect(page.getByText('bootstrap.py')).toBeVisible();

  // Saving returns to the workbench, with the parameters the form declared.
  await page.getByRole('button', { name: 'Save procedure' }).click();
  await expect(page.getByRole('heading', { name: 'Bootstrap CI of a mean difference' })).toBeVisible();
  await expect(page.getByText('Resamples', { exact: true })).toBeVisible();
  await expect(page.getByText('Statistic', { exact: true })).toBeVisible();
});
