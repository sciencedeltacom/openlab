/**
 * Checks the tracker's data model and queries.
 *
 * Run with: `bun scripts/verify-tracker.ts`
 *
 * The tracker no longer ships fixture rows: tasks come from the store, and the queries that
 * summarise them take the list as an argument. These checks pin the arithmetic the tracker and
 * the analytics surface depend on — grouping, filtering and overdue detection — on inputs the
 * test builds, so a regression is caught without a browser.
 */

import {
  currentWave,
  filterTasks,
  intakeQueue,
  intakeStatus,
  newInboxEntry,
  isOverdue,
  labelsOf,
  memberById,
  newLabel,
  newMember,
  newTask,
  newView,
  newWave,
  type InboxEntry,
  type Task,
  type Wave,
} from '../src/store/research';
import { HOME, matchRoute } from '../src/app/routes';

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

/** A task with the fields a query reads, defaulted from {@link newTask}. */
function task(overrides: Partial<Task> & { title: string }): Task {
  return { ...newTask([], overrides.title), ...overrides };
}

/* ================================================================================================
 * Creation
 * ============================================================================================== */

console.log('\n— creation —');
{
  const first = newTask([]);
  check('the first key is TASK-1', first.key, 'TASK-1');
  check('a new task starts in the backlog', first.status, 'backlog');
  check('and is unassigned', first.assigneeId, null);

  const next = newTask([first, { ...first, key: 'TASK-7' }]);
  check('the key continues the highest number', next.key, 'TASK-8');
  check('ids are unique', newTask([]).id === newTask([]).id, false);
}

/* ================================================================================================
 * Waves, views, and what is no longer part of the model
 * ============================================================================================== */

console.log('\n— waves and views —');
{
  const waves: Wave[] = [
    { ...newWave([]), number: 4, startDate: '2000-01-01', endDate: '2999-12-31' },
    { ...newWave([]), number: 7, startDate: '1990-01-01', endDate: '1990-12-31' },
  ];
  check('the current wave is the one covering today', currentWave(waves)?.number, 4);
  check('an empty wave list has no current wave', currentWave([]), undefined);
  check('a new wave numbers after the highest', newWave(waves).number, 8);

  const view = newView({ status: ['blocked'] }, 'board', 'Blocked');
  check(
    'a new view carries its filter and layout',
    [view.name, view.layout, view.filters.status],
    ['Blocked', 'board', ['blocked']],
  );
  check('and starts unstared', view.starred, false);
}

/* ================================================================================================
 * Intake
 *
 * The queue is derived from the records, so the checks that matter are which records appear
 * and what a decision does to them.
 * ============================================================================================== */

console.log('\n— intake —');
{
  const owned = { ...newTask([], 'Owned work'), status: 'backlog' as const, assigneeId: 'm-ada' };
  const loose = { ...newTask([], 'Loose work'), status: 'backlog' as const };
  const planned = { ...newTask([], 'Already planned'), status: 'planned' as const };
  const read: InboxEntry = {
    id: 'i-1',
    kind: 'comment',
    taskId: null,
    actorId: 'm-ada',
    body: 'Looked at the panel.',
    createdAt: Date.now(),
    read: true,
  };
  const unread: InboxEntry = { ...read, id: 'i-2', body: 'Can you check this?', read: false };

  const queue = intakeQueue([read, unread], [owned, loose, planned]);
  check(
    'unowned backlog work waits for a decision',
    queue.some((row) => row.task?.id === loose.id),
    true,
  );
  check(
    'work somebody owns does not',
    queue.some((row) => row.task?.id === owned.id),
    false,
  );
  check(
    'work already planned does not',
    queue.some((row) => row.task?.id === planned.id),
    false,
  );
  check(
    'an unread entry waits too',
    queue.some((row) => row.entryId === unread.id),
    true,
  );
  check(
    'a read entry does not',
    queue.some((row) => row.entryId === read.id),
    false,
  );
  check(
    'the backlog row names its task',
    queue.find((row) => row.task?.id === loose.id)?.body,
    `${loose.key} has sat in the backlog with no owner.`,
  );

  check('accepting plans the work', intakeStatus('accepted'), 'planned');
  check('declining closes it', intakeStatus('declined'), 'cancelled');

  // The point of deriving the queue: the decision is what removes the row.
  const after = { ...loose, status: intakeStatus('accepted') };
  check('a decided task leaves the queue', intakeQueue([], [after]).length, 0);
  check('and an entry leaves it once it is read', intakeQueue([{ ...unread, read: true }], []).length, 0);

  // What a background run files: the inbox's producer, and the row it becomes.
  const filed = newInboxEntry({
    kind: 'review-done',
    body: 'The review “Off-target” finished — 24 records screened.',
  });
  check('a filed entry starts unread', filed.read, false);
  check('and is attributed to the system, not a person', filed.actorId, 'system');
  check('with no task unless one is named', filed.taskId, null);
  check('and a fresh id', filed.id.startsWith('i-'), true);
  check(
    'two entries are two entries',
    newInboxEntry({ kind: 'run-failed', body: 'x' }).id === filed.id,
    false,
  );
  check('a filed entry waits in the queue', intakeQueue([filed], []).length, 1);
  check(
    'a failed run is a row of its own kind',
    intakeQueue([newInboxEntry({ kind: 'run-failed', body: 'The run failed.' })], [])[0]?.kind,
    'run-failed',
  );
  check(
    'and it can name the task it was for',
    newInboxEntry({ kind: 'run-failed', body: 'x', taskId: 't-1' }).taskId,
    't-1',
  );
}

