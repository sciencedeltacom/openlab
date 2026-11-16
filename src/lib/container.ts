/**
 * The composition root.
 *
 * Every shared, stateful service is built here and nowhere else: the saved sources, the cloud
 * connections, the account cache, and the review runs. Screens and helpers ask this container
 * for the one they need, so the state lives in an object the container owns rather than in a
 * module-level `let` that every import shares and nothing can release.
 *
 * [InferDI](https://inferdi.com) is the container. Its lifetimes are what make the ownership
 * explicit: a `singleton` here means "one per app", and a service that later needs a shorter
 * life can be registered `scoped` and disposed at the end of its unit of work without any
 * caller changing. The graph is small on purpose — only the services with state are in it;
 * pure functions stay pure.
 */

import { Container } from '@inferdi/inferdi';

import { AccountsService } from './services/accounts';
import { CloudService } from './services/cloud';
import { ReviewRunsService } from './services/reviews';
import { RunBuffer } from './services/run-buffer';
import { SourcesService } from './services/sources';

const root = new Container()
  .registerClass('sources', SourcesService, [])
  .registerClass('cloud', CloudService, [])
  .registerClass('accounts', AccountsService, [])
  .registerClass('reviewRuns', ReviewRunsService, [])
  // Scoped: one per review run, created when the run opens its scope and disposed with it.
  .registerClass('runBuffer', RunBuffer, [], 'scoped');

/** The services, by name. Each is the one singleton the container built. */
export const services = {
  get sources(): SourcesService {
    return root.get('sources');
  },
  get cloud(): CloudService {
    return root.get('cloud');
  },
  get accounts(): AccountsService {
    return root.get('accounts');
  },
  get reviewRuns(): ReviewRunsService {
    return root.get('reviewRuns');
  },
};

/** The container itself, for a caller that wants to register or override in a test. */
export { root };
