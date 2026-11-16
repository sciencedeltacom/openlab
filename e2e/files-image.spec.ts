/**
 * An image file's page: the figure, and the way from it into a session.
 *
 * Two things a reader does with a figure: look at it, and ask about it. The page draws the
 * image at nine tenths of the column with its own ratio, and the button under it starts a new
 * session with the file attached — so the first thing the reader can say is about the thing
 * they are looking at.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, type Page } from '@playwright/test';

import { installTauriShim } from './tauri-shim';

const NOTEBOOK = 'analysis.ipynb';
const SOURCE = readFileSync(join(import.meta.dirname, 'fixtures', NOTEBOOK), 'utf8');
/** A 320×200 png, so the page has real bytes to draw rather than a broken image. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAUAAAADICAIAAAAWZq/8AAADs0lEQVR42u3TUQkAIBBEQZPYzJR2E/TLEgtyMmCBce+1PuaTd/Z68nh5f/I2A/PyCtjAvLwCNjAvr4ANzCtgA/PyCtjAvLwCNjAvr4AdNK+ADczLK2AD8/IK2MC8AjYwL6+ADczLK2AD8/IK2MC8AjYwL6+ADczLK2AD8/IKmJdXwAbm5RWwgXl5BWxgXgEbmJdXwAbm5RWwgXl5BeygeQVsYF5eARuYl1fABublFTAvr4ANzMsrYAPz8grYwLwCNjAvr4ANzMsrYAPz8grYQfMK2MC8vAI2MC9vJGAfzctb1ytgXl4BG5iXV8AG5uUVsIF5BWxgXl4BG5iXV8AG5uUVsIPmFbCBeXkFbGBeXgEbmFfABublFbCBeXkFbGBeXgEbmFfABublFbCBeXkFbGBeXgHz8grYwLy8AjYwL6+ADcwrYAPz8grYwLy8AjYwL6+AHTSvgA3MyytgA/PyCtjAvLwC5uUVsIF5eQVsYF5eARuYV8AG5uUVsIF5eQVsYF5eATtoXgEbmJdXwAbm5c0E7KN5eet6BczLK2AD8/IK2MC8vAI2MK+ADczLK2AD8/IK2MC8vAJ20LwCNjAvr4ANzMsrYAPzCtjAvLwCNjAvr4ANzMsrYAPzCtjAvLwCNjAvr4ANzMsrYF5eARuYl1fABublFbCBeQVsYF5eARuYl1fABublFbCD5hWwgXl5BWxgXl4BG5iXV8C8vAI2MC+vgA3MyytgA/MK2MC8vAI2MC+vgA3MyytgB80rYAPz8grYwLy8mYB9NC9vXa+AeXkFbGBeXgEbmJdXwAbmFbCBeXkFbGBeXgEbmJdXwA6aV8AG5uUVsIF5eQVsYF4BG5iXV8AG5uUVsIF5eQVsYF4BG5iXV8AG5uUVsIF5eQXMyytgA/PyCtjAvLwCNjCvgA3MyytgA/PyCtjAvLwCdtC8AjYwL6+ADczLK2AD8/IKmJdXwAbm5RWwgXl5BWxgXgEbmJdXwAbm5RWwgXl5BeygeQVsYF5eARuYlzcTsI/m5a3rFTAvr4ANzMsrYAPz8grYwLwCNjAvr4ANzMsrYAPz8grYQfMK2MC8vAI2MC+vgA3MK2AD8/IK2MC8vAI2MC+vgA3MK2AD8/IK2MC8vAI2MC+vgHl5BWxgXl4BG5iXV8AG5hWwgXl5BWxgXl4BG5iXV8AOmlfABublFbCBeXkFbGBeXgHz8grYwLy8AjYwL6+ADcwrYAPz8grYwLy8AjYwL6+AHTSvgA3MyytgA/PyRt4FO5FY8sQ1B7kAAAAASUVORK5CYII=';

async function openImage(page: Page): Promise<void> {
  await page.addInitScript(installTauriShim);
  await page.addInitScript(
    ([name, text, png]) => {
      const internals = (window as unknown as Record<string, any>).__TAURI_INTERNALS__;
      const inner = internals.invoke;
      internals.invoke = (cmd: string, args: any) => {
        if (cmd === 'list_dir') {
          return Promise.resolve([
            { name, path: name, isDir: false, isSymlink: false, size: text.length, modifiedMs: Date.now() },
            {
              name: 'figure.png',
              path: 'figure.png',
              isDir: false,
              isSymlink: false,
              size: 4096,
              modifiedMs: Date.now(),
            },
          ]);
        }
        if (cmd === 'read_file') return Promise.resolve(text);
        if (cmd === 'read_file_binary') {
          const bytes = Uint8Array.from(atob(String(png)), (character) => character.charCodeAt(0));
          return Promise.resolve(bytes.buffer);
        }
        if (cmd === 'write_file') return Promise.resolve(null);
        if (cmd === 'secrets_status') return Promise.resolve([]);
        return inner(cmd, args);
      };
    },
    [NOTEBOOK, SOURCE, PNG],
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Create workspace…' }).click();
  await page.getByRole('button', { name: /Choose a folder/ }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('tab', { name: 'Files' }).click();
  await page
    .getByRole('button', { name: /figure\.png/ })
    .first()
    .click();
}

test('an image page draws the figure and offers a session with it', async ({ page }) => {
  await openImage(page);

  const image = page.locator('img[alt="figure.png"]');
  await expect(image).toBeVisible();
  // Nine tenths of the column, and the file's own ratio rather than its own height.
  const box = await image.boundingBox();
  const column = await page.locator('main').boundingBox();
  expect(box && column ? Math.round((box.width / column.width) * 100) : 0).toBeGreaterThan(80);
  expect(box ? Math.abs(box.width / box.height - 1.6) : 0).toBeLessThan(0.05);

  // The button under it starts a session with the file already attached.
  await page.getByRole('button', { name: 'New session with image' }).click();
  await expect(page.getByRole('button', { name: 'Remove figure.png' })).toBeVisible();
});
