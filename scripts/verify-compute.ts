/**
 * Checks the compute adapters.
 *
 * Run with: `bun scripts/verify-compute.ts`
 *
 * The compute system's one promise is that a target's configuration turns into a real command
 * line. That promise is entirely in `lib/compute/adapters.ts`, which is pure — no IPC, no
 * store — so it can be exercised here without a webview or a network.
 *
 * What is pinned: every kind has an adapter; each kind declares a schema, and the required
 * fields are the ones a form and a check both insist on; a secret is never a configuration
 * field, so a key cannot be written into a target's record; the environment carries exactly
 * the declared secrets and the config that is one; a probe is deterministic and names the
 * machine it reaches; a submit carries the job's own command through that machine's own
 * syntax; and quoting survives a command with a quote in it.
 *
 * The commands themselves are not run here — they run against the real machine when a target
 * is checked. This test is what keeps them shaped the way the check expects.
 */

import {
  ADAPTERS,
  ADAPTER_ORDER,
  adapterFor,
  defaultConfig,
  environmentFor,
  hostOf,
  missingConfig,
  missingSecrets,
  probeCommand,
  quote,
  submitCommand,
  type TargetAdapter,
} from '../src/lib/compute/adapters';
import { logLines } from '../src/lib/compute/run';
import { newJob, newTarget, type TargetKind } from '../src/store/compute';
import {
  childrenOf,
  crumbsOf,
  joinPath,
  logLinesOf,
  logText,
  terminalText,
  typedLine,
} from '../src/components/jobs/codebase';

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
 * The set of kinds
 * ============================================================================================== */

console.log('— kinds —');
{
  const kinds = Object.keys(ADAPTERS) as TargetKind[];
  check(
    'every adapter order entry has an adapter',
    ADAPTER_ORDER.every((kind) => kind in ADAPTERS),
    true,
  );
  check('the order covers every kind exactly once', [...ADAPTER_ORDER].sort(), [...kinds].sort());
  check('the order has no duplicates', new Set(ADAPTER_ORDER).size, ADAPTER_ORDER.length);
  for (const kind of kinds) {
    check(`${kind}: the adapter names its own kind`, ADAPTERS[kind].kind, kind);
  }
  checkThat(
    'a probe is declared for every kind',
    kinds.every((kind) => ADAPTERS[kind].probe({}) !== ''),
  );
  checkThat(
    'a submit is declared for every kind',
    kinds.every((kind) => ADAPTERS[kind].submit({}, 'echo hi', 'j-1') !== ''),
  );
  checkThat(
    'every kind says what a successful check means',
    kinds.every((kind) => ADAPTERS[kind].readyNote.trim().length > 0),
  );
}

/* ================================================================================================
 * Configuration schemas
 * ============================================================================================== */

console.log('\n— configuration schemas —');
{
  for (const kind of ADAPTER_ORDER) {
    const adapter: TargetAdapter = adapterFor(kind);
    const keys = adapter.config.map((field) => field.key);
    check(`${kind}: config keys are unique`, new Set(keys).size, keys.length);
    checkThat(
      `${kind}: every config field is labelled`,
      adapter.config.every((field) => field.label.trim().length > 0),
    );
    checkThat(
      `${kind}: a number field is a number`,
      adapter.config.every(
        (field) =>
          field.kind !== 'number' || field.default === undefined || Number.isFinite(Number(field.default)),
      ),
    );
  }

  // A required field is one an empty configuration leaves missing.
  for (const kind of ADAPTER_ORDER) {
    const empty = missingConfig(kind, {});
    const required = adapterFor(kind)
      .config.filter((field) => field.required)
      .map((field) => field.key);
    check(
      `${kind}: the required fields are what an empty config misses`,
      empty.map((one) => one.key),
      required,
    );
  }

  // Defaults fill a fresh configuration, and nothing required is left out.
  for (const kind of ADAPTER_ORDER) {
    const seeded = defaultConfig(kind);
    const stillMissing = missingConfig(kind, seeded).map((one) => one.key);
    const requiredWithoutDefault = adapterFor(kind)
      .config.filter((field) => field.required && !field.default)
      .map((field) => field.key);
    check(`${kind}: defaults leave only the fields a person must give`, stillMissing, requiredWithoutDefault);
  }

  // A filled configuration is complete.
  for (const kind of ADAPTER_ORDER) {
    const filled: Record<string, string> = { ...defaultConfig(kind) };
    for (const field of adapterFor(kind).config) {
      if (!filled[field.key]) filled[field.key] = 'given';
    }
    check(`${kind}: a filled configuration is complete`, missingConfig(kind, filled), []);
  }

  check('a whitespace-only value does not count as filled', missingConfig('ssh', { host: '   ' }).length, 1);
}

