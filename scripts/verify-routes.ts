/**
 * Checks the route tree and the tab system.
 *
 * Run with: `bun scripts/verify-routes.ts`
 *
 * A page is a pinned tab, an opened tab, or a hidden page reached from the surface that owns
 * it, and a record is a tab of its own. If that distinction breaks, either the picker grows
 * back into a wall of links or a page becomes unreachable, and both are quiet failures. The
 * navigation rule is pinned here too, because it is the thing that decides whether the tabs
 * fill up with copies of the same page — and it is the same rule whichever way they are
 * drawn.
 */

import {
  DETAILS,
  HIDDEN_VIEWS,
  HOME,
  PAGES,
  PATTERNS,
  SETTINGS_PAGES,
  matchRoute,
  pathFor,
  recordPatternFor,
  paths,
} from '../src/app/routes';
import {
  FIXED_PAGES,
  FIXED_TABS,
  PICKER_PAGES,
  hasTab,
  iconOf,
  isFile,
  isFixed,
  restoreTabs,
  titleOf,
} from '../src/app/pages';
import { closeGroup, closeTab, cycleTab, goTo, groupTabs, parentOf, tabOrder } from '../src/app/tabs';

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

console.log('\n— the pages —');
{
  check(
    'every page has an icon',
    PAGES.every((page) => Boolean(page.icon)),
    true,
  );
  check('every path is unique', PATTERNS.length - new Set(PATTERNS).size, 0);
  check(
    'the pages that earned nothing are gone',
    PATTERNS.filter((p) =>
      [
        'analyze/python-r',
        'analyze/reproduce',
        'analyze/images',
        'analyze/writing',
        'library/viewers',
        'library/tables',
        'research/labs',
        'tools/built-in',
        'tools/scientific',
      ].includes(p),
    ),
    [],
  );
  check(
    'and writing is still not one of them',
    PAGES.some((page) => page.path === 'analyze/writing'),
    false,
  );
  check(
    'the picker offers every page, hidden ones included',
    (() => {
      const picker = new Set(PICKER_PAGES.map((page) => page.path));
      return [...PAGES, ...HIDDEN_VIEWS].filter((page) => !picker.has(page.path)).map((page) => page.path);
    })(),
    [],
  );
  check(
    'and lists each one once',
    PICKER_PAGES.length - new Set(PICKER_PAGES.map((page) => page.path)).size,
    0,
  );
}

console.log('\n— the tab strip —');
{
  check('six pages are pinned', FIXED_TABS.length, 6);
  check('and they are the ones a reader is always in', FIXED_TABS, [
    'home',
    'assistant',
    'inbox',
    'research/tasks',
    'my-work',
    'library/files',
  ]);
  check(
    'every pinned page is routable',
    FIXED_TABS.filter((path) => matchRoute(path).pattern !== path),
    [],
  );
  check(
    'every pinned page is a page with an icon',
    FIXED_PAGES.every((page) => Boolean(page.icon)),
    true,
  );
  check('a pinned page is fixed', isFixed('research/tasks'), true);
  check('a record is not', isFixed('research/tasks/crs-142'), false);
  check('a page has a tab', hasTab('library/databases'), true);
  check('creating a workspace does not', hasTab('workspace/new'), false);

  check('a tab is named after its page', titleOf('research/tasks', new Map()), 'Tasks');
  check(
    'and after its record when the caller can resolve one',
    titleOf(paths.task('crs-142'), new Map([[paths.task('crs-142'), 'Screen the cohorts']])),
    'Screen the cohorts',
  );
  check('and falls back to the record kind when it cannot', titleOf(paths.task('gone'), new Map()), 'Task');
  check('a record wears its list icon', iconOf(paths.task('crs-142')), iconOf('research/tasks'));
  check('a file tab is known to be one', isFile(paths.file('a.py')), true);
  check('and a page is not', isFile('research/tasks'), false);
  check('a file is named by its own path', titleOf(paths.file('prepared/1abc.pdb'), new Map()), '1abc.pdb');
  check(
    'and its page encodes the path into one segment',
    paths.file('src/app.tsx'),
    'library/files/src%2Fapp.tsx',
  );
  check(
    'so a file resolves to its own record page',
    matchRoute(paths.file('src/app.tsx')).pattern,
    'library/files/:fileId',
  );
  check('and the path comes back whole', matchRoute(paths.file('src/app.tsx')).params.fileId, 'src/app.tsx');

  check('a restored window keeps its tabs', restoreTabs(['a', 'b'], 'c'), ['c', 'a', 'b']);
  check('a pinned path is not a tab', restoreTabs(['home', 'library/databases'], 'home'), [
    'library/databases',
  ]);
  check('and the route on screen is', restoreTabs(undefined, 'research/tasks'), []);
  check('a lost tab list still gets the route back', restoreTabs([], 'compute/jobs/j-1'), [
    'compute/jobs/j-1',
  ]);
}

