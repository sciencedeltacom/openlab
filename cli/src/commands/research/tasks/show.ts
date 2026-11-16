/**
 * One task, in full.
 *
 * The task's page without the page: its description and the fields a person edits, then the
 * subtasks, comments, evidence and relations the detail view lists — and the plan file the
 * task is written into, because the file is where a reader outside the app meets it.
 */

import { Args } from '@oclif/core';

import { PLAN_BACKLOG, wavePath } from '@/lib/plan/format';
import { relativeTime } from '@/lib/format';
import { KIND_META, PRIORITY_META, STATUS_META, labelsOf, memberById, type Task } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The task a value names: its id or its key, however it is cased. */
export function taskNamed(tasks: readonly Task[], ref: string): Task | undefined {
  const key = ref.toLowerCase();
  return tasks.find((task) => task.id === ref || task.key.toLowerCase() === key);
}

export default class TaskShow extends LabCommand {
  static description = 'Show one task: its fields, its record and the plan file it lives in';

  static args = {
    task: Args.string({ description: 'The task’s id or key, e.g. TASK-14', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TaskShow);
    const lab = await this.requireLab();
    const { tasks, waves, members, labels } = lab.state;

    const task = taskNamed(tasks, args.task);
    if (!task) this.fail(`No task matches “${args.task}”.`);

    const wave = waves.find((candidate) => candidate.id === task.waveId) ?? null;
    const assignee = memberById(members, task.assigneeId) ?? null;
    const taskLabels = labelsOf(labels, task);
    const planFile = wave ? wavePath(wave) : PLAN_BACKLOG;
    const relations = task.relations.map((relation) => ({
      type: relation.type,
      id: relation.id,
      task: tasks.find((candidate) => candidate.id === relation.id) ?? null,
    }));
    const comments = task.comments.map((comment) => ({
      ...comment,
      author: memberById(members, comment.authorId)?.name ?? comment.authorId,
    }));

    const value = {
      id: task.id,
      key: task.key,
      title: task.title,
      description: task.description,
      kind: task.kind,
      status: task.status,
      priority: task.priority,
      wave: wave ? { id: wave.id, number: wave.number, name: wave.name } : null,
      assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
      labels: taskLabels.map((label) => ({ id: label.id, name: label.name, group: label.group })),
      estimate: task.estimate,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      subtasks: task.subtasks,
      comments,
      evidence: task.evidence,
      relations: relations.map((relation) => ({
        type: relation.type,
        id: relation.id,
        key: relation.task?.key ?? null,
        title: relation.task?.title ?? null,
      })),
      planFile,
    };

    this.emit(value, (shown) => {
      const lines = [
        `${out.c.bold(`${shown.key} · ${shown.title}`)}`,
        out.keyValues([
          ['id', shown.id],
          [
            'status',
            `${STATUS_META[shown.status].label}${shown.status === 'blocked' ? ` ${out.c.red('blocked')}` : ''}`,
          ],
          ['priority', `${PRIORITY_META[shown.priority]?.label ?? '—'}`],
          ['kind', KIND_META[shown.kind].label],
          ['wave', shown.wave ? `W${shown.wave.number} · ${shown.wave.name}` : out.c.grey('none')],
          ['assignee', shown.assignee ? shown.assignee.name : out.c.grey('unassigned')],
          ['labels', shown.labels.map((label) => label.name).join(', ') || out.c.grey('none')],
          ['due', shown.dueDate ?? out.c.grey('none')],
          ['updated', relativeTime(shown.updatedAt)],
          ['plan file', shown.planFile],
        ]),
      ];
      if (shown.description) {
        lines.push('', out.heading('Description'), shown.description);
      }
      if (shown.subtasks.length > 0) {
        lines.push(
          '',
          out.heading(
            `Subtasks ${shown.subtasks.filter((subtask) => subtask.done).length}/${shown.subtasks.length}`,
          ),
          out.bullets(
            shown.subtasks.map((subtask) => `${subtask.done ? out.mark.ok : out.mark.skip} ${subtask.title}`),
          ),
        );
      }
      if (shown.comments.length > 0) {
        lines.push(
          '',
          out.heading('Comments'),
          out.bullets(
            shown.comments.map(
              (comment) =>
                `${out.c.grey(comment.author)} ${out.c.grey(relativeTime(comment.createdAt))}: ${comment.body}`,
            ),
          ),
        );
      }
      if (shown.evidence.length > 0) {
        lines.push(
          '',
          out.heading('Evidence'),
          out.bullets(
            shown.evidence.map(
              (item) =>
                `${item.verified ? out.mark.ok : out.mark.warn} ${item.kind} · ${item.title} · ${out.c.grey(item.ref)}`,
            ),
          ),
        );
      }
      if (shown.relations.length > 0) {
        lines.push(
          '',
          out.heading('Relations'),
          out.bullets(
            shown.relations.map(
              (relation) =>
                `${relation.type} ${relation.key ?? relation.id}${relation.title ? ` ${out.c.grey(relation.title)}` : ''}`,
            ),
          ),
        );
      }
      return lines.join('\n');
    });
  }
}
