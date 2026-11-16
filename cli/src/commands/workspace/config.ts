/**
 * The manifest, edited from the terminal.
 *
 * `.labconfig` is YAML on purpose — it is read, not owned — and the app's writer is the one
 * used here, so a change made in the CLI is a change the app reads back. Protocols and methods
 * are the two lists worth editing from a shell; the rest is one key at a time.
 */

import { Flags } from '@oclif/core';

import { PROTOCOL_PRESETS, type LabConfig } from '@/lib/workspace-config';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { defaultLabConfig, readLabConfig, writeLabConfig } from '../../lib/workspace';

export default class WorkspaceConfig extends LabCommand {
  static description = 'Read or edit the lab manifest (.labconfig)';

  static flags = {
    set: Flags.string({
      description: 'Set a key: name, icon, model',
      multiple: true,
    }),
    'add-protocol': Flags.string({
      description: 'Add a protocol by id',
      multiple: true,
      options: PROTOCOL_PRESETS.map((p) => p.id),
    }),
    'rm-protocol': Flags.string({ description: 'Remove a protocol by id', multiple: true }),
    'add-method': Flags.string({ description: 'Add a method line', multiple: true }),
    'rm-method': Flags.string({ description: 'Remove a method line', multiple: true }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkspaceConfig);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const existing = readLabConfig(root);
    const name = existing?.name ?? lab.project?.name ?? 'lab';
    let config: LabConfig = existing ?? defaultLabConfig(name);
    const changes: string[] = [];

    if (!existing) {
      changes.push('created .labconfig');
    }

    for (const entry of flags.set ?? []) {
      const [key, ...rest] = entry.split('=');
      const value = rest.join('=').trim();
      switch (key?.trim()) {
        case 'name':
          config = { ...config, name: value };
          break;
        case 'icon':
          config = { ...config, icon: value };
          break;
        case 'model':
          config = { ...config, settings: { ...config.settings, defaultModel: value } };
          break;
        default:
          this.fail(`Cannot set “${key}”. The keys are name, icon, model.`);
      }
      changes.push(`${key} = ${value}`);
    }

    for (const id of flags['add-protocol'] ?? []) {
      const preset = PROTOCOL_PRESETS.find((protocol) => protocol.id === id);
      if (!preset) {
        this.fail(`No protocol “${id}”.`);
      }
      if (!config.protocols.some((protocol) => protocol.id === id)) {
        config = { ...config, protocols: [...config.protocols, { ...preset }] };
        changes.push(`+ protocol ${id}`);
      }
    }
    for (const id of flags['rm-protocol'] ?? []) {
      config = { ...config, protocols: config.protocols.filter((protocol) => protocol.id !== id) };
      changes.push(`- protocol ${id}`);
    }
    for (const method of flags['add-method'] ?? []) {
      config = { ...config, methods: [...config.methods, method] };
      changes.push(`+ method ${method}`);
    }
    for (const method of flags['rm-method'] ?? []) {
      config = { ...config, methods: config.methods.filter((entry) => entry !== method) };
      changes.push(`- method ${method}`);
    }

    if (changes.length > 0) {
      writeLabConfig(root, config);
    }

    this.emit({ manifest: config, changes }, (value) =>
      value.changes.length === 0
        ? out.keyValues([
            ['name', config.name],
            ['icon', config.icon],
            ['protocols', config.protocols.map((protocol) => protocol.id).join(', ') || '—'],
            ['methods', config.methods.join('; ') || '—'],
            ['model', config.settings.defaultModel || '—'],
          ])
        : [
            `${out.mark.ok} ${value.changes.length} change${value.changes.length === 1 ? '' : 's'} to .labconfig`,
            out.bullets(value.changes),
          ].join('\n'),
    );
  }
}
