/**
 * Saved views.
 *
 * A view is a filter plus a layout, which is why `--new` takes the same filter flags the task
 * list does: a view is what you get when you save a list. The stored filter is the app's own
 * `TaskFilter`, so applying a view in the app narrows the tracker to exactly what was saved.
 */

import { Flags } from '@oclif/core';

import {
  TASK_KINDS,
  WORK_STATUSES,
  newView,
  type Label,
  type Member,
  type SavedView,
  type TaskFilter,
  type TaskKind,
  type Wave,
  type WorkStatus,
} from '@/store/research';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** A value that names a wave: an id, `W3`, `3`, or its name. */
function waveNamed(waves: readonly Wave[], ref: string): Wave | undefined {
  const number = Number(ref.replace(/^w/i, ''));
  const name = ref.toLowerCase();
  return waves.find(
    (wave) =>
      wave.id === ref ||
      wave.name.toLowerCase() === name ||
      (Number.isFinite(number) && wave.number === number),
  );
}

/** A value that names a member: an id, a name, initials, or a first name. */
function memberNamed(members: readonly Member[], ref: string): Member | undefined {
  const name = ref.toLowerCase();
  return members.find(
    (member) =>
      member.id === ref ||
      member.name.toLowerCase() === name ||
      member.initials.toLowerCase() === name ||
      member.name.toLowerCase().split(/\s+/)[0] === name,
  );
}

/** A value that names a label: an id or a name. */
function labelNamed(labels: readonly Label[], ref: string): Label | undefined {
  const name = ref.toLowerCase();
  return labels.find((label) => label.id === ref || label.name.toLowerCase() === name);
}

/** The sentence the views screen shows under a view's name. */
function describeFilter(filter: TaskFilter): string {
  const parts: string[] = [];
  if (filter.status?.length) parts.push(`status ${filter.status.join(' or ')}`);
  if (filter.kind?.length) parts.push(`kind ${filter.kind.join(' or ')}`);
  if (filter.priority?.length) parts.push(`priority ${filter.priority.join(' or ')}`);
  if (filter.assigneeId?.length) parts.push('assigned to one person');
  if (filter.waveId?.length) parts.push('in one wave');
  if (filter.label?.length) parts.push('carrying a label');
  if (filter.text) parts.push(`matching “${filter.text}”`);
  if (filter.overdue) parts.push('past its due date');
  return parts.length ? `Shows tasks ${parts.join(', ')}.` : 'Shows everything.';
}

export default class ResearchViews extends LabCommand {
  static description = 'List the saved views, or save a new one from the filter flags';

  static flags = {
    new: Flags.boolean({ description: 'Save a new view instead of listing them' }),
    name: Flags.string({ char: 'n', description: 'The view’s name (with --new)' }),
    layout: Flags.string({
      description: 'The layout it opens in',
      options: ['list', 'board', 'timeline'],
      default: 'list',
    }),
    status: Flags.string({
      description: 'Filter: one or more statuses',
      options: [...WORK_STATUSES],
      multiple: true,
    }),
    kind: Flags.string({
      description: 'Filter: one or more kinds',
      options: [...TASK_KINDS],
      multiple: true,
    }),
    priority: Flags.string({
      description: 'Filter: one or more priorities',
      options: ['0', '1', '2', '3', '4'],
      multiple: true,
    }),
    assignee: Flags.string({ description: 'Filter: one owner (id, name or initials)' }),
    wave: Flags.string({ description: 'Filter: one wave (id, W3, 3 or name)' }),
    label: Flags.string({ description: 'Filter: one or more labels (id or name)', multiple: true }),
    search: Flags.string({ description: 'Filter: text over title and key' }),
    overdue: Flags.boolean({ description: 'Filter: only what is overdue' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ResearchViews);
    const lab = await this.requireLab();
    const state = lab.state;

    if (flags.new) {
      if (!flags.name) this.fail('A view needs a --name.');

      const filter: TaskFilter = {};
      if (flags.status?.length) filter.status = flags.status as WorkStatus[];
      if (flags.kind?.length) filter.kind = flags.kind as TaskKind[];
      if (flags.priority?.length) filter.priority = flags.priority.map(Number);
      if (flags.assignee) {
        const member = memberNamed(state.members, flags.assignee);
        if (!member) this.fail(`No member matches “${flags.assignee}”.`);
        filter.assigneeId = [member.id];
      }
      if (flags.wave) {
        const wave = waveNamed(state.waves, flags.wave);
        if (!wave) this.fail(`No wave matches “${flags.wave}”.`);
        filter.waveId = [wave.id];
      }
      if (flags.label?.length) {
        filter.label = flags.label.map((ref) => {
          const label = labelNamed(state.labels, ref);
          if (!label) this.fail(`No label matches “${ref}”.`);
          return label.id;
        });
      }
      if (flags.search) filter.text = flags.search;
      if (flags.overdue) filter.overdue = true;

      const view = newView(filter, flags.layout as SavedView['layout'], flags.name);
      // The store's own `view/create` puts the newest first.
      state.views = [view, ...state.views];
      await lab.save();
      this.emit(view, (created) =>
        [
          `${out.mark.ok} Saved view ${out.c.bold(created.name)}`,
          out.keyValues([
            ['layout', created.layout],
            ['filter', describeFilter(created.filters)],
          ]),
        ].join('\n'),
      );
      return;
    }

    this.list(
      state.views,
      [
        { key: 'name', label: 'name', truncate: true, width: 28 },
        { key: 'layout', label: 'layout' },
        {
          key: 'filters',
          label: 'filter',
          truncate: true,
          width: 56,
          format: (view) => describeFilter(view.filters),
        },
        {
          key: 'starred',
          label: 'starred',
          format: (view) => (view.starred ? out.mark.ok : out.c.grey('—')),
        },
        {
          key: 'ownerId',
          label: 'owner',
          format: (view) =>
            view.ownerId
              ? (state.members.find((member) => member.id === view.ownerId)?.name ?? view.ownerId)
              : out.c.grey('the lab'),
        },
      ],
      'No saved views yet. `openlab research views --new --name "…" --status blocked` saves one.',
    );
  }
}
