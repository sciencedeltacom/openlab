import { Flags } from '@oclif/core';

import { relativeTime } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { shortPath } from '../../lib/paths';

export default class WorkspaceProjects extends LabCommand {
  static description = 'List the labs the workbench knows about';

  static flags = {
    add: Flags.string({ description: 'Register a folder as a lab without scaffolding it' }),
    name: Flags.string({ description: 'The name to register it under' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkspaceProjects);

    if (flags.add) {
      const lab = await this.lab({ root: flags.add, name: flags.name });
      await lab.save();
      this.emit(
        { project: lab.project, root: lab.root },
        () =>
          `${out.mark.ok} ${out.c.bold(lab.project?.name ?? '')} ${out.c.grey(shortPath(lab.root as string))}`,
      );
      return;
    }

    const lab = await this.lab({ root: null });
    const rows = [...lab.state.projects]
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        sessions: project.workspace.sessions.length,
        tasks: project.workspace.tasks.length,
        opened: relativeTime(project.lastOpenedAt),
        active: project.id === lab.state.activeProjectId ? 'open' : '',
      }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'lab', truncate: true, width: 28 },
        { key: 'path', label: 'folder', truncate: true, width: 40 },
        { key: 'sessions', label: 'sessions', align: 'right' },
        { key: 'tasks', label: 'tasks', align: 'right' },
        { key: 'opened', label: 'last opened' },
        { key: 'active', label: '' },
      ],
      'No labs yet. `openlab init <dir>` makes one.',
    );
  }
}
