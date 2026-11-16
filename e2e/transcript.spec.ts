/**
 * A session opens at its end.
 *
 * A transcript is read from the newest message backwards, so opening a session should land on
 * the last thing said rather than on its first message. The follow effect only keeps a reader
 * who is already at the bottom — which, on open, nobody is — so this is its own behaviour and
 * its own test.
 *
 * The transcript is long enough to scroll because the scripted engine answers every message.
 */

import { test, expect, type Page } from '@playwright/test';

import { installTauriShim } from './tauri-shim';

/** The transcript's scroll position, and where its end is. */
async function transcript(page: Page): Promise<{ top: number; max: number } | null> {
  return page.evaluate(() => {
    // The transcript is the tallest of the page's scroll shadows.
    const element = [...document.querySelectorAll<HTMLElement>('.scroll-shadow')].sort(
      (left, right) => right.scrollHeight - left.scrollHeight,
    )[0];
    if (!element) return null;
    return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight };
  });
}

/** Put the transcript back at its start, the way a reader who scrolled up leaves it. */
async function rewind(page: Page): Promise<void> {
  await page.evaluate(() => {
    const element = [...document.querySelectorAll<HTMLElement>('.scroll-shadow')].sort(
      (left, right) => right.scrollHeight - left.scrollHeight,
    )[0];
    if (element) element.scrollTop = 0;
  });
}

async function openSession(page: Page): Promise<void> {
  await page.addInitScript(installTauriShim);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create workspace…' }).click();
  await page.getByRole('button', { name: /Choose a folder/ }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('tablist', { name: 'Open pages' }).getByRole('tab', { name: 'AI' }).click();
  await page.getByRole('button', { name: 'New session' }).first().click();
}

test('a session opens on its last message', async ({ page }) => {
  await openSession(page);

  const composer = page.getByPlaceholder(/Ask about your data/);
  for (let index = 1; index <= 4; index += 1) {
    await composer.fill(`Question ${index} from the transcript test`);
    await composer.press('Enter');
    await expect(page.getByText(`Question ${index} from the transcript test`).first()).toBeVisible();
    // A turn cannot be sent while the previous one runs; each answer ends with its own clock.
    await expect(page.getByText(/Answered in/)).toHaveCount(index);
  }
  // The scripted answers are what make the transcript taller than the column.
  await expect(page.getByText(/Scripted preview\./).last()).toBeVisible();

  // A smooth scroll may still be in flight when the last answer lands.
  await page.waitForTimeout(600);
  const atEnd = await transcript(page);
  expect(atEnd).not.toBeNull();
  expect(atEnd!.max).toBeGreaterThan(200);
  expect(atEnd!.top).toBeGreaterThanOrEqual(atEnd!.max - 12);

  // Entering the session again lands at the end, whatever the scroll was when it was left.
  await rewind(page);
  const tabs = page.getByRole('tablist', { name: 'Open pages' }).getByRole('tab');
  await tabs.filter({ hasText: 'Home' }).click();
  await tabs.filter({ hasText: 'Untitled session' }).first().click();
  await expect(page.getByText('Question 4 from the transcript test').first()).toBeVisible();

  await page.waitForTimeout(400);
  const reopened = await transcript(page);
  expect(reopened).not.toBeNull();
  expect(reopened!.top).toBeGreaterThanOrEqual(reopened!.max - 12);
});