console.log('\n— where a navigation lands —');
{
  const at = (route: string, tabs: string[] = []) => ({ route, tabs });

  check('a page opens a tab', goTo(at(HOME), 'literature-reviews'), {
    tabs: ['literature-reviews'],
    route: 'literature-reviews',
  });
  check(
    'and the same page does not open a second one',
    goTo(at('home', ['literature-reviews']), 'literature-reviews'),
    {
      tabs: ['literature-reviews'],
      route: 'literature-reviews',
    },
  );
  check('a record opens a tab of its own', goTo(at('research/tasks', []), paths.task('crs-142')).tabs, [
    paths.task('crs-142'),
  ]);
  check(
    'a pinned page activates its own tab',
    goTo(at('literature-reviews', ['literature-reviews']), 'inbox'),
    {
      tabs: ['literature-reviews'],
      route: 'inbox',
    },
  );
  check('creating a workspace has no tab', goTo(at(HOME), 'workspace/new'), {
    tabs: [],
    route: 'workspace/new',
  });
  check('settings entered from elsewhere gets a tab', goTo(at(HOME), 'settings/appearance').tabs, [
    'settings/appearance',
  ]);
  check(
    'and then moves inside it',
    goTo(at('settings/appearance', ['settings/appearance']), 'settings/usage'),
    {
      tabs: ['settings/usage'],
      route: 'settings/usage',
    },
  );
  check(
    'a record tab is not swallowed by settings',
    goTo(at(paths.task('crs-142'), [paths.task('crs-142')]), 'settings/help').tabs,
    [paths.task('crs-142'), 'settings/help'],
  );
  check(
    'and a record opens a tab whichever chrome is drawn',
    goTo(at('research/tasks', []), paths.task('crs-142')).tabs,
    [paths.task('crs-142')],
  );

  check('the strip is pinned pages first', tabOrder(at(HOME, ['literature-reviews'])).slice(0, 7), [
    ...FIXED_TABS,
    'literature-reviews',
  ]);
  check('closing a tab leaves the rest', closeTab(at('inbox', ['a', 'b']), 'b').tabs, ['a']);
  check('closing the active tab falls to its neighbour', closeTab(at('b', ['a', 'b']), 'b'), {
    tabs: ['a'],
    route: 'a',
  });
  check(
    'and the first tab falls back to the last pinned one',
    closeTab(at('a', ['a']), 'a').route,
    'library/files',
  );
  check('cycling wraps forward', cycleTab(at('library/files'), 1).route, HOME);
  check('and backward', cycleTab(at(HOME), -1).route, 'library/files');
  check(
    'cycling visits an open tab',
    cycleTab(at('inbox', ['literature-reviews']), 1).route,
    'research/tasks',
  );
}