/* ================================================================================================
 * Secrets stay out of the record
 * ============================================================================================== */

console.log('\n— secrets —');
{
  for (const kind of ADAPTER_ORDER) {
    const adapter = adapterFor(kind);
    const configKeys = new Set(adapter.config.map((field) => field.key));
    const overlap = adapter.secrets.filter((field) => configKeys.has(field.key)).map((field) => field.key);
    check(`${kind}: no secret is also a config field`, overlap, []);
    checkThat(
      `${kind}: every secret names the environment variable it becomes`,
      adapter.secrets.every((field) => /^[A-Z][A-Z0-9_]*$/.test(field.key)),
    );
    check(
      `${kind}: secret keys are unique`,
      new Set(adapter.secrets.map((f) => f.key)).size,
      adapter.secrets.length,
    );
  }

  // A target's record keeps configuration, never a credential value.
  const record = newTarget({
    name: 'Kaggle',
    kind: 'kaggle',
    host: 'jobs/kernel',
    config: { folder: 'jobs/kernel', username: 'ada' },
  });
  check('a target record carries its configuration', record.config, {
    folder: 'jobs/kernel',
    username: 'ada',
  });
  check('and the record has no key field', 'KAGGLE_KEY' in record.config, false);
  check(
    'and the record defaults to no configuration',
    newTarget({ name: 'x', kind: 'local', host: '.' }).config,
    {},
  );

  // The credential check: a required secret that is absent is missing, a present one is not.
  check(
    'a required secret is missing when absent',
    missingSecrets('kaggle', []).map((one) => one.key),
    ['KAGGLE_KEY'],
  );
  check('and present when set', missingSecrets('kaggle', ['KAGGLE_KEY']), []);
  check(
    'an optional secret never blocks a target',
    missingSecrets('aws', ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']),
    [],
  );
  check('a kind with no secrets asks for none', missingSecrets('local', []), []);
}

/* ================================================================================================
 * The environment
 * ============================================================================================== */

console.log('\n— environment —');
{
  check(
    'a secret becomes its own environment variable',
    environmentFor('kaggle', { folder: 'k', username: 'ada' }, { KAGGLE_KEY: 'secret' }),
    { KAGGLE_KEY: 'secret', KAGGLE_USERNAME: 'ada' },
  );
  check(
    'an empty secret is left out of the environment',
    environmentFor('kaggle', { username: 'ada' }, { KAGGLE_KEY: '' }),
    { KAGGLE_USERNAME: 'ada' },
  );
  check(
    'an empty config value is left out too',
    environmentFor('kaggle', { username: '  ' }, { KAGGLE_KEY: 'secret' }),
    { KAGGLE_KEY: 'secret' },
  );
  check(
    'aws carries the three variables it declares',
    environmentFor(
      'aws',
      { region: 'eu-north-1', queue: 'q', definition: 'd' },
      { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_SESSION_TOKEN: 'c' },
    ),
    { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_SESSION_TOKEN: 'c' },
  );
  check('a kind with no environment gets an empty one', environmentFor('ssh', { host: 'h' }, {}), {});
  check('a stray secret is not exported', environmentFor('ssh', { host: 'h' }, { SOMETHING_ELSE: 'x' }), {});
}

/* ================================================================================================
 * Probes
 * ============================================================================================== */

console.log('\n— probes —');
{
  const ssh = { host: 'gpu01.lab.example.edu', user: 'ada', port: '2222', workdir: '~/runs' };
  const probe = probeCommand('ssh', ssh);
  checkThat(
    'an ssh probe addresses the user at the host',
    probe.includes('ada@gpu01.lab.example.edu'),
    probe,
  );
  checkThat('an ssh probe carries the port', probe.includes("'2222'"), probe);
  checkThat('an ssh probe never prompts', probe.includes('-o BatchMode=yes'), probe);
  checkThat('an ssh probe names its own command', probe.includes('uname'), probe);

  checkThat(
    'a slurm probe asks the scheduler, not the shell',
    probeCommand('slurm', { host: 'login.hpc' }).includes('sinfo'),
  );
  checkThat(
    'a kaggle probe makes an authenticated call',
    probeCommand('kaggle', {}).includes('kaggle competitions list'),
  );
  checkThat(
    'an aws probe asks who the credentials are',
    probeCommand('aws', { region: 'eu-north-1' }).includes('sts get-caller-identity'),
  );
  checkThat('and names the region', probeCommand('aws', { region: 'eu-north-1' }).includes('eu-north-1'));
  checkThat(
    'a local probe runs in the workspace',
    probeCommand('local', { workdir: 'work' }).includes("'work'"),
  );
  checkThat('a gcp probe asks which account is active', probeCommand('gcp', {}).includes('gcloud auth list'));
  checkThat(
    'an azure probe asks which subscription is active',
    probeCommand('azure', {}).includes('az account show'),
  );
  checkThat('a modal probe asks the CLI its version', probeCommand('modal', {}).includes('modal --version'));

  // Determinism: the same target always checks the same way.
  for (const kind of ADAPTER_ORDER) {
    const config = { ...defaultConfig(kind), host: 'h', user: 'u' };
    check(`${kind}: the probe is deterministic`, probeCommand(kind, config), probeCommand(kind, config));
  }
}

/* ================================================================================================
 * Submission
 * ============================================================================================== */

console.log('\n— submission —');
{
  const command = 'python train.py --epochs 3';
  const jobs: Record<TargetKind, string> = {
    local: `cd '.' && sh -lc 'python train.py --epochs 3'`,
    ssh: `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -p '22' 'ada@gpu.lab' 'cd '\\''~'\\'' && sh -lc '\\''python train.py --epochs 3'\\'''`,
    slurm: `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -p '22' 'ada@login.hpc' 'cd '\\''~'\\'' sbatch --parsable --time='\\''04:00:00'\\'' --wrap='\\''python train.py --epochs 3'\\'''`,
    hpc: `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -p '22' 'ada@login.hpc' 'cd '\\''~'\\'' && sh -lc '\\''python train.py --epochs 3'\\'''`,
    modal: `modal run 'jobs/train.py' -- 'python train.py --epochs 3'`,
    kaggle: `kaggle kernels push -p 'jobs/kernel'`,
    aws: `aws batch submit-job --job-name 'openlab-j-1' --job-queue 'gpu-queue' --job-definition 'openlab-gpu:3' --region 'eu-north-1' --container-overrides '{"command":["sh","-lc","python train.py --epochs 3"]}'`,
    gcp: `gcloud compute ssh 'gpu-vm-1' --zone 'europe-west4-a' --command 'python train.py --epochs 3'`,
    azure: `az vm run-command invoke -g 'openlab-rg' -n 'gpu-vm-1' --command-id RunShellScript --scripts 'python train.py --epochs 3'`,
  };

  const configs: Record<TargetKind, Record<string, string>> = {
    local: { workdir: '.' },
    ssh: { host: 'gpu.lab', user: 'ada' },
    slurm: { host: 'login.hpc', user: 'ada' },
    hpc: { host: 'login.hpc', user: 'ada' },
    modal: { entrypoint: 'jobs/train.py' },
    kaggle: { folder: 'jobs/kernel', username: 'ada' },
    aws: { region: 'eu-north-1', queue: 'gpu-queue', definition: 'openlab-gpu:3' },
    gcp: { instance: 'gpu-vm-1', zone: 'europe-west4-a' },
    azure: { resourceGroup: 'openlab-rg', vm: 'gpu-vm-1' },
  };

  for (const kind of ADAPTER_ORDER) {
    check(
      `${kind}: the job's command reaches the machine`,
      submitCommand(kind, configs[kind], command, 'j-1'),
      jobs[kind],
    );
  }

  checkThat(
    'a scheduler is given the wall clock it declares',
    submitCommand('slurm', { ...configs.slurm, time: '01:30:00' }, command, 'j-1').includes('--time='),
  );
  // The remote line is quoted as one argument, so an inner quote arrives escaped.
  const partition = submitCommand('slurm', { ...configs.slurm, partition: 'gpu' }, command, 'j-1');
  checkThat(
    'a named partition is passed to the scheduler',
    partition.includes('--partition=') && partition.includes('gpu'),
    partition,
  );
  const account = submitCommand('slurm', { ...configs.slurm, account: 'proj' }, command, 'j-1');
  checkThat(
    'a named account is passed to the scheduler',
    account.includes('--account=') && account.includes('proj'),
    account,
  );
  const launcher = submitCommand('hpc', { ...configs.hpc, launcher: 'srun --ntasks=8' }, command, 'j-1');
  checkThat(
    'a launcher replaces the plain shell',
    launcher.includes('srun --ntasks=8') && launcher.includes('train.py'),
    launcher,
  );
  checkThat(
    'an aws job is named after the ledger row',
    submitCommand('aws', configs.aws, command, 'j-42').includes('openlab-j-42'),
  );
  checkThat(
    'a batch command is a container override, as JSON',
    submitCommand('aws', configs.aws, command, 'j-1').includes(
      '{"command":["sh","-lc","python train.py --epochs 3"]}',
    ),
  );
  checkThat(
    'modal passes the command after the separator',
    submitCommand('modal', { ...configs.modal, extra: '--detach' }, command, 'j-1').includes(
      "--detach 'jobs/train.py' -- 'python",
    ),
  );
  checkThat(
    'an optional config value that is empty is left out of the command',
    !submitCommand('aws', { ...configs.aws, profile: '' }, command, 'j-1').includes('--profile'),
  );
}

/* ================================================================================================
 * Quoting
 * ============================================================================================== */

console.log('\n— quoting —');
{
  check('a plain word is quoted', quote('plain'), "'plain'");
  check('a space survives', quote('two words'), "'two words'");
  check('a single quote is escaped', quote("it's"), `'it'\\''s'`);
  checkThat(
    'a command with a quote in it keeps one shell word',
    submitCommand('local', { workdir: '.' }, `echo "it's fine"`, 'j-1').includes(`'echo "it'\\''s fine"'`),
  );
}

/* ================================================================================================
 * The host line
 * ============================================================================================== */

console.log('\n— host —');
{
  check('ssh reads its host', hostOf('ssh', { host: 'gpu.lab' }), 'gpu.lab');
  check('aws reads its queue', hostOf('aws', { queue: 'gpu-queue' }), 'gpu-queue');
  check('gcp reads its instance', hostOf('gcp', { instance: 'gpu-vm-1' }), 'gpu-vm-1');
  check('azure reads its virtual machine', hostOf('azure', { vm: 'gpu-vm-1' }), 'gpu-vm-1');
  check('modal reads its entrypoint', hostOf('modal', { entrypoint: 'jobs/train.py' }), 'jobs/train.py');
  check('kaggle reads its folder', hostOf('kaggle', { folder: 'jobs/kernel' }), 'jobs/kernel');
  check('an empty configuration falls back to the kind', hostOf('ssh', {}), 'SSH host');
}

/* ================================================================================================
 * A target built from a schema
 * ============================================================================================== */

console.log('\n— a target from a schema —');
{
  const config = { ...defaultConfig('ssh'), host: 'gpu.lab', user: 'ada', workdir: '~/runs' };
  const target = newTarget({
    name: 'Lab GPU',
    kind: 'ssh',
    host: hostOf('ssh', config),
    summary: adapterFor('ssh').summary,
    cores: 32,
    memoryGb: 128,
    gpus: '2×A100',
    concurrency: 2,
    config,
  });
  check('the target names its host', target.host, 'gpu.lab');
  check('and keeps the configuration', target.config, config);
  check('and starts needing a check', target.readiness, 'needs-setup');
  check('and asks for one', target.needs, ['A successful connection check']);
  check(
    'and its probe runs against that configuration',
    probeCommand(target.kind, target.config).includes('ada@gpu.lab'),
    true,
  );
}

/* ================================================================================================
 * The working directory a job's codebase page shows
 * ============================================================================================== */

console.log('\n— the working directory —');
{
  const files = [
    { name: 'README.md', path: 'README.md' },
    { name: 'analysis.py', path: 'analysis.py' },
    { name: 'atac-v3.toml', path: 'configs/atac-v3.toml' },
    { name: 'qc.py', path: 'configs/qc.py' },
    { name: 'counts.csv', path: 'data/counts.csv' },
    { name: 'plot.py', path: 'results/figure3/plot.py' },
  ];
  const root = childrenOf(files, '');
  check('the root lists its folders by name', root.folders, ['configs', 'data', 'results']);
  check(
    'and its files, by name',
    root.files.map((file) => file.name),
    ['analysis.py', 'README.md'],
  );
  check(
    'a folder holds what its paths say',
    childrenOf(files, 'configs').files.map((file) => file.name),
    ['atac-v3.toml', 'qc.py'],
  );
  check('a folder nests as deep as its paths do', childrenOf(files, 'results').folders, ['figure3']);
  check(
    'a nested file keeps its whole path',
    childrenOf(files, 'results/figure3').files.map((file) => file.path),
    ['results/figure3/plot.py'],
  );
  check('a folder the walk never found is empty', childrenOf(files, 'nope/nope'), {
    folders: [],
    files: [],
  });
  check('a file is not a folder', childrenOf(files, 'README.md'), { folders: [], files: [] });
  check('a breadcrumb walks from the root down', crumbsOf('results/figure3'), ['results', 'results/figure3']);
  check('the root has no breadcrumb', crumbsOf(''), []);

  check('a cd walks into a folder', joinPath('', 'configs'), 'configs');
  check('and further in from there', joinPath('configs', 'nested/deep'), 'configs/nested/deep');
  check('and back out with ..', joinPath('configs/nested', '..'), 'configs');
  check('a cd given nothing stays put', joinPath('configs', ''), 'configs');
  check('a lone dot changes nothing', joinPath('configs', '.'), 'configs');
  check('a step above the root is left to the command layer', joinPath('', '..'), '..');
  check('an absolute path stays absolute', joinPath('configs', '/Users/me/lab'), '/Users/me/lab');
  check('and so does a step taken from one', joinPath('/Users/me/lab', 'configs'), '/Users/me/lab/configs');

  const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');
  check('a typed line reads as the prompt and the command', stripAnsi(typedLine('ls -la')), '❯ ls -la');
  checkThat('and is written in the terminal accent', typedLine('ls').includes('\u001b[34m'));
  const job = newJob({
    name: 'Reproduce figure 3',
    command: 'python analysis.py --config configs/atac-v3.toml',
    targetId: 't-1',
  });
  const transcript = terminalText(job);
  checkThat(
    'the transcript opens with the command under a prompt',
    transcript[0]?.includes('❯ python analysis.py --config configs/atac-v3.toml') === true,
  );
  checkThat('the command is written in the terminal accent', transcript[0]?.includes('\u001b[34m') === true);
  checkThat(
    'every transcript line ends by returning the colour',
    transcript.every((line) => line.endsWith('\u001b[0m')),
  );

  const logged = logLinesOf(job);
  const log = logText(logged);
  check('the log is one terminal line per logged line', log.length, logged.length);
  checkThat('a log line leads with its clock', /^\u001b\[90m\d{2}:\d{2}:\d{2}\u001b\[0m/.test(log[0] ?? ''));
}

// ── A job's log keeps both ends ────────────────────────────────────────────────────────────

const long = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
const kept = logLines(long);
check('a long log is capped', kept.length, 12);
check('it keeps the opening line', kept[0], 'line 1');
check('and the line that says how it ended', kept[kept.length - 1], 'line 40');
check('with a count of what is hidden', kept[3], '… 29 lines between …');
check('a short log is kept whole', logLines('one\ntwo'), ['one', 'two']);
check('blank lines are dropped', logLines('a\n\n\nb'), ['a', 'b']);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
