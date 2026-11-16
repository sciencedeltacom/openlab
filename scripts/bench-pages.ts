/**
 * The page benchmark.
 *
 * `benchmark.ts` measures the backends (Rust index, Python store). This measures what a person
 * feels: how long the bundle takes to boot, how long the create-workspace flow takes, and how
 * long each page takes to appear — first open (its chunk has never loaded) and a warm revisit.
 *
 *     bun run build && bun scripts/bench-pages.ts
 *
 * Runs against `dist/` served by `vite preview`, in headless Chromium, with the Tauri IPC shim
 * the e2e tests use. Timing happens inside the page (`performance.now()` around the click, a
 * rAF loop over the `main` subtree) so no driver round-trip is in the number.
 */

import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { installTauriShim } from '../e2e/tauri-shim';

const APP = resolve(import.meta.dir, '..');
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

/** Every page in the picker, in picker order. */
const PAGES = [
  'Home',
  'AI',
  'Inbox',
  'My work',
  'Tasks',
  'Intake',
  'Waves',
  'Analytics',
  'Knowledge',
  'Reviews',
  'Sources',
  'Databases',
  'Files',
  'Statistics',
  'Experiments',
  'Figures',
  'Jobs',
  'Targets',
  'Autoresearch',
  'Domain packs',
  'Tools',
  'Connectors',
  'Credentials',
  'Custom tools',
  'Skills',
  'Recipes',
  'Connections',
  'Settings',
];

/** The in-page half: click a page entry (or its tab) and time the render. */
const OPEN_PAGE = ([label, via]: [string, 'picker' | 'tab']) => {
  const frames = () => new Promise<number>((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const main = document.querySelector('main');
  if (!main) return { error: 'no main' };

  let clicked: HTMLElement | undefined;
  if (via === 'picker') {
    // Scope to the popover: the sidebar has tab buttons with the same labels, and clicking one
    // of those would leave the popover open and time nothing.
    const input = document.querySelector('input[placeholder="Open a page…"]');
    let scope: Element | null = input;
    while (scope && scope.querySelectorAll('button').length < 2 && scope !== document.body) {
      scope = scope.parentElement;
    }
    clicked = [...(scope ?? document).querySelectorAll('button')].find(
      (node) => (node.textContent ?? '').trim() === label,
    ) as HTMLElement | undefined;
  } else {
    clicked = [...document.querySelectorAll('[role="tab"]')].find((node) =>
      (node.textContent ?? '').trim().startsWith(label),
    ) as HTMLElement | undefined;
  }
  if (!clicked) return { error: `no ${via} entry for ${label}` };

  const before = main.innerHTML.length;
  const resourcesBefore = performance.getEntriesByType('resource').length;
  let last = performance.now();
  const observer = new MutationObserver(() => {
    last = performance.now();
  });
  observer.observe(main, { childList: true, subtree: true, characterData: true, attributes: true });

  const start = performance.now();
  clicked.click();

  return new Promise<Record<string, unknown>>((done) => {
    let painted: number | null = null;
    const tick = () => {
      const now = performance.now();
      if (painted === null && main.innerHTML.length !== before) painted = now - start;
      if (painted !== null) {
        void frames().then(() => {
          observer.disconnect();
          const chunks = performance
            .getEntriesByType('resource')
            .slice(resourcesBefore)
            .map((entry) => entry.name.split('/').pop())
            .filter((name): name is string => Boolean(name) && name!.endsWith('.js'));
          done({ painted, settled: last - start, chunks });
        });
        return;
      }
      if (now - start > 10_000) {
        observer.disconnect();
        done({ painted: null, settled: null, chunks: [], error: 'nothing rendered in 10s' });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
};

/** Open the page picker: a "New tab" row in the column layout, an unlabeled icon in the strip. */
async function openPicker(page: Page): Promise<boolean> {
  const input = page.locator('input[placeholder="Open a page…"]');
  if (await input.isVisible().catch(() => false)) return true;
  const row = page.getByRole('button', { name: 'New tab', exact: true });
  const icon = page.locator('button.button--icon-only:not([aria-label])').first();
  const trigger = (await row.count()) > 0 ? row.first() : icon;
  if ((await trigger.count()) === 0) return false;
  await trigger.click();
  await input.waitFor({ timeout: 5000 });
  return true;
}

/** One navigation, cold (from the picker) or warm (an existing tab). */
async function measure(page: Page, label: string, via: 'picker' | 'tab') {
  if (via === 'picker' && !(await openPicker(page))) return { error: 'no picker' };
  const result = await page.evaluate(OPEN_PAGE, [label, via] as [string, 'picker' | 'tab']);
  // A popover that stayed open would intercept the next click; Escape closes either one.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
  return result as Record<string, unknown>;
}

/** Boot the preview server and wait until it answers. */
async function serve(): Promise<() => void> {
  const server = spawn('bun', ['run', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: APP,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return () => server.kill();
}

const stop = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));

await page.addInitScript(installTauriShim);
await page.addInitScript(() => {
  const tasks: { start: number; duration: number }[] = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: 'longtask', buffered: true });
  (window as unknown as Record<string, unknown>).__longTasks = tasks;
});
await page.addInitScript(() => {
  new PerformanceObserver((list) => {
    const lcp = list.getEntries().at(-1) as PerformanceEntry | undefined;
    if (lcp) (window as unknown as Record<string, unknown>).__lcp = lcp.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
});

// --- Cold boot: bundle parse, first paint, welcome screen.
const bootStart = Date.now();
await page.goto(BASE, { waitUntil: 'load' });
await page.getByRole('heading', { name: 'Start' }).waitFor({ state: 'visible', timeout: 60_000 });
const bootMs = Date.now() - bootStart;
const load = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  const paints = Object.fromEntries(
    performance.getEntriesByType('paint').map((entry) => [entry.name, Math.round(entry.startTime)]),
  );
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const scripts = resources.filter((entry) => entry.initiatorType === 'script');
  const kb = (list: PerformanceResourceTiming[]) =>
    Math.round(list.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0) / 1024);
  const tasks = (window as unknown as { __longTasks: { duration: number }[] }).__longTasks ?? [];
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    loadEvent: Math.round(nav.loadEventEnd),
    firstPaint: paints['first-paint'] ?? null,
    firstContentfulPaint: paints['first-contentful-paint'] ?? null,
    lcp: Math.round((window as unknown as { __lcp?: number }).__lcp ?? 0),
    scripts: scripts.length,
    scriptKb: kb(scripts),
    resourceKb: kb(resources),
    longTasks: tasks.length,
    longTaskMs: Math.round(tasks.reduce((sum, entry) => sum + entry.duration, 0)),
  };
});

// --- The create-workspace flow, through the real stepper.
const createStart = Date.now();
await page.getByRole('button', { name: 'Create workspace…' }).click();
await page.getByRole('button', { name: /Choose a folder/ }).click();
await page.getByText('/Users/you/research/egfr-inhibitors').first().waitFor();
for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'Next' }).click();
await page.getByRole('button', { name: 'Create workspace' }).click();
await page.getByRole('tablist', { name: 'Open pages' }).waitFor({ timeout: 30_000 });
const createMs = Date.now() - createStart;

