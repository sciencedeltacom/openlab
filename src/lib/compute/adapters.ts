/**
 * Target adapters.
 *
 * Every kind of machine a job can be sent to answers the same three questions: what do I need
 * to know about it, how do I check it is alive, and how does a command reach it. This module
 * is the only place those answers live, and each one is a real command line — a probe that
 * runs the provider's own CLI and a submit that wraps the job's command the way that machine
 * receives it.
 *
 * Nothing here is a stub. A probe for SSH runs `ssh`; a probe for Kaggle makes one
 * authenticated API call; a submit for AWS Batch builds an actual `aws batch submit-job`. When
 * the CLI is missing or the credential is wrong the command says so, and the target records
 * that as its readiness — which is the honest answer, and the one a reader can act on.
 *
 * Secrets never appear in a target's record. A field is either configuration (a host, a
 * region, a queue) or a credential (a key), the two lists are separate, and only the second
 * goes to the credential vault.
 */

import type { TargetKind } from '@/store/compute';

/** One thing a target needs to know, asked for on the create page. */
export interface ConfigField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'path';
  placeholder?: string;
  hint?: string;
  required?: boolean;
  default?: string;
}

/** One credential, named by the environment variable the CLI reads. */
export interface SecretField {
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
}

/** What a kind of machine can do. */
export interface TargetAdapter {
  kind: TargetKind;
  label: string;
  /** One line: what this kind of target is. */
  summary: string;
  /** The binaries a probe needs. A check without them fails, and says which is missing. */
  requires: string[];
  config: ConfigField[];
  secrets: SecretField[];
  /** Config values that are also exported to the CLI, as `ENV_VAR: configKey`. */
  envFromConfig?: Record<string, string>;
  /** The check: a command whose exit code answers "can this take a job now". */
  probe(config: Record<string, string>): string;
  /** How a job's command reaches this machine. */
  submit(config: Record<string, string>, command: string, jobId: string): string;
  /** What a successful check means, in the reader's words. */
  readyNote: string;
}

/* ================================================================================================
 * Shell quoting
 * ============================================================================================== */

/** One shell word, quoted so a value with spaces or quotes survives. */
export function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A config value, or its default, or an empty string. */
function value(config: Record<string, string>, key: string, fallback = ''): string {
  const given = config[key];
  return given !== undefined && given !== '' ? given : fallback;
}

/** The `user@host` an SSH command addresses. */
function destination(config: Record<string, string>): string {
  const user = value(config, 'user');
  return user ? `${user}@${value(config, 'host')}` : value(config, 'host');
}

