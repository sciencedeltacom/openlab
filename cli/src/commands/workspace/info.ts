import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { shortPath } from '../../lib/paths';
import { readLabConfig, structure } from '../../lib/workspace';

export default class WorkspaceInfo extends LabCommand {
  static description = 'Show the lab folder’s manifest and what it holds';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const root = lab.root as string;
    const config = readLabConfig(root);
    const entries = structure(root);
    const missing = entries.filter((entry) => !entry.present);

    this.emit({ root, manifest: config, structure: entries }, () => {
      if (!config) {
        return [
          `${out.mark.warn} ${out.c.bold(shortPath(root))} has no .labconfig`,
          out.note('It is still a lab, because the folder was opened, but nothing records what it is.'),
          '',
          out.note('`openlab workspace config --set name=…` writes one.'),
        ].join('\n');
      }
      return [
        out.keyValues([
          ['lab', `${out.c.bold(config.name)} ${out.c.grey(shortPath(root))}`],
          ['icon', config.icon],
          ['created', config.createdAt],
          ['version', String(config.version)],
          ['model', config.settings.defaultModel || out.c.grey('unset')],
        ]),
        '',
        out.heading('Protocols'),
        config.protocols.length > 0
          ? out.bullets(config.protocols.map((protocol) => `${protocol.name} ${out.c.grey(protocol.note)}`))
          : out.note('  none'),
        '',
        out.heading('Methods'),
        config.methods.length > 0 ? out.bullets(config.methods) : out.note('  none'),
        '',
        out.heading('Structure'),
        out.bullets(
          entries.map(
            (entry) =>
              `${entry.present ? out.mark.ok : out.mark.warn} ${entry.dir.padEnd(10)} ${out.c.grey(entry.description)}`,
          ),
        ),
        ...(missing.length > 0
          ? [
              '',
              out.note(
                `${missing.length} entries are missing. \`openlab init\` writes them without touching what is there.`,
              ),
            ]
          : []),
      ].join('\n');
    });
  }
}
