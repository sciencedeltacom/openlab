/**
 * The workspace manifest — `.labconfig`.
 *
 * Every workspace openlab creates gets one: the project's own record of its name, the
 * protocols it works under, the methods it starts with, its settings and the cloud stores it
 * is linked to. It is YAML on purpose so a person can read and edit it, and so the agent can
 * be pointed at it later. The writer is deliberately small — the shape is fixed and ours, so
 * a full YAML library would be more surface than the file needs.
 */

import { invokeCommand } from '@/lib/ipc';

/** One protocol a workspace works under. */
export interface LabProtocol {
  id: string;
  name: string;
  note: string;
}

/** The manifest, as written to `.labconfig`. */
export interface LabConfig {
  version: number;
  name: string;
  icon: string;
  createdAt: string;
  protocols: LabProtocol[];
  methods: string[];
  settings: {
    /** Whether the standard project structure was laid out. */
    structure: boolean;
    /** Whether a starter OpenWiki was written. */
    wiki: boolean;
    defaultModel: string;
  };
}

/** Protocols a lab can start from. A workspace can edit its own copy afterwards. */
export const PROTOCOL_PRESETS: readonly LabProtocol[] = [
  { id: 'data-integrity', name: 'Data integrity', note: 'Original inputs are never edited in place.' },
  {
    id: 'reproducibility',
    name: 'Reproducibility',
    note: 'Every result names the code and inputs that produced it.',
  },
  { id: 'version-control', name: 'Version control', note: 'The workspace is tracked with Git.' },
  { id: 'data-retention', name: 'Data retention', note: 'Raw data is kept for the agreed retention window.' },
  { id: 'ethics', name: 'Ethics & consent', note: 'Human or animal data follows the approved protocol.' },
  { id: 'safety', name: 'Lab safety', note: 'Wet-lab steps follow the safety sheet.' },
];

/** The manifest path, relative to the workspace root. */
export const LAB_CONFIG_PATH = '.labconfig';

/** A YAML plain scalar is only safe unquoted when it cannot be read as another type. */
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

function scalar(value: string | number | boolean): string {
  if (typeof value !== 'string') {
    return String(value);
  }
  if (value === '') {
    return '""';
  }
  if (/^[A-Za-z0-9][A-Za-z0-9 _./@+-]*$/.test(value) && !RESERVED.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

/** Serialise a manifest to YAML. */
export function labConfigYaml(config: LabConfig): string {
  const lines: string[] = [
    '# openlab workspace manifest. Edit it freely. It is read, not overwritten.',
    `version: ${config.version}`,
    `name: ${scalar(config.name)}`,
    `icon: ${scalar(config.icon)}`,
    `created: ${scalar(config.createdAt)}`,
    '',
  ];

  if (config.protocols.length === 0) {
    lines.push('protocols: []');
  } else {
    lines.push('protocols:');
    for (const protocol of config.protocols) {
      lines.push(`  - id: ${scalar(protocol.id)}`);
      lines.push(`    name: ${scalar(protocol.name)}`);
      lines.push(`    note: ${scalar(protocol.note)}`);
    }
  }
  lines.push('');

  if (config.methods.length === 0) {
    lines.push('methods: []');
  } else {
    lines.push('methods:');
    for (const method of config.methods) {
      lines.push(`  - ${scalar(method)}`);
    }
  }
  lines.push('');

  lines.push('settings:');
  lines.push(`  structure: ${config.settings.structure}`);
  lines.push(`  wiki: ${config.settings.wiki}`);
  lines.push(`  defaultModel: ${scalar(config.settings.defaultModel)}`);
  lines.push('');

  return lines.join('\n');
}

/** Write the manifest into a workspace, throwing when the write fails. */
export async function writeLabConfig(root: string, config: LabConfig): Promise<void> {
  const result = await invokeCommand('write_file', {
    path: LAB_CONFIG_PATH,
    contents: labConfigYaml(config),
    root,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
}
