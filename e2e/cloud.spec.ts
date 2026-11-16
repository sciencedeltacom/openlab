/**
 * The Cloud scope, against a fake store.
 *
 * Two behaviours here are easy to break and hard to notice: a folder that does not open (the
 * row looks like a file and does nothing) and a search that quietly lists the folder instead.
 * Both are driven through the real panel and the real provider code; only the network is a
 * fake, answering `api_request` with a small Drive tree.
 *
 * The save assertion is the third: a file saved from a store lands in the workspace under
 * `cloud/<store>/<folder>/`, which is the path the notice names.
 */

import { test, expect, type Page } from '@playwright/test';

import { installTauriShim } from './tauri-shim';

const folder = 'application/vnd.google-apps.folder';

const ROOT = {
  files: [
    { id: 'f1', name: 'Data', mimeType: folder },
    {
      id: 'f2',
      name: 'notes.docx',
      mimeType: 'application/msword',
      size: '20480',
      modifiedTime: '2026-10-20T10:00:00Z',
    },
    {
      id: 'f3',
      name: 'Protocol',
      mimeType: 'application/vnd.google-apps.document',
      modifiedTime: '2026-10-19T10:00:00Z',
    },
  ],
};

const DATA = {
  files: [
    {
      id: 'f5',
      name: 'egfr.csv',
      mimeType: 'text/csv',
      size: '4096',
      modifiedTime: '2026-10-17T10:00:00Z',
    },
  ],
};

/** Install the fake Drive: a signed-in Google account and two listings. */
async function openCloud(page: Page): Promise<void> {
  await page.addInitScript(installTauriShim);
  await page.addInitScript(
    ([root, data]) => {
      const internals = (window as unknown as Record<string, any>).__TAURI_INTERNALS__;
      const inner = internals.invoke;
      internals.invoke = (cmd: string, args: any) => {
        if (cmd === 'oauth_status') {
          return Promise.resolve({
            connected: true,
            clientId: 'demo',
            profile: { email: 'you@lab.org' },
          });
        }
        if (cmd === 'api_request') {
          const url = decodeURIComponent(String(args?.url ?? ''));
          // The search asks Drive for both a name and a content match.
          if (url.includes('name contains')) return Promise.resolve(JSON.stringify(data));
          if (url.includes("'f1' in parents")) return Promise.resolve(JSON.stringify(data));
          if (url.includes('drive/v3/files')) return Promise.resolve(JSON.stringify(root));
          return Promise.reject(new Error(`the fake store has no answer for ${url}`));
        }
        if (cmd === 'download_url') return Promise.resolve(4096);
        if (cmd === 'secret_set' || cmd === 'secret_delete') return Promise.resolve(null);
        if (cmd === 'secrets_status') return Promise.resolve([{ provider: 'cloud-demo', hasKey: false }]);
        return inner(cmd, args);
      };
    },
    [ROOT, DATA],
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Create workspace…' }).click();
  await page.getByRole('button', { name: /Choose a folder/ }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('tab', { name: 'Cloud' }).click();

  await page.getByRole('button', { name: 'Connect a store' }).click();
  await page.getByRole('button', { name: 'Google Drive' }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Data' })).toBeVisible();
}

test('a cloud store browses into a folder, searches it, and saves into the workspace', async ({ page }) => {
  await openCloud(page);

  // The root listing, with a Google Doc named for the PDF an export produces.
  await expect(page.getByText('notes.docx')).toBeVisible();
  await expect(page.getByText('Protocol.pdf')).toBeVisible();

  // A folder is entered from its own row.
  await page.getByRole('button', { name: 'Open Data' }).click();
  await expect(page.getByText('egfr.csv')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stores' })).toBeVisible();

  // Search asks the store, not the folder.
  await page.getByRole('searchbox', { name: 'Search Google Drive' }).fill('egfr');
  await expect(page.getByText(/results? in Google Drive for/)).toBeVisible();

  // Saving names the workspace path it wrote.
  await page
    .getByRole('button', { name: /Save egfr\.csv to the workspace/ })
    .first()
    .click();
  await expect(page.getByText('Saved egfr.csv (4.0 KB) to cloud/Google Drive/Data/egfr.csv')).toBeVisible();
});
