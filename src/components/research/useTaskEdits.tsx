/**
 * Local editing for the tracker.
 *
 * The list, the board and the timeline all render the same task and offer the same
 * actions, so the edits and their dialogs live here once. Each layout holds its own copy
 * of this state: switching layout starts from the seed again, which is honest for a
 * static domain and keeps the three layouts independent.
 */

import { useState, type ReactNode } from 'react';
import {
  CalendarClock,
  CalendarRange,
  CircleDot,
  Copy,
  ExternalLink,
  Flag,
  Trash2,
  UserPlus,
} from 'lucide-react';

import { ChoiceModal, DateModal, type RowAction } from '@/components/common/RowMenu';
import { MemberPicker } from '@/components/common/MemberPicker';
import { Dialog } from '@/components/ui';
import { pathFor } from '@/app/routes';
import { useApp } from '@/store/app';
import {
  PRIORITY_META,
  STATUS_META,
  WORK_STATUSES,
  memberById,
  type Task,
  type WorkStatus,
} from '@/store/research';

type TaskEditKind = 'status' | 'priority' | 'assignee' | 'due' | 'wave';

const STATUS_OPTIONS = WORK_STATUSES.map((status) => ({ value: status, label: STATUS_META[status].label }));
const PRIORITY_OPTIONS = [4, 3, 2, 1, 0].map((priority) => ({
  value: String(priority),
  label: PRIORITY_META[priority].label,
}));

/** The edited task list plus its per-row menu and the dialogs the menu opens. */
export function useTaskEdits(): {
  tasks: Task[];
  actionsFor: (task: Task) => RowAction[];
  modals: ReactNode;
} {
  const { state, dispatch } = useApp();
  const tasks = state.tasks;
  const waveOptions = [
    { value: '', label: 'No wave' },
    ...state.waves.map((wave) => ({ value: wave.id, label: `W${wave.number} · ${wave.name}` })),
  ];
  const [edit, setEdit] = useState<{ kind: TaskEditKind; task: Task } | null>(null);

  // The tracker's edits go through the store, so they survive a reload and are shared by
  // every layout rather than living in whichever one is on screen.
  const patch = (id: string, changes: Partial<Task>, _message?: string) =>
    dispatch({ type: 'task/patch', id, patch: { ...changes, updatedAt: Date.now() } });
  const remove = (id: string, _title?: string) => dispatch({ type: 'task/remove', id });
  const add = (task: Task, _label?: string) => dispatch({ type: 'task/create', task });

  const actionsFor = (task: Task): RowAction[] => [
    {
      id: 'open',
      label: 'View details',
      icon: ExternalLink,
      onSelect: () =>
        dispatch({ type: 'route/go', route: pathFor('research/tasks/:taskId', { taskId: task.id }) }),
    },
    {
      id: 'status',
      label: 'Change status…',
      icon: CircleDot,
      onSelect: () => setEdit({ kind: 'status', task }),
    },
    {
      id: 'priority',
      label: 'Change priority…',
      icon: Flag,
      onSelect: () => setEdit({ kind: 'priority', task }),
    },
    {
      id: 'assignee',
      label: 'Assign to…',
      icon: UserPlus,
      onSelect: () => setEdit({ kind: 'assignee', task }),
    },
    {
      id: 'due',
      label: 'Set due date…',
      icon: CalendarClock,
      onSelect: () => setEdit({ kind: 'due', task }),
    },
    {
      id: 'wave',
      label: 'Move to wave…',
      icon: CalendarRange,
      onSelect: () => setEdit({ kind: 'wave', task }),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      onSelect: () =>
        add({
          ...task,
          id: `t-${crypto.randomUUID().slice(0, 8)}`,
          key: `${task.key}-COPY`,
          title: `${task.title} (copy)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
    },
    { id: 'remove', label: 'Remove', icon: Trash2, danger: true, onSelect: () => remove(task.id) },
  ];

  const close = () => setEdit(null);

  const modals = edit ? (
    edit.kind === 'status' ? (
      <ChoiceModal
        open
        title="Change status"
        label="Status"
        value={edit.task.status}
        options={STATUS_OPTIONS}
        onClose={close}
        onSubmit={(value) =>
          patch(
            edit.task.id,
            { status: value as WorkStatus, updatedAt: Date.now() },
            `Status changed to ${STATUS_META[value as WorkStatus].label}`,
          )
        }
      />
    ) : edit.kind === 'priority' ? (
      <ChoiceModal
        open
        title="Change priority"
        label="Priority"
        value={String(edit.task.priority)}
        options={PRIORITY_OPTIONS}
        onClose={close}
        onSubmit={(value) =>
          patch(
            edit.task.id,
            { priority: Number(value), updatedAt: Date.now() },
            `Priority changed to ${PRIORITY_META[Number(value)].label}`,
          )
        }
      />
    ) : edit.kind === 'assignee' ? (
      <Dialog open title="Assign task" onClose={close}>
        <MemberPicker
          value={edit.task.assigneeId}
          onChange={(assigneeId) => {
            patch(
              edit.task.id,
              { assigneeId, updatedAt: Date.now() },
              assigneeId
                ? `Assigned to ${memberById(state.members, assigneeId)?.name ?? 'someone'}`
                : 'Unassigned',
            );
            close();
          }}
        />
      </Dialog>
    ) : edit.kind === 'wave' ? (
      <ChoiceModal
        open
        title="Move to wave"
        label="Wave"
        value={edit.task.waveId ?? ''}
        options={waveOptions}
        onClose={close}
        onSubmit={(value) =>
          patch(
            edit.task.id,
            { waveId: value || null, updatedAt: Date.now() },
            value
              ? `Moved to ${state.waves.find((wave) => wave.id === value)?.name ?? 'a wave'}`
              : 'Moved out of the wave',
          )
        }
      />
    ) : (
      <DateModal
        open
        title="Set due date"
        label="Due date"
        value={edit.task.dueDate}
        onClose={close}
        onSubmit={(value) =>
          patch(
            edit.task.id,
            { dueDate: value, updatedAt: Date.now() },
            value ? `Due date set to ${value}` : 'Due date cleared',
          )
        }
      />
    )
  ) : null;

  return { tasks, actionsFor, modals };
}
