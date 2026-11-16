/**
 * Checks the composition root.
 *
 * Run with: `bun scripts/verify-container.ts`
 *
 * The dependency-injection work moved the app's shared mutable state out of module-level `let`s
 * and into services the container owns. These checks pin the parts that make that safe: the
 * container hands out one instance (a singleton), a store notifies on a change and stays quiet
 * on a no-op, the source list behaves as it did, and a background run still starts, is
 * dismissible and settles. Nothing here needs a database or a network.
 */

import { root, services } from '../src/lib/container';
import { ExternalStore } from '../src/lib/services/external';
import { whenReviewSettled, reviewRun, dismissReviewRun, startReview } from '../src/lib/literature/runner';
import { addSource, findSource, removeSource, sourceIds } from '../src/lib/catalog/sources';
import { seedState } from '../src/store/seed';
import type { Source } from '../src/lib/catalog/sources';
import type { ReviewRun } from '../src/lib/literature/pipeline';

let failures = 0;

/** Assert equality and report the difference rather than throwing. */
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
}

function checkTruthy(label: string, value: unknown) {
  if (value) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected a truthy value\n     actual   ${JSON.stringify(value)}`);
}

console.log('\n— the container —');
{
  checkTruthy('the root builds a graph', root.get('sources'));
  check('a singleton is the same instance every time', services.sources === services.sources, true);
  check(
    'the four services are distinct',
    new Set([services.sources, services.cloud, services.accounts, services.reviewRuns]).size,
    4,
  );
}

console.log('\n— the external store —');
{
  const store = new ExternalStore<number>(0);
  let notifications = 0;
  const off = store.subscribe(() => {
    notifications += 1;
  });
  store.set(1);
  store.set(1); // a no-op change is not a notification
  store.update((value) => value + 1);
  check('it notifies on a real change', notifications, 2);
  check('and holds the latest value', store.get(), 2);
  off();
  store.set(9);
  check('and stops notifying after unsubscribe', notifications, 2);
}

console.log('\n— the sources service —');
{
  const source: Source = {
    id: 'src-container-test',
    name: 'A container test source',
    databaseId: 'openalex',
    filters: { query: 'chromatin', types: ['article'], limit: 25 },
    preview: [],
    createdAt: Date.now(),
  };
  addSource(source);
  check('a source is added', sourceIds()[0], source.id);
  check('and found by id', findSource(source.id)?.name, source.name);
  services.sources.patch(source.id, { name: 'Renamed' });
  check('and patched in place', findSource(source.id)?.name, 'Renamed');
  removeSource(source.id);
  check('and removed', findSource(source.id), undefined);
}

console.log('\n— the review runs service —');
{
  const inputs = {
    question: 'Does chromatin accessibility improve off-target prediction?',
    inclusion: '',
    exclusion: '',
    dateRange: '',
    sources: [],
    maxRecords: 20,
    depth: 'quick' as const,
    analysis: ['synthesis'],
    format: 'report',
  };
  // A runner that answers at once, so the run settles without a model.
  const runner = async () => ({}) as unknown as ReviewRun;
  const { id, done } = startReview(seedState(), inputs, runner);
  check('a run is on the board while it works', reviewRun(id)?.status, 'running');
  await done;
  await whenReviewSettled(id);
  checkTruthy('and settles rather than hanging', reviewRun(id)?.status !== 'running');
  dismissReviewRun(id);
  check('and can be dismissed', reviewRun(id), undefined);
}

console.log(
  failures === 0 ? '\nOK: the container owns its services and they behave' : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
