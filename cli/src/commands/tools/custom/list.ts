/**
 * The custom tools an extension contributes.
 *
 * An extension declares its tools in a manifest, and the workspace keeps its own under
 * `.openlab/extensions/`. The desktop app reads them from local storage and the folder; the
 * CLI has neither, so it reads the folder directly — a command that reported "none" while the
 * lab carried manifests would be lying about what the agent can reach.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXTENSION_DIR } from '@/lib/extensions/registry';
import { parseManifest } from '@/lib/extensions/protocol';

import { LabCommand } from '../../../lib/base';

export default class ToolsCustomList extends LabCommand {
  static description = 'List the custom tools the extensions in .openlab/extensions contribute';

  async run(): Promise<void> {
    await this.parse(ToolsCustomList);
    const lab = await this.requireLab();
    const rows: {
      id: string;
      extension: string;
      summary: string;
      transport: string;
    }[] = [];

    if (lab.root) {
      const folder = join(lab.root, EXTENSION_DIR);
      if (existsSync(folder)) {
        for (const file of readdirSync(folder)
          .filter((name) => name.endsWith('.json'))
          .sort()) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(readFileSync(join(folder, file), 'utf8'));
          } catch (error) {
            this.warn(`${file}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
            continue;
          }
          const result = parseManifest(parsed);
          if (!result.ok) {
            this.warn(`${file}: ${result.errors.join(' ')}`);
            continue;
          }
          for (const tool of result.manifest.tools ?? []) {
            rows.push({
              id: tool.id,
              extension: result.manifest.id,
              summary: tool.summary,
              transport: tool.transport.kind,
            });
          }
        }
      }
    }

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'extension', label: 'extension', truncate: true, width: 24 },
        { key: 'summary', label: 'summary', truncate: true, width: 44 },
        { key: 'transport', label: 'transport' },
      ],
      'No extension in this workspace contributes a tool.',
    );
  }
}