// --- Per page: first open, then a revisit through its tab. The six pinned pages are already
// open as tabs, so they have no picker entry: their "first open" is the first tab switch to them.
const rows: Record<string, unknown>[] = [];
for (const label of PAGES) {
  const taskMark = await page.evaluate(() => (window as unknown as { __longTasks: unknown[] }).__longTasks.length);
  if (label !== 'AI') await measure(page, 'AI', 'tab');
  const first = await measure(page, label, 'picker');
  const cold = first.error ? await measure(page, label, 'tab') : first;
  if (label !== 'AI') await measure(page, 'AI', 'tab');
  const warm = await measure(page, label, 'tab');
  const longTasks = await page.evaluate(
    (since: number) =>
      (window as unknown as { __longTasks: { duration: number }[] }).__longTasks
        .slice(since)
        .map((entry) => Math.round(entry.duration)),
    taskMark,
  );
  rows.push({ page: label, cold, warm, longTasks });
  console.log(
    label.padEnd(16),
    String(cold.painted ?? '—').padStart(7),
    String(warm.painted ?? '—').padStart(7),
    String(cold.settled ?? '—').padStart(7),
    String((cold.chunks as string[])?.join(',') ?? '').slice(0, 50),
  );
}

await browser.close();
stop();

const record = {
  at: new Date().toISOString(),
  bootMs,
  createWorkspaceMs: createMs,
  load,
  pages: rows,
  errors,
};
writeFileSync(join(APP, 'benchmark', 'pages.json'), `${JSON.stringify(record, null, 2)}\n`);

const numbers = (key: string) =>
  rows
    .map((row) => (row.cold as Record<string, number>)[key])
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
const summary = (key: string) => {
  const values = numbers(key);
  return {
    count: values.length,
    min: Math.round(values[0] ?? 0),
    median: Math.round(values[Math.floor(values.length / 2)] ?? 0),
    p90: Math.round(values[Math.floor(values.length * 0.9)] ?? 0),
    max: Math.round(values.at(-1) ?? 0),
  };
};
console.log('\nfirst open', JSON.stringify(summary('painted')));
console.log(`boot ${bootMs}ms · create workspace ${createMs}ms · ${errors.length} page errors`);
