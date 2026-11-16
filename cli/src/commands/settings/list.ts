/**
 * Every setting the workbench persists, and its value.
 *
 * The durable slice is app-level, not per workspace, so this opens the store alone. The keys are
 * the ones `saveState` writes, in the order the settings page reads them.
 */

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** The app-level settings, named so the reader and the writer cannot disagree about the set. */
export const SETTING_KEYS = [
  'modelRef',
  'theme',
  'mode',
  'reasoning',
  'navMode',
  'indexRoot',
  'route',
  'tabs',
  'taskLayout',
  'taskGroupBy',
  'taskSort',
  'enabledPacks',
  'installedPacks',
  'closedMcps',
  'providerBaseUrls',
] as const;

/** A value as one line a terminal reads. */
export function renderSetting(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return out.c.grey('—');
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : out.c.grey('—');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export default class SettingsList extends LabCommand {
  static description = 'Show every setting the workbench persists';

  async run(): Promise<void> {
    const lab = await this.lab();
    const values: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      values[key] = lab.state[key];
    }

    this.emit(values, (settings) =>
      out.keyValues(SETTING_KEYS.map((key): [string, string] => [key, renderSetting(settings[key])])),
    );
  }
}