console.log('\n— grouping —');
{
  const at = (route: string, tabs: string[] = []) => ({ route, tabs });
  const a = paths.file('notes/one.md');
  const b = paths.file('notes/two.md');
  const c = paths.task('crs-1');

  check('a tab knows the page it belongs to', parentOf(a), 'library/files');
  check('a page is its own parent', parentOf('literature-reviews'), 'literature-reviews');

  check('one tab is a plain tab', groupTabs([a]), [{ kind: 'tab', path: a }]);
  check('two on one page become a group', groupTabs([a, b]), [
    { kind: 'group', group: { parent: 'library/files', tabs: [a, b] } },
  ]);
  check('and different pages do not', groupTabs([a, c]).length, 2);
  check(
    'a group keeps the order its tabs were opened in',
    groupTabs([a, c, b]).map((entry) => (entry.kind === 'group' ? entry.group.tabs.length : entry.path)),
    [2, c],
  );

  check('closing a group leaves the rest', closeGroup(at(a, [a, b, c]), 'library/files'), {
    tabs: [c],
    route: 'library/files',
  });
  check('and falls to a neighbour when the group was on screen', closeGroup(at(b, [a, b]), 'library/files'), {
    tabs: [],
    route: 'library/files',
  });
}

console.log('\n— resolution —');
{
  check('a page resolves to itself', matchRoute('research/tasks').pattern, 'research/tasks');
  check('a page is not a record', matchRoute('research/tasks').isDetail, false);
  check(
    'a record matches its pattern',
    matchRoute('research/tasks/crs-142').pattern,
    'research/tasks/:taskId',
  );
  check('and carries its parameter', matchRoute('research/tasks/crs-142').params, { taskId: 'crs-142' });
  check('and knows its noun', matchRoute('research/tasks/crs-142').label, 'Task');
  check('a session is a record', matchRoute('assistant/abc123').pattern, 'assistant/:sessionId');
  check('a hidden page resolves', matchRoute('research/views').pattern, 'research/views');
  // A pack guide is the pack's own page now, not a separate path beside it.
  check('a pack resolves to its record', matchRoute('packs/genomics').pattern, 'packs/:packId');
  check('and carries the pack id', matchRoute('packs/genomics').params, { packId: 'genomics' });
  check('a settings page resolves', matchRoute('settings/appearance').pattern, 'settings/appearance');
  check('an unknown path is reported, not hidden', matchRoute('nope/at/all').found, false);
  check('and carries no pattern', matchRoute('nope/at/all').pattern, '');
  check(
    'every pattern resolves',
    PATTERNS.filter((p) => {
      const params = Object.fromEntries(
        p
          .split('/')
          .filter((s) => s.startsWith(':'))
          .map((s) => [s.slice(1), 'x']),
      );
      return matchRoute(pathFor(p, params)).pattern !== p;
    }).length,
    0,
  );
}

console.log('\n— settings —');
{
  check('every settings page is listed in the surface nav', SETTINGS_PAGES.length, 16);
  check(
    'and every one is routable',
    SETTINGS_PAGES.filter((p) => matchRoute(p.path).pattern !== p.path).length,
    0,
  );
  check(
    'and every one navigates inside the surface',
    SETTINGS_PAGES.filter((page) => !HIDDEN_VIEWS.find((view) => view.path === page.path)?.inPlace).map(
      (page) => page.path,
    ),
    [],
  );
}

console.log('\n— records —');
{
  check(
    'a source opens its record, not its edit form',
    recordPatternFor('library/sources'),
    'library/sources/:sourceId',
  );
}
{
  const pages = new Set(PATTERNS);
  check(
    'every record has a parent page',
    DETAILS.filter((d) => !pages.has(d.parent)).map((d) => d.pattern),
    [],
  );
  check(
    'the new record pages are routed',
    [
      'library/files/:fileId',
      'packs/:packId',
      'analyze/experiments/:experimentId',
      'literature-reviews/:reviewId',
    ].filter((p) => !pages.has(p)),
    [],
  );
  check(
    'reviews are a page of their own',
    PAGES.some((page) => page.path === 'literature-reviews'),
    true,
  );
  check(
    'pathFor rebuilds a path',
    pathFor('research/tasks/:taskId', { taskId: 'crs-142' }),
    'research/tasks/crs-142',
  );
  check(
    'pathFor encodes',
    pathFor('research/notes/:noteId', { noteId: 'a b/c' }),
    'research/notes/a%20b%2Fc',
  );
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: a page is a tab, a record opens its own, and a navigation lands where it should');
