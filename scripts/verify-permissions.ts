/**
 * Checks the permission queue.
 *
 * Run with: `bun scripts/verify-permissions.ts`
 *
 * The bug this replaces was a single resolver: a second call overwrote the first promise, so
 * the first turn never settled and its prompt was replaced. These checks pin the ordering,
 * the independent settlement and the abort path that make parallel calls safe.
 */

import { PermissionQueue } from '../src/lib/permission-queue';

let failures = 0;

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

console.log('\n— one at a time —');
{
  const shown: (string | null)[] = [];
  const queue = new PermissionQueue<string>((current) => shown.push(current));

  const first = queue.enqueue('first');
  check('the first request is shown', queue.current(), 'first');
  check('and the depth is one', queue.depth, 1);

  queue.answer(true);
  check('answering settles the first promise', await first, true);
  check('the surface is cleared', queue.current(), null);
  check('the surface saw show then clear', shown, ['first', null]);
}

console.log('\n— two in flight —');
{
  const shown: (string | null)[] = [];
  const queue = new PermissionQueue<string>((current) => shown.push(current));

  const first = queue.enqueue('first');
  const second = queue.enqueue('second');

  check('the first is shown, the second waits', queue.current(), 'first');
  check('both are queued', queue.depth, 2);
  check('a second request did not replace the surface', shown, ['first']);

  queue.answer(false);
  check('the first settles as refused', await first, false);
  check('the second is promoted', queue.current(), 'second');
  queue.answer(true);
  check('the second settles as allowed', await second, true);
  check('the surface is empty at the end', queue.current(), null);
  check('every promotion was announced', shown, ['first', 'second', null]);
}

console.log('\n— abort —');
{
  const queue = new PermissionQueue<string>(() => undefined);
  const controller = new AbortController();
  const aborted = queue.enqueue('aborted', controller.signal);
  const kept = queue.enqueue('kept');

  controller.abort();
  check('an aborted turn resolves as a refusal', await aborted, false);
  check('and the other request stays', queue.current(), 'kept');
  check('with the depth intact', queue.depth, 1);
  queue.answer(true);
  check('which can still be answered', await kept, true);
}

console.log('\n— no double settlement —');
{
  let resolutions = 0;
  const queue = new PermissionQueue<string>(() => undefined);
  const one = queue.enqueue('one');
  const two = queue.enqueue('two');
  void one.then(() => {
    resolutions += 1;
  });

  queue.answer(true);
  // A stale click on the request that just closed must not deny the one now showing.
  queue.answer(false, 'one');
  check('a stale answer does not settle the next request', queue.depth, 1);
  check('the first resolved once', await one, true);
  queue.answer(true, 'two');
  check('the second resolves normally', await two, true);
  await Promise.resolve();
  check('no promise settled twice', resolutions, 1);
}

console.log(failures === 0 ? '\nOK: prompts are queued, settled once, and abort cleanly' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