/** The SSH options every remote command carries: no prompts, a short timeout, a key if given. */
function sshOptions(config: Record<string, string>): string {
  const port = value(config, 'port', '22');
  const identity = value(config, 'identity');
  return [
    '-o BatchMode=yes',
    '-o StrictHostKeyChecking=accept-new',
    '-o ConnectTimeout=8',
    `-p ${quote(port)}`,
    identity ? `-i ${quote(identity)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** A remote shell line: `cd workdir && command`, as one quoted argument. */
function remoteLine(config: Record<string, string>, command: string): string {
  const workdir = value(config, 'workdir', '~');
  return quote(`cd ${quote(workdir)} && sh -lc ${quote(command)}`);
}

/* ================================================================================================
 * The adapters
 * ============================================================================================== */

const LOCAL: TargetAdapter = {
  kind: 'local',
  label: 'This machine',
  summary: 'Runs in the workspace, on this laptop. Nothing to install, nothing to reach.',
  requires: [],
  config: [
    {
      key: 'workdir',
      label: 'Working directory',
      kind: 'path',
      default: '.',
      hint: 'Relative to the workspace root.',
    },
  ],
  secrets: [],
  probe: (config) => `cd ${quote(value(config, 'workdir', '.'))} && pwd && uname -sr`,
  submit: (config, command) => `cd ${quote(value(config, 'workdir', '.'))} && sh -lc ${quote(command)}`,
  readyNote: 'This machine answered.',
};

const SSH: TargetAdapter = {
  kind: 'ssh',
  label: 'SSH host',
  summary: 'A machine you already have an account on, reached with the ssh client.',
  requires: ['ssh'],
  config: [
    { key: 'host', label: 'Host', kind: 'text', required: true, placeholder: 'gpu01.lab.example.edu' },
    { key: 'user', label: 'User', kind: 'text', placeholder: 'ada' },
    { key: 'port', label: 'Port', kind: 'number', default: '22' },
    {
      key: 'identity',
      label: 'Private key',
      kind: 'path',
      hint: 'Optional. Leave empty to use your ssh agent and config.',
    },
    { key: 'workdir', label: 'Working directory', kind: 'path', default: '~' },
  ],
  secrets: [],
  probe: (config) =>
    `ssh ${sshOptions(config)} ${quote(destination(config))} ${quote('echo ok && uname -sr')}`,
  submit: (config, command) =>
    `ssh ${sshOptions(config)} ${quote(destination(config))} ${remoteLine(config, command)}`,
  readyNote: 'The remote shell answered.',
};

const SLURM: TargetAdapter = {
  kind: 'slurm',
  label: 'SLURM cluster',
  summary: 'A login node whose scheduler takes the job. The check asks the scheduler, not the shell.',
  requires: ['ssh'],
  config: [
    { key: 'host', label: 'Login node', kind: 'text', required: true, placeholder: 'login.hpc.example.edu' },
    { key: 'user', label: 'User', kind: 'text', placeholder: 'ada' },
    { key: 'port', label: 'Port', kind: 'number', default: '22' },
    { key: 'partition', label: 'Partition', kind: 'text', placeholder: 'gpu' },
    { key: 'account', label: 'Account', kind: 'text', hint: 'The project the core-hours are charged to.' },
    { key: 'time', label: 'Time limit', kind: 'text', default: '04:00:00' },
    { key: 'workdir', label: 'Working directory', kind: 'path', default: '~' },
  ],
  secrets: [],
  probe: (config) =>
    `ssh ${sshOptions(config)} ${quote(destination(config))} ${quote('sinfo -h -o "%P %a" | head -5')}`,
  submit: (config, command) =>
    `ssh ${sshOptions(config)} ${quote(destination(config))} ${quote(
      [
        `cd ${quote(value(config, 'workdir', '~'))}`,
        'sbatch --parsable',
        value(config, 'partition') ? `--partition=${quote(value(config, 'partition'))}` : '',
        value(config, 'account') ? `--account=${quote(value(config, 'account'))}` : '',
        `--time=${quote(value(config, 'time', '04:00:00'))}`,
        `--wrap=${quote(command)}`,
      ]
        .filter(Boolean)
        .join(' '),
    )}`,
  readyNote: 'The scheduler answered.',
};

const HPC: TargetAdapter = {
  kind: 'hpc',
  label: 'HPC login node',
  summary: 'A cluster you run on directly from its login node, through a launcher.',
  requires: ['ssh'],
  config: [
    { key: 'host', label: 'Login node', kind: 'text', required: true, placeholder: 'login.hpc.example.edu' },
    { key: 'user', label: 'User', kind: 'text', placeholder: 'ada' },
    { key: 'port', label: 'Port', kind: 'number', default: '22' },
    {
      key: 'launcher',
      label: 'Launcher',
      kind: 'text',
      default: 'sh -lc',
      hint: 'How a command starts, e.g. `srun --ntasks=8`.',
    },
    { key: 'workdir', label: 'Working directory', kind: 'path', default: '~' },
  ],
  secrets: [],
  probe: (config) => `ssh ${sshOptions(config)} ${quote(destination(config))} ${quote('hostname && nproc')}`,
  submit: (config, command) =>
    `ssh ${sshOptions(config)} ${quote(destination(config))} ${quote(
      `cd ${quote(value(config, 'workdir', '~'))} && ${value(config, 'launcher', 'sh -lc')} ${quote(command)}`,
    )}`,
  readyNote: 'The login node answered.',
};

const MODAL: TargetAdapter = {
  kind: 'modal',
  label: 'Modal',
  summary: 'Serverless containers through the modal CLI. The entrypoint receives the job’s command.',
  requires: ['modal'],
  config: [
    {
      key: 'entrypoint',
      label: 'Entrypoint',
      kind: 'path',
      required: true,
      placeholder: 'jobs/train.py',
      hint: 'The Modal app file, relative to the workspace.',
    },
    {
      key: 'extra',
      label: 'Extra arguments',
      kind: 'text',
      hint: 'Passed to `modal run` before the job’s command, e.g. `--detach`.',
    },
  ],
  secrets: [
    {
      key: 'MODAL_TOKEN_ID',
      label: 'Token id',
      required: true,
      hint: 'modal token new, or the dashboard’s API tokens.',
    },
    { key: 'MODAL_TOKEN_SECRET', label: 'Token secret', required: true },
  ],
  probe: () => 'modal --version',
  submit: (config, command) =>
    ['modal run', value(config, 'extra'), quote(value(config, 'entrypoint')), '--', quote(command)]
      .filter(Boolean)
      .join(' '),
  readyNote: 'The modal CLI answered. Credentials are checked on the first run.',
};

const KAGGLE: TargetAdapter = {
  kind: 'kaggle',
  label: 'Kaggle',
  summary:
    'A Kaggle kernel pushed with the kaggle CLI. Accelerator and internet live in the kernel’s own metadata.',
  requires: ['kaggle'],
  config: [
    {
      key: 'folder',
      label: 'Kernel folder',
      kind: 'path',
      required: true,
      placeholder: 'jobs/kernel',
      hint: 'A directory holding kernel-metadata.json and the script.',
    },
    { key: 'username', label: 'Kaggle username', kind: 'text', required: true, placeholder: 'ada' },
  ],
  secrets: [{ key: 'KAGGLE_KEY', label: 'API key', required: true, hint: 'Account → Create New API Token.' }],
  envFromConfig: { KAGGLE_USERNAME: 'username' },
  // One authenticated call: a wrong key fails here rather than on the first real job.
  probe: () => 'kaggle competitions list --page-size 1',
  submit: (config) => `kaggle kernels push -p ${quote(value(config, 'folder'))}`,
  readyNote: 'The API accepted the credentials.',
};

const AWS: TargetAdapter = {
  kind: 'aws',
  label: 'AWS Batch',
  summary: 'A Batch queue in one region. The job’s command becomes the container command override.',
  requires: ['aws'],
  config: [
    { key: 'region', label: 'Region', kind: 'text', required: true, default: 'us-east-1' },
    { key: 'queue', label: 'Job queue', kind: 'text', required: true, placeholder: 'gpu-queue' },
    {
      key: 'definition',
      label: 'Job definition',
      kind: 'text',
      required: true,
      placeholder: 'openlab-gpu:3',
    },
    { key: 'profile', label: 'Profile', kind: 'text', hint: 'Optional named profile from ~/.aws/config.' },
    {
      key: 'bucket',
      label: 'S3 bucket',
      kind: 'text',
      hint: 'Where results are written back, when the job writes them.',
    },
  ],
  secrets: [
    { key: 'AWS_ACCESS_KEY_ID', label: 'Access key id', required: true },
    { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret access key', required: true },
    { key: 'AWS_SESSION_TOKEN', label: 'Session token', hint: 'Only for temporary credentials.' },
  ],
  probe: (config) =>
    `aws sts get-caller-identity --output text --query Account --region ${quote(value(config, 'region', 'us-east-1'))}${
      value(config, 'profile') ? ` --profile ${quote(value(config, 'profile'))}` : ''
    }`,
  submit: (config, command, jobId) =>
    [
      'aws batch submit-job',
      `--job-name ${quote(`openlab-${jobId}`)}`,
      `--job-queue ${quote(value(config, 'queue'))}`,
      `--job-definition ${quote(value(config, 'definition'))}`,
      `--region ${quote(value(config, 'region', 'us-east-1'))}`,
      value(config, 'profile') ? `--profile ${quote(value(config, 'profile'))}` : '',
      `--container-overrides ${quote(JSON.stringify({ command: ['sh', '-lc', command] }))}`,
    ]
      .filter(Boolean)
      .join(' '),
  readyNote: 'AWS answered with the account the credentials belong to.',
};

const GCP: TargetAdapter = {
  kind: 'gcp',
  label: 'Google Cloud',
  summary: 'A Compute Engine instance run through the gcloud CLI. The job’s command runs on it over SSH.',
  requires: ['gcloud'],
  config: [
    { key: 'instance', label: 'Instance', kind: 'text', required: true, placeholder: 'gpu-vm-1' },
    { key: 'zone', label: 'Zone', kind: 'text', required: true, placeholder: 'europe-west4-a' },
    { key: 'project', label: 'Project', kind: 'text', hint: 'Defaults to the active gcloud project.' },
    { key: 'bucket', label: 'Bucket', kind: 'text', hint: 'Where results are written back.' },
  ],
  secrets: [],
  probe: (config) =>
    `gcloud auth list --filter=status:ACTIVE --format="value(account)"${value(config, 'project') ? ` --project ${quote(value(config, 'project'))}` : ''}`,
  submit: (config, command) =>
    [
      'gcloud compute ssh',
      quote(value(config, 'instance')),
      `--zone ${quote(value(config, 'zone'))}`,
      value(config, 'project') ? `--project ${quote(value(config, 'project'))}` : '',
      `--command ${quote(command)}`,
    ]
      .filter(Boolean)
      .join(' '),
  readyNote: 'gcloud has an active account.',
};

const AZURE: TargetAdapter = {
  kind: 'azure',
  label: 'Azure',
  summary: 'A virtual machine run through the az CLI, using the run-command extension.',
  requires: ['az'],
  config: [
    {
      key: 'resourceGroup',
      label: 'Resource group',
      kind: 'text',
      required: true,
      placeholder: 'openlab-rg',
    },
    { key: 'vm', label: 'Virtual machine', kind: 'text', required: true, placeholder: 'gpu-vm-1' },
    {
      key: 'subscription',
      label: 'Subscription',
      kind: 'text',
      hint: 'Defaults to the active az subscription.',
    },
  ],
  secrets: [],
  probe: (config) =>
    `az account show --query name -o tsv${value(config, 'subscription') ? ` --subscription ${quote(value(config, 'subscription'))}` : ''}`,
  submit: (config, command) =>
    [
      'az vm run-command invoke',
      `-g ${quote(value(config, 'resourceGroup'))}`,
      `-n ${quote(value(config, 'vm'))}`,
      '--command-id RunShellScript',
      `--scripts ${quote(command)}`,
      value(config, 'subscription') ? `--subscription ${quote(value(config, 'subscription'))}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  readyNote: 'The az CLI has an active account.',
};

/** Every adapter, by kind. */
export const ADAPTERS: Record<TargetKind, TargetAdapter> = {
  local: LOCAL,
  ssh: SSH,
  slurm: SLURM,
  hpc: HPC,
  modal: MODAL,
  kaggle: KAGGLE,
  aws: AWS,
  gcp: GCP,
  azure: AZURE,
};

/** The adapters in the order the create page offers them: cheapest to reach first. */
export const ADAPTER_ORDER: TargetKind[] = [
  'local',
  'ssh',
  'slurm',
  'hpc',
  'modal',
  'kaggle',
  'aws',
  'gcp',
  'azure',
];

/** The adapter for a kind. */
export function adapterFor(kind: TargetKind): TargetAdapter {
  return ADAPTERS[kind];
}

/** The config value a target's host line comes from, per kind. */
const HOST_KEYS: Record<TargetKind, string[]> = {
  local: ['workdir'],
  ssh: ['host'],
  slurm: ['host'],
  hpc: ['host'],
  modal: ['entrypoint'],
  kaggle: ['folder'],
  aws: ['queue'],
  gcp: ['instance'],
  azure: ['vm'],
};

/** How a target's host reads in a list: the hostname, folder or instance it names. */
export function hostOf(kind: TargetKind, config: Record<string, string>): string {
  for (const key of HOST_KEYS[kind]) {
    const given = config[key];
    if (given) return given;
  }
  return ADAPTERS[kind].label;
}

/** The configuration a new target of this kind starts from, defaults filled in. */
export function defaultConfig(kind: TargetKind): Record<string, string> {
  const config: Record<string, string> = {};
  for (const field of ADAPTERS[kind].config) {
    if (field.default) config[field.key] = field.default;
  }
  return config;
}

/** What a configuration is still missing. */
export interface ConfigProblem {
  key: string;
  label: string;
}

/** The required fields a configuration does not fill. Empty means it is complete. */
export function missingConfig(kind: TargetKind, config: Record<string, string>): ConfigProblem[] {
  return ADAPTERS[kind].config
    .filter((field) => field.required && !config[field.key]?.trim())
    .map((field) => ({ key: field.key, label: field.label }));
}

/** The required credentials a target has not been given. */
export function missingSecrets(kind: TargetKind, present: readonly string[]): ConfigProblem[] {
  return ADAPTERS[kind].secrets
    .filter((field) => field.required && !present.includes(field.key))
    .map((field) => ({ key: field.key, label: field.label }));
}

/** The environment a probe or a submit runs with: credentials, plus the config that is one. */
export function environmentFor(
  kind: TargetKind,
  config: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  const adapter = ADAPTERS[kind];
  const env: Record<string, string> = {};
  for (const field of adapter.secrets) {
    const given = secrets[field.key];
    if (given !== undefined && given !== '') env[field.key] = given;
  }
  for (const [name, key] of Object.entries(adapter.envFromConfig ?? {})) {
    const given = config[key];
    if (given !== undefined && given.trim() !== '') env[name] = given;
  }
  return env;
}

/** The check command for a target. */
export function probeCommand(kind: TargetKind, config: Record<string, string>): string {
  return ADAPTERS[kind].probe(config);
}

/** How a job's command reaches the machine. */
export function submitCommand(
  kind: TargetKind,
  config: Record<string, string>,
  command: string,
  jobId: string,
): string {
  return ADAPTERS[kind].submit(config, command, jobId);
}
