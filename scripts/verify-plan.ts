/**
 * Checks the plan files.
 *
 * Run with: `bun scripts/verify-plan.ts`
 *
 * The plan layer is the one place openlab writes into a repository a lab commits to, so the
 * two things that can go wrong are both pinned here: a file that does not read back as what
 * was written (a plan that changes meaning on a round trip), and a merge that sets a field a
 * file never mentioned (a file erasing the record).
 *
 * What is pinned: scalars survive quoting, including the separators a title may contain; an
 * item line refuses anything that is not the shape this module writes, rather than
 * half-reading it; a wave file round-trips its period, goal and items; the files split tasks
 * between waves and the backlog, and a job lands in the wave of the tasks it names; and the
 * merge creates, matches and patches only the fields a file carries.
 */

import {
  PLAN_BACKLOG,
  PLAN_DIR,
  PLAN_WAVE_DIR,
  readBacklogFile,
  readBody,
  readFrontMatter,
  readScalar,
  readTaskLine,
  readTaskLines,
  readWaveFile,
  jobsOfWave,
  memberHandle,
  renderBacklogFile,
  renderTaskLine,
  renderWaveFile,
  wavePath,
  waveSlug,
} from '../src/lib/plan/format';
import { mergeIsEmpty, planMerge } from '../src/lib/plan/merge';
import { newMember, newTask, newWave, type Member, type Task, type Wave } from '../src/store/research';
import type { Job } from '../src/store/compute';

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

/** Assert a condition the test states in words. */
function checkThat(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
}

/* ================================================================================================
 * Fixtures
 * ============================================================================================== */

const MEMBERS: Member[] = [
  newMember('Ada Lovelace', 'PI', 'ada@example.org'),
  newMember('Grace Hopper', 'engineer'),
];
const [ADA, GRACE] = MEMBERS;

function task(overrides: Partial<Task> = {}): Task {
  const base = newTask([], 'A task');
  return { ...base, key: 'TASK-1', title: 'A task', ...overrides };
}

function wave(overrides: Partial<Wave> = {}): Wave {
  return {
    id: 'w-abc123',
    number: 3,
    name: 'Docking campaign',
    startDate: '2026-03-03',
    endDate: '2026-03-24',
    goal: 'Run the docking sweep across the twelve kinase structures.',
    ...overrides,
  };
}

const AT = '2026-10-17T09:12:00.000Z';

/* ================================================================================================
 * Scalars
 * ============================================================================================== */

console.log('— scalars —');
{
  check('a number is read as a number', readScalar(' 12 '), 12);
  check('a negative number too', readScalar('-3'), -3);
  check('null is null', readScalar('null'), null);
  check('an empty value is null', readScalar(''), null);
  check('a bare word is taken as it is read', readScalar('bare'), 'bare');
  check('and so is a bare name with spaces', readScalar('Docking campaign'), 'Docking campaign');
  check('an unclosed quote is refused', readScalar('"docking'), undefined);
  check('an unclosed sequence is refused', readScalar('[a, b'), undefined);
  check('a mapping is refused', readScalar('{a: b}'), undefined);
  check('a flow sequence of strings', readScalar('["a", "b"]'), ['a', 'b']);
  check('an empty flow sequence', readScalar('[]'), []);
}

/* ================================================================================================
 * Item lines
 * ============================================================================================== */

