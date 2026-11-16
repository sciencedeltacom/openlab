/**
 * A real end-to-end smoke test of the workbench, in a real browser.
 *
 * It runs against the built bundle served by `vite preview`, with no network and no Tauri
 * runtime. Two tests, in increasing order of what they need:
 *
 *  1. `boots in a plain browser` — no stubs at all. Proves the bundle loads, the app mounts and
 *     the Welcome screen draws. This is the whole truth of a browser with no Tauri behind it.
 *  2. `the workbench shell answers` — installs a minimal Tauri IPC shim (see `tauri-shim.ts`)
 *     so a workspace can be created through the real stepper, then drives the tab strip, the
 *     composer and the scripted engine. The shim is at the OS boundary only; the UI under test
 *     is the shipped application.
 */

import { test, expect } from '@playwright/test';

import { installTauriShim } from './tauri-shim';

test('boots in a plain browser and shows the welcome', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/openlab/i);

  // With no workspace and no database (both are Tauri-only), the app opens on the Welcome
  // screen rather than the workbench shell. This is the genuine browser-mode surface.
  await expect(page.getByText('Research, evolved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create workspace…' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Walkthroughs' })).toBeVisible();
});

test('the workbench shell, composer and scripted engine work', async ({ page }) => {
  // The shim is what lets a workspace exist in a browser; without it the create flow throws on
  // its first `write_file` and the shell is never reached (see `tauri-shim.ts`).
  await page.addInitScript(installTauriShim);
  await page.goto('/');
  await expect(page).toHaveTitle(/openlab/i);

  // --- Create a workspace through the real five-step stepper. The folder picker answers with
  // the app's own browser-preview path, so no native dialog is involved.
  await page.getByRole('button', { name: 'Create workspace…' }).click();
  await page.getByRole('button', { name: /Choose a folder/ }).click();
  await expect(page.getByText('/Users/you/research/egfr-inhibitors').first()).toBeVisible();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // --- The shell. The sidebar is the one tab system, and "Open pages" is its tablist.
  const tablist = page.getByRole('tablist', { name: 'Open pages' });
  await expect(tablist).toBeVisible();
  await tablist.getByRole('tab', { name: 'AI' }).click();

  // A session's page is the transcript; making one lands on it.
  await page.getByRole('button', { name: 'New session' }).first().click();

  // The composer's accessible name is its placeholder — the textarea carries no `aria-label`.
  const composer = page.getByPlaceholder(/Ask about your data/);
  await expect(composer).toBeVisible();
  // The agent bar sits beside the transcript.
  await expect(page.getByText('Agents', { exact: true }).first()).toBeVisible();

  // --- Ask a question. With no provider connected the app falls back to the scripted preview
  // engine (`createEchoEngine`), which answers with "**Scripted preview.** …".
  await composer.fill('Hello from Playwright');
  await composer.press('Enter');

  await expect(page.getByText('Hello from Playwright').first()).toBeVisible();
  await expect(page.getByText(/Scripted preview\./).first()).toBeVisible();
});
