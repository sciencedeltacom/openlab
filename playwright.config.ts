/**
 * End-to-end browser smoke tests.
 *
 * The app is a Tauri webview around a Vite/React bundle, so the browser tests run against the
 * built bundle — `dist/` — served by `vite preview`. That means the build must happen first:
 * `bun run build && bun run verify:e2e` locally, and CI runs `bun run build` before the e2e
 * step. The webServer below only serves what is already there.
 */

import { defineConfig, devices } from '@playwright/test';

/** Port the preview server is pinned to; `strictPort` means it fails rather than moving. */
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Serves the built bundle. `bun run build` is a separate, explicit step (CI runs it just
    // before this one) so a failed build is not hidden behind the server starting.
    command: `bun run preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