console.log('\n— item lines —');
{
  const line = renderTaskLine(
    task({ assigneeId: ADA.id, status: 'active', kind: 'analysis', priority: 3 }),
    memberHandle(ADA),
  );
  check('a line reads back as the task it was', readTaskLine(line), {
    key: 'TASK-1',
    title: 'A task',
    status: 'active',
    kind: 'analysis',
    priority: 3,
    assignee: 'ada-lovelace',
  });
  check('a handle is the name, not the id', memberHandle(ADA), 'ada-lovelace');
  check('an accented name folds to a handle', memberHandle({ id: 'm-1', name: 'Ayşe Çelik' }), 'ayse-celik');
  check('a nameless member falls back to its id', memberHandle({ id: 'm-1', name: '??' }), 'm-1');
  checkThat('an unowned item says so', renderTaskLine(task()).includes('@none'), renderTaskLine(task()));

  const done = renderTaskLine(task({ status: 'done' }));
  checkThat('a finished item is ticked', done.startsWith('- [x] TASK-1'), done);
  check('and reads back as done', readTaskLine(done)?.status, 'done');

  // The two characters a line uses as separators are the ones a title might contain.
  const dotted = renderTaskLine(task({ title: 'Panel · with a middle dot' }));
  check(
    'a title with the field separator survives',
    readTaskLine(dotted)?.title,
    'Panel · with a middle dot',
  );
  const dashed = renderTaskLine(task({ title: 'Panel — with a dash' }));
  check('a title with the title separator survives', readTaskLine(dashed)?.title, 'Panel — with a dash');
  const accented = renderTaskLine(task({ title: 'Seçicilik — paneli (n=12)' }));
  check('an accented title survives', readTaskLine(accented)?.title, 'Seçicilik — paneli (n=12)');
  const quoted = renderTaskLine(task({ title: 'The "final" panel' }));
  check('a quoted title survives', readTaskLine(quoted)?.title, 'The "final" panel');

  // A line that is not the shape this module writes is refused, never half-read.
  check('a plain bullet is not an item', readTaskLine('- just a note'), undefined);
  check('a missing field block is refused', readTaskLine('- [ ] TASK-1 A task'), undefined);
  check('too few fields are refused', readTaskLine('- [ ] TASK-1 A task — active · analysis'), undefined);
  check(
    'an unknown status is refused',
    readTaskLine('- [ ] TASK-1 A task — shipped · analysis · p2 · @none'),
    undefined,
  );
  check(
    'an unknown kind is refused',
    readTaskLine('- [ ] TASK-1 A task — active · cooking · p2 · @none'),
    undefined,
  );
  check(
    'a bad priority is refused',
    readTaskLine('- [ ] TASK-1 A task — active · analysis · p9 · @none'),
    undefined,
  );
  check('a heading is not an item', readTaskLine('## Tasks'), undefined);
  check(
    'the items of a body are found',
    readTaskLines('## Tasks\n\n- [ ] TASK-1 A — active · analysis · p2 · @none\n').length,
    1,
  );
}

/* ================================================================================================
 * Wave files
 * ============================================================================================== */