/* ================================================================================================
 * The removed study/program layer
 *
 * These are the checks that keep a deletion deleted. The fields are gone from the type, so a
 * use of them would not compile; what a type cannot catch is the *route* coming back, or a
 * persisted task growing a study again through a migration that was not generated.
 * ============================================================================================== */

console.log('\n— the removed layer —');
{
  check('a task carries no study', Object.keys(newTask([])).includes('studyId'), false);
  check('and no milestone', Object.keys(newTask([])).includes('milestoneId'), false);
  check('the studies page is not a route', matchRoute('research/studies').found, false);
  check('nor the programs page', matchRoute('research/programs').found, false);
  check('nor a study record', matchRoute('research/studies/s-1').found, false);
  check('nor a program record', matchRoute('research/programs/p-1').found, false);
}

/* ================================================================================================
 * People and labels
 * ============================================================================================== */

console.log('\n— people and labels —');
{
  const members = [newMember('Ada Lovelace', 'Principal investigator', 'ada@example.org')];
  check('a new member derives initials from the name', members[0]!.initials, 'AL');
  check('memberById finds a created member', memberById(members, members[0]!.id)?.name, 'Ada Lovelace');
  check('memberById is undefined for no id', memberById(members, null), undefined);
  check('memberById is undefined for an unknown id', memberById(members, 'nope'), undefined);

  const labels = [newLabel('method', '#000000', 'method')];
  const tagged = task({ title: 'tagged', labels: [labels[0]!.id, 'missing'] });
  check(
    'labelsOf resolves the labels a task carries',
    labelsOf(labels, tagged).map((l) => l.name),
    ['method'],
  );
}

/* ================================================================================================
 * Filtering and overdue
 * ============================================================================================== */

console.log('\n— filtering —');
{
  const tasks: Task[] = [
    task({
      title: 'late analysis',
      kind: 'analysis',
      status: 'active',
      priority: 4,
      dueDate: '2000-01-01',
      assigneeId: 'm1',
    }),
    task({ title: 'writing', kind: 'writing', status: 'done', priority: 1 }),
    task({ title: 'backlog data', kind: 'data', status: 'backlog', priority: 2, labels: ['l1'] }),
  ];

  check(
    'filter by status',
    filterTasks(tasks, { status: ['active'] }).map((t) => t.title),
    ['late analysis'],
  );
  check(
    'filter by kind',
    filterTasks(tasks, { kind: ['data'] }).map((t) => t.title),
    ['backlog data'],
  );
  check('filter by assignee', filterTasks(tasks, { assigneeId: ['m1'] }).length, 1);
  check(
    'filter by label',
    filterTasks(tasks, { label: ['l1'] }).map((t) => t.title),
    ['backlog data'],
  );
  check('filter by text matches the title', filterTasks(tasks, { text: 'writing' }).length, 1);
  check(
    'overdue only',
    filterTasks(tasks, { overdue: true }).map((t) => t.title),
    ['late analysis'],
  );
  check('an empty filter keeps everything', filterTasks(tasks, {}).length, 3);

  check('a past due open task is overdue', isOverdue(tasks[0]!), true);
  check('a finished task is never overdue', isOverdue(tasks[1]!), false);
  check('a task with no due date is not overdue', isOverdue(tasks[2]!), false);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: the tracker creates tasks and summarises them from the given list');
