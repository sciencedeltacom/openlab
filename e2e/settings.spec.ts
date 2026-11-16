/**
 * Every settings page, drawn in a real browser.
 *
 * A settings page is a spec rendered by one frame, so a mistake in one page's markup — a table
 * without its required wrapper, a control that reads a missing field — throws while that page
 * draws and the reader gets "could not be drawn" instead of the page. That is exactly what
 * happened to Backups once; this walks the whole settings navigation and fails on the first
 * page that throws, or on any console error it produces.
 *
 * It needs a workspace (the settings pages live inside the shell), so it uses the same
 * operating-system-boundary shim as the smoke test.
 */

import { test, expect, type Page } from '@playwright/test';

import { installTauriShim } from './tauri-shim';

/** Create a workspace through the real stepper, so the shell and its tabs exist. */
async function openWorkbench(page: Page): Promise<void> {
  await page.addInitScript(installTauriShim);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create workspace…' }).click();
  await page.getByRole('button', { name: /Choose a folder/ }).click();
  await expect(page.getByText('/Users/you/research/egfr-inhibitors').first()).toBeVisible();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('tablist', { name: 'Open pages' })).toBeVisible();
}

test('every settings page draws without throwing', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));

  await openWorkbench(page);

  // Settings is opened from the tab picker; its own navigation is the column inside the page.
  await page.getByRole('button', { name: 'New tab' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Settings' });
  await expect(nav).toBeVisible();

  // The labels come from the running app, so a new page is covered without editing this test.
  const labels = (await nav.getByRole('button').allTextContents())
    .map((label) => label.trim())
    .filter(Boolean);
  expect(labels.length).toBeGreaterThan(10);

  for (const label of labels) {
    await nav.getByRole('button', { name: label, exact: true }).click();
    // The boundary's own words, which no page should ever show. Collected rather than thrown so
    // one run reports every broken page instead of only the first.
    const boundary = page.getByRole('alert').filter({ hasText: 'could not be drawn' });
    if ((await boundary.count()) > 0) {
      const text = (await boundary.first().innerText()).replace(/\s+/g, ' ').trim();
      problems.push(`page “${label}” threw: ${text.slice(0, 200)}`);
      continue;
    }
    // One positive check for the page whose markup this test was written for: Backups draws its
    // own copy rather than the boundary.
    if (label === 'Backups') {
      await expect(page.getByText('A copy is the whole store')).toBeVisible();
    }
  }

  expect(problems, problems.join('\n')).toEqual([]);
});