console.log('\n— wave files —');
{
  const waveFixture = wave();
  const tasks = [
    task({
      key: 'TASK-14',
      title: 'Re-run the panel',
      waveId: waveFixture.id,
      assigneeId: ADA.id,
      status: 'active',
    }),
    task({ key: 'TASK-15', title: 'Fetch the structures', waveId: waveFixture.id, status: 'done' }),
  ];
  const jobs: Job[] = [
    {
      id: 'j-1',
      name: 'docking sweep',
      state: 'succeeded',
      targetId: 't-1',
      startedMinutesAgo: 4,
      duration: '12 m',
      progress: null,
      cpuHours: null,
      gpuHours: 12.5,
      cost: '—',
      command: 'run docking',
      inputs: [],
      outputs: [],
      resources: { cores: 4, memoryGb: 16, wallClock: '4 h' },
      logTail: [],
      history: [],
      taskKeys: ['TASK-14'],
      objective: 'sweep',
    },
    {
      id: 'j-2',
      name: 'unrelated',
      state: 'running',
      targetId: 't-1',
      startedMinutesAgo: 1,
      duration: '1 m',
      progress: null,
      cpuHours: 1,
      gpuHours: null,
      cost: '—',
      command: 'x',
      inputs: [],
      outputs: [],
      resources: { cores: 1, memoryGb: 2, wallClock: '1 h' },
      logTail: [],
      history: [],
      taskKeys: [],
      objective: 'other',
    },
  ];

  const text = renderWaveFile({
    wave: waveFixture,
    tasks,
    jobs,
    handleOf: (id) => {
      const member = MEMBERS.find((candidate) => candidate.id === id);
      return member ? memberHandle(member) : undefined;
    },
    at: AT,
  });

  const read = readWaveFile(wavePath(waveFixture), text);
  checkThat('a wave file reads back', read !== undefined);
  check('its id', read?.id, waveFixture.id);
  check('its number', read?.number, 3);
  check('its name', read?.name, 'Docking campaign');
  check('its start', read?.start, '2026-03-03');
  check('its end', read?.end, '2026-03-24');
  check('its goal', read?.goal, waveFixture.goal);
  check(
    'its items',
    read?.items.map((item) => item.key),
    ['TASK-14', 'TASK-15'],
  );
  check(
    'and their status',
    read?.items.map((item) => item.status),
    ['active', 'done'],
  );
  check('and their owner', read?.items[0].assignee, 'ada-lovelace');

  checkThat(
    'the file names the wave in its heading',
    text.includes('# W3 · Docking campaign'),
    text.split('\n')[4],
  );
  check(
    'the jobs of a wave are the jobs of its tasks',
    jobsOfWave(jobs, tasks).map((job) => job.id),
    ['j-1'],
  );
  check('a job that names no task in the wave is not its job', jobsOfWave(jobs, []), []);
  const withCompute = renderWaveFile({ wave: waveFixture, tasks, jobs: jobsOfWave(jobs, tasks), at: AT });
  checkThat(
    'the compute section carries the wave’s job',
    withCompute.includes('j-1') && withCompute.includes('12.5 GPU-h'),
  );
  checkThat('and leaves out a job that names no task in it', !withCompute.includes('j-2'));

  const tricky = renderWaveFile({
    wave: wave({ name: 'Wet-lab: "round 2" \\ the sequel' }),
    tasks: [],
    at: AT,
  });
  check(
    'a name with a quote and a backslash round-trips',
    readWaveFile(wavePath(waveFixture), tricky)?.name,
    'Wet-lab: "round 2" \\ the sequel',
  );

  const noFrontMatter = readWaveFile('x.md', '# Just a heading\n');
  check('a file with no front matter is not a wave', noFrontMatter, undefined);

  // A file that does not name its wave leaves the app's name alone.
  const unnamed = readWaveFile(
    `${PLAN_WAVE_DIR}/003-x.md`,
    ['---', 'number: 3', '---', '', '# W3', '', '## Tasks', ''].join('\n'),
  );
  check('an unnamed wave reads as unnamed', unnamed?.name, '');
  check(
    'and a merge leaves the app’s name alone',
    planMerge({ files: [unnamed!], backlog: [], waves: [wave()], tasks: [], members: MEMBERS }).waves,
    [],
  );

  // A wave file someone wrote by hand: no id, no dates.
  const handWritten = readWaveFile(
    `${PLAN_WAVE_DIR}/005-new-idea.md`,
    [
      '---',
      'number: 5',
      'name: "Exploratory sweep"',
      '---',
      '',
      '# W5',
      '',
      'Try the other cutoff.',
      '',
      '## Tasks',
      '',
      '- [ ] TASK-14 Re-run the panel — active · analysis · p2 · @none',
      '',
    ].join('\n'),
  );
  check('a hand-written file has no id', handWritten?.id, null);
  check('but keeps its number', handWritten?.number, 5);
  check('and its goal', handWritten?.goal, 'Try the other cutoff.');
  check('and its items', handWritten?.items.length, 1);
}

/* ================================================================================================
 * Backlog
 * ============================================================================================== */

console.log('\n— backlog —');
{
  const loose = [task({ key: 'TASK-20', title: 'Read the review' })];
  const text = renderBacklogFile({ tasks: loose, at: AT });
  check(
    'the backlog reads back',
    readBacklogFile(text).map((item) => item.key),
    ['TASK-20'],
  );
  check('its front matter has no wave', readFrontMatter(text).number, undefined);
  check(
    'an empty backlog says so',
    renderBacklogFile({ tasks: [], at: AT }).includes('Nothing in the backlog'),
    true,
  );
  check('and reads back as no items', readBacklogFile(renderBacklogFile({ tasks: [], at: AT })).length, 0);
}

/* ================================================================================================
 * Slugs and paths
 * ============================================================================================== */

console.log('\n— slugs —');
{
  check('a slug is the number and the name', waveSlug(wave()), '003-docking-campaign');
  check('accents fold', waveSlug(wave({ name: 'Seçicilik ölçümü' })), '003-secicilik-olcumu');
  check('punctuation folds', waveSlug(wave({ name: 'Wet-lab: round 2!' })), '003-wet-lab-round-2');
  check('a nameless wave is just its number', waveSlug(wave({ name: '!!' })), '003');
  check('the number is padded', waveSlug(wave({ number: 12, name: 'x' })), '012-x');
  check('a path is inside the plan folder', wavePath(wave()), `${PLAN_DIR}/waves/003-docking-campaign.md`);
  check('the constants agree', PLAN_BACKLOG.startsWith(PLAN_DIR), true);
}

/* ================================================================================================
 * The merge
 * ============================================================================================== */

console.log('\n— merge —');
{
  const existing = wave();
  const waveFile = readWaveFile(
    wavePath(existing),
    renderWaveFile({
      wave: { ...existing, name: 'Renamed by a colleague', endDate: '2026-04-01' },
      tasks: [task({ key: 'TASK-14', title: 'Re-run the panel', status: 'done' })],
      at: AT,
    }),
  )!;

  const inWave = task({ key: 'TASK-14', title: 'Re-run the panel', waveId: existing.id, status: 'active' });
  const merge = planMerge({
    files: [waveFile],
    backlog: [],
    waves: [existing],
    tasks: [inWave],
    members: MEMBERS,
  });
  check('a matching wave is not recreated', merge.created.length, 0);
  check('its name and dates are taken from the file', merge.waves, [
    { id: existing.id, patch: { name: 'Renamed by a colleague', endDate: '2026-04-01' } },
  ]);
  check('and its item’s status follows the tick', merge.tasks, [
    { id: inWave.id, key: 'TASK-14', patch: { status: 'done' } },
  ]);
  check('nothing is reported unknown', merge.unknown, []);
  check(
    'a merge with nothing to do says so',
    mergeIsEmpty({ created: [], waves: [], tasks: [], unknown: [] }),
    true,
  );

  // A file that matches nothing creates the wave it describes.
  const handWritten = readWaveFile(
    `${PLAN_WAVE_DIR}/005-new-idea.md`,
    [
      '---',
      'number: 5',
      'name: "Exploratory sweep"',
      'start: "2026-05-01"',
      'end: "2026-05-14"',
      '---',
      '',
      'Try the other cutoff.',
      '',
      '## Tasks',
      '',
      '- [ ] TASK-14 Re-run the panel — active · analysis · p2 · @ada lovelace',
      '',
    ].join('\n'),
  )!;
  const fresh = planMerge({
    files: [handWritten],
    backlog: [],
    waves: [existing],
    tasks: [task({ key: 'TASK-14', title: 'Re-run the panel', waveId: existing.id })],
    members: MEMBERS,
  });
  check('a hand-written wave is created', fresh.created.length, 1);
  check('with the number the file gives', fresh.created[0].wave.number, 5);
  check(
    'and the period the file gives',
    [fresh.created[0].wave.startDate, fresh.created[0].wave.endDate],
    ['2026-05-01', '2026-05-14'],
  );
  check('and it is not the wave it did not match', fresh.created[0].wave.id === existing.id, false);
  check('its item moves into the new wave', fresh.tasks[0].patch.waveId, fresh.created[0].wave.id);
  check('and the owner is resolved by name', fresh.tasks[0].patch.assigneeId, ADA.id);

  // A wave file with no id still matches by number.
  const renumbered = readWaveFile(
    wavePath(existing),
    renderWaveFile({ wave: { ...existing, id: 'w-other', name: 'Same number' }, tasks: [], at: AT }),
  )!;
  const byNumber = planMerge({
    files: [renumbered],
    backlog: [],
    waves: [existing],
    tasks: [],
    members: MEMBERS,
  });
  check('a file with an unknown id matches by number', byNumber.created.length, 0);
  check('and edits that wave', byNumber.waves[0].id, existing.id);

  // The backlog owns "in no wave".
  const backlog = readBacklogFile(renderBacklogFile({ tasks: [task({ key: 'TASK-14' })], at: AT }));
  const assigned = task({ key: 'TASK-14', waveId: existing.id, assigneeId: ADA.id });
  const backToBacklog = planMerge({
    files: [],
    backlog,
    waves: [existing],
    tasks: [assigned],
    members: MEMBERS,
  });
  // The line says `@none`, so the backlog both takes the task out of its wave and unowns it.
  check('a task listed in the backlog leaves its wave', backToBacklog.tasks, [
    { id: assigned.id, key: 'TASK-14', patch: { assigneeId: null, waveId: null } },
  ]);

  // An unknown key is reported, not invented.
  const unknown = planMerge({
    files: [],
    backlog: readBacklogFile(
      renderBacklogFile({ tasks: [task({ key: 'TASK-999', title: 'Ghost' })], at: AT }),
    ),
    waves: [],
    tasks: [],
    members: MEMBERS,
  });
  check('an unknown key is reported', unknown.unknown, [{ key: 'TASK-999', path: 'backlog.md' }]);
  check('and nothing is created from it', [unknown.created.length, unknown.tasks.length], [0, 0]);

  // A file that says nothing about a field leaves it alone.
  const quiet = planMerge({
    files: [readWaveFile(wavePath(existing), renderWaveFile({ wave: { ...existing }, tasks: [], at: AT }))!],
    backlog: [],
    waves: [existing],
    tasks: [
      task({
        key: 'TASK-14',
        title: 'Mine',
        waveId: existing.id,
        status: 'active',
        priority: 4,
        kind: 'data',
        assigneeId: GRACE.id,
      }),
    ],
    members: MEMBERS,
  });
  check('an unchanged wave asks for nothing', quiet.waves, []);
  check('and an unlisted task is untouched', quiet.tasks, []);
}

/* ================================================================================================
 * The files of a plan
 * ============================================================================================== */

console.log('\n— the plan as files —');
{
  // `planFiles` and the write rules are imported here rather than at the top because the
  // module pulls in the IPC layer, which has nothing to say in a test.
  const { planFiles, isForeign, alreadyWritten, orphanedPaths, fingerprint } =
    await import('../src/lib/plan/files');

  const waveFixture = wave();
  const source = {
    waves: [waveFixture],
    tasks: [
      task({ key: 'TASK-14', title: 'In the wave', waveId: waveFixture.id }),
      task({ key: 'TASK-20', title: 'Loose', waveId: null }),
    ],
    members: MEMBERS,
    jobs: [],
  };

  const files = planFiles(source, AT);
  check('a plan is a readme, a backlog and a file per wave', [...files.keys()].sort(), [
    `${PLAN_DIR}/README.md`,
    PLAN_BACKLOG,
    `${PLAN_WAVE_DIR}/003-docking-campaign.md`,
  ]);
  checkThat(
    'the wave file carries its task',
    files.get(`${PLAN_WAVE_DIR}/003-docking-campaign.md`)!.includes('TASK-14'),
  );
  checkThat(
    'and not the loose one',
    !files.get(`${PLAN_WAVE_DIR}/003-docking-campaign.md`)!.includes('TASK-20'),
  );
  checkThat('the backlog carries the loose one', files.get(PLAN_BACKLOG)!.includes('TASK-20'));
  checkThat('and not the one in the wave', !files.get(PLAN_BACKLOG)!.includes('TASK-14'));
  check(
    'the same plan renders the same bytes',
    [...planFiles(source, AT)].map(([, text]) => text).join(),
    [...files].map(([, text]) => text).join(),
  );
  checkThat(
    'the readme explains the item shape',
    files.get(`${PLAN_DIR}/README.md`)!.includes('- [ ] TASK-14'),
    true,
  );
  check(
    'a plan with no waves is just the readme and the backlog',
    planFiles({ ...source, waves: [], tasks: [] }, AT).size,
    2,
  );
  check(
    'the body of a file is what follows the front matter',
    readBody(files.get(PLAN_BACKLOG)!).startsWith('# Backlog'),
    true,
  );

  /* ---- What is written, and what is left alone ----
   *
   * This is the rule that keeps a repository a lab commits to safe: openlab's own output is
   * never mistaken for an edit, and a file somebody changed is never overwritten unread. */

  const backlogText = files.get(PLAN_BACKLOG)!;
  const remembered = { [PLAN_BACKLOG]: fingerprint(backlogText) };

  check('a file openlab wrote is not foreign', isForeign(remembered[PLAN_BACKLOG], backlogText), false);
  check('and is not written a second time', alreadyWritten(remembered[PLAN_BACKLOG], backlogText), true);
  check('a file with no memory of being written is foreign', isForeign(undefined, backlogText), true);

  const edited = `${backlogText}- [ ] TASK-20 Read the review — backlog · data · p2 · @none\n`;
  check('a file somebody changed is foreign', isForeign(remembered[PLAN_BACKLOG], edited), true);
  check(
    'so it is written back in openlab’s own shape',
    alreadyWritten(remembered[PLAN_BACKLOG], edited),
    false,
  );

  check(
    'a file the plan no longer has is an orphan',
    orphanedPaths({ [`${PLAN_WAVE_DIR}/001-gone.md`]: 'x', [PLAN_BACKLOG]: 'y' }, files),
    [`${PLAN_WAVE_DIR}/001-gone.md`],
  );
  check('and a file the plan still has is not', orphanedPaths({ [PLAN_BACKLOG]: 'y' }, files), []);
  check('with no memory there are no orphans', orphanedPaths(undefined, files), []);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
