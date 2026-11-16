/**
 * Furniture shared by the research screens.
 *
 * The tracker draws the same task row, status dot, priority mark and member avatar in
 * a dozen places. Keeping them here means the list, the board, the timeline and the
 * panels agree on what a task looks like, and a change to that look is one edit.
 *
 * Nothing here reads a route: the surfaces stay composable and testable on their own.
 */

import {
  AlertTriangle,
  ArrowDown,
  Ban,
  ArrowRight,
  ArrowUp,
  AtSign,
  CircleDot,
  Clock,
  Code2,
  Database,
  Eye,
  FileText,
  Flame,
  FlaskConical,
  Image,
  ListChecks,
  MessageSquare,
  Minus,
  NotebookPen,
  Paperclip,
  Play,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import { Avatar } from '@/components/ui';
import { RowMenu, type RowAction } from '@/components/common/RowMenu';
import { cn } from '@/lib/cn';
import { paths } from '@/app/routes';
import { useApp } from '@/store/app';
import {
  KIND_META,
  PRIORITY_META,
  STATUS_META,
  TASK_KINDS,
  WORK_STATUSES,
  isOverdue,
  labelsOf,
  memberById,
  type Evidence,
  type InboxEntry,
  type Member,
  type Task,
  type TaskKind,
  type WorkStatus,
} from '@/store/research';

/**
 * A kind icon for an inbox entry. The feed and intake both need it, and a reader
 * crossing between them should not have to learn two icon languages.
 */
const INBOX_ICON: Record<InboxEntry['kind'], typeof FileText> = {
  assigned: UserPlus,
  comment: MessageSquare,
  mention: AtSign,
  'review-request': Eye,
  status: CircleDot,
  due: Clock,
  evidence: Paperclip,
  blocked: AlertTriangle,
  'review-done': ListChecks,
  'run-failed': Ban,
};

/** The icon for an inbox entry kind. */
export function InboxKindGlyph({ kind, className }: { kind: InboxEntry['kind']; className?: string }) {
  const Icon = INBOX_ICON[kind];
  return <Icon className={cn('size-3.5 shrink-0', className)} aria-hidden />;
}

/* ================================================================================================
 * Dates
 * ============================================================================================== */

/** Milliseconds in a day, for span arithmetic. */
export const DAY_MS = 86_400_000;

/** Parse an ISO date at local midnight, so day labels do not drift across timezones. */
export function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Format a local date back to `YYYY-MM-DD`. */
export function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A new date `days` away. Negative moves into the past. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** `12 Oct` — the shortest date a reader parses without thinking. */
export function dayLabel(iso: string): string {
  return parseDay(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** `12 Oct – 3 Nov`. */
export function rangeLabel(startIso: string, endIso: string): string {
  return `${dayLabel(startIso)} – ${dayLabel(endIso)}`;
}

/** How many whole days lie between two timestamps. */
export function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

/* ================================================================================================
 * People and vocabulary
 * ============================================================================================== */

/**
 * Sizes, in the platform's own scale rather than HeroUI's.
 *
 * HeroUI's smallest avatar is 32px, which is two and a half times the line height of the
 * rows avatars appear in — they read as chips that swallowed a person. These are sized to
 * the type they sit beside.
 */
const AVATAR_SIZE = {
  // The fallback text is HeroUI's `text-sm` at 14px, which is 58% of a 24px circle — the
  // initials read as the avatar rather than as a label on it. These are sized to the circle.
  xs: 'size-5 text-meta',
  sm: 'size-6 text-meta',
  md: 'size-8 text-label',
} as const;

/** A member's avatar, tinted with the colour the domain carries for them. */
/**
 * Who caused a row.
 *
 * Most rows are a person's; the ones the workbench reports itself — a review that finished, a
 * run that failed — say so with its own mark rather than the dot a missing member gets.
 */
export function ActorMark({ id, size = 'sm' }: { id: string | null; size?: keyof typeof AVATAR_SIZE }) {
  if (id === 'system') {
    return (
      <span
        role="img"
        aria-label="openlab"
        className={cn(
          'grid shrink-0 place-items-center rounded-full bg-accent/15 text-accent',
          AVATAR_SIZE[size],
        )}
      >
        <Sparkles className="size-3.5" aria-hidden />
      </span>
    );
  }
  return <MemberAvatar id={id} size={size} />;
}

export function MemberAvatar({ id, size = 'sm' }: { id: string | null; size?: keyof typeof AVATAR_SIZE }) {
  const { state } = useApp();
  const member = memberById(state.members, id);
  if (!member) {
    return (
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full bg-surface-tertiary text-meta text-muted',
          AVATAR_SIZE[size],
        )}
      >
        ·
      </span>
    );
  }
  return (
    <Avatar
      size="sm"
      title={member.name}
      aria-label={member.name}
      className={AVATAR_SIZE[size]}
      style={{ backgroundColor: member.color, color: '#ffffff' }}
    >
      {member.initials}
    </Avatar>
  );
}

/** The dot that carries a status without the word. */
export function StatusDot({ status, className }: { status: WorkStatus; className?: string }) {
  return (
    <span
      title={STATUS_META[status].label}
      className={cn('inline-block size-2 shrink-0 rounded-full', STATUS_META[status].tone, className)}
    />
  );
}

/**
 * Priority as four bars, filled up to the level.
 *
 * The mark is drawn rather than lettered so a column of rows can be scanned for the
 * urgent ones without reading a single label.
 */
export function PriorityGlyph({ priority }: { priority: number }) {
  const meta = PRIORITY_META[priority] ?? PRIORITY_META[0];
  const tone = priority >= 4 ? 'text-danger' : priority === 3 ? 'text-warning' : 'text-muted';
  return (
    <span title={meta.label} className={cn('inline-flex w-4 shrink-0', tone)}>
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
        {[0, 1, 2, 3].map((index) => {
          const height = 3 + index * 2.5;
          return (
            <rect
              key={index}
              x={1 + index * 2.6}
              y={11 - height}
              width="2"
              height={height}
              rx="0.6"
              fill="currentColor"
              opacity={priority > index ? 1 : 0.22}
            />
          );
        })}
      </svg>
    </span>
  );
}

/**
 * The icon and tint each priority level wears where a control has room for a mark beside
 * the word: a filter row, a task record.
 *
 * A different mark from {@link PriorityGlyph}, which draws four bars for a dense column.
 * This one is a single icon on a tint, so a picker or a trigger reads at a glance.
 */
export const PRIORITY_MARK: Record<number, { icon: LucideIcon; chip: string; ink: string }> = {
  0: { icon: Minus, chip: 'bg-muted/15 text-muted', ink: 'text-muted' },
  1: { icon: ArrowDown, chip: 'bg-muted/15 text-muted', ink: 'text-muted' },
  2: { icon: ArrowRight, chip: 'bg-muted/15 text-foreground', ink: 'text-foreground' },
  3: { icon: ArrowUp, chip: 'bg-warning/15 text-warning', ink: 'text-warning' },
  4: { icon: Flame, chip: 'bg-danger/15 text-danger', ink: 'text-danger' },
};

/** The kind icon, sized so a column of rows lines up. */
export function KindGlyph({ kind, className }: { kind: TaskKind; className?: string }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <Icon role="img" aria-label={meta.label} className={cn('size-3.5 shrink-0', meta.tone, className)} />
  );
}

/**
 * The mark each evidence kind wears: the icon, the word it is known by, and the tint it
 * carries where evidence has room for one.
 *
 * The record page now draws evidence as cards rather than rows, so a kind has to read at a
 * glance — an icon on its own tint, the way a task kind reads in the list. Kept here so the
 * card and any future evidence surface cannot disagree about what a dataset looks like.
 */
export const EVIDENCE_MARK: Record<
  Evidence['kind'],
  { icon: typeof FileText; label: string; mark: string; tone: string }
> = {
  dataset: { icon: Database, label: 'Dataset', mark: 'bg-accent-soft', tone: 'text-accent-soft-foreground' },
  figure: { icon: Image, label: 'Figure', mark: 'bg-success-soft', tone: 'text-success-soft-foreground' },
  paper: { icon: FileText, label: 'Paper', mark: 'bg-warning-soft', tone: 'text-warning-soft-foreground' },
  run: { icon: Play, label: 'Run', mark: 'bg-success-soft', tone: 'text-success-soft-foreground' },
  notebook: {
    icon: NotebookPen,
    label: 'Notebook',
    mark: 'bg-warning-soft',
    tone: 'text-warning-soft-foreground',
  },
  code: { icon: Code2, label: 'Code', mark: 'bg-accent-soft', tone: 'text-accent-soft-foreground' },
  protocol: {
    icon: FlaskConical,
    label: 'Protocol',
    mark: 'bg-accent-soft',
    tone: 'text-accent-soft-foreground',
  },
};

/** Label chips: a tinted dot and the name, capped so a row never wraps. */
export function LabelDots({ task, className, max = 3 }: { task: Task; className?: string; max?: number }) {
  const { state } = useApp();
  const labels = labelsOf(state.labels, task).slice(0, max);
  if (labels.length === 0) {
    return null;
  }
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {labels.map((label) => (
        <span
          key={label.id}
          className="inline-flex max-w-[124px] items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 text-meta text-muted"
        >
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
          <span className="truncate">{label.name}</span>
        </span>
      ))}
    </span>
  );
}

/** A task's key, in the one monospaced style the tracker uses for keys. */
export function TaskKey({ task, className }: { task: Task; className?: string }) {
  return (
    <span className={cn(' text-meta tabular-nums whitespace-nowrap text-muted', className)}>{task.key}</span>
  );
}

/** The due date, in red once it is past. */
export function DueDate({ task, className }: { task: Task; className?: string }) {
  if (!task.dueDate) {
    return <span className={cn(' text-meta text-muted', className)}>—</span>;
  }
  return (
    <span
      className={cn(
        ' text-meta tabular-nums whitespace-nowrap',
        isOverdue(task) ? 'text-danger' : 'text-muted',
        className,
      )}
    >
      {dayLabel(task.dueDate)}
    </span>
  );
}

/* ================================================================================================
 * Progress
 * ============================================================================================== */

/** A thin progress bar. Plain marks, because the value is the message. */
export function ProgressLine({
  value,
  tone = 'accent',
  className,
}: {
  value: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const fill =
    tone === 'success'
      ? 'bg-success'
      : tone === 'warning'
        ? 'bg-warning'
        : tone === 'danger'
          ? 'bg-danger'
          : 'bg-accent';
  return (
    <span className={cn('block h-1.5 overflow-hidden rounded-full bg-surface-secondary', className)}>
      <span
        className={cn('block h-full rounded-full transition-[width] duration-300', fill)}
        style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
    </span>
  );
}

/* ================================================================================================
 * Sorting and grouping
 * ============================================================================================== */

/** The grouping keys the list layout offers. */
export type GroupBy = 'none' | 'status' | 'assignee' | 'priority' | 'kind';

/** The sort keys the list layout offers. */
export type SortBy = 'priority' | 'updated' | 'due' | 'key';

/** A labelled block of tasks, as the list renders it. */
export interface TaskGroup {
  id: string;
  label: string;
  tasks: Task[];
}

function dueRank(task: Task): number {
  return task.dueDate ? Date.parse(task.dueDate) : Number.MAX_SAFE_INTEGER;
}

/** Apply the tracker's sort. Pure, so list and future views agree on the order. */
export function sortTasks(tasks: readonly Task[], sort: SortBy): Task[] {
  const copy = [...tasks];
  switch (sort) {
    case 'priority':
      return copy.sort(
        (a, b) => b.priority - a.priority || dueRank(a) - dueRank(b) || a.key.localeCompare(b.key),
      );
    case 'updated':
      return copy.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'due':
      return copy.sort((a, b) => dueRank(a) - dueRank(b) || a.key.localeCompare(b.key));
    case 'key':
      return copy.sort((a, b) => a.key.localeCompare(b.key));
  }
}

/**
 * Bucket tasks by the chosen key.
 *
 * Buckets are built in domain order first and emptied out afterwards, so the groups
 * keep a stable, meaningful order instead of appearing in whatever order the tasks
 * happen to be in. Empty groups are dropped: a header with nothing under it is noise.
 */
export function groupTasks(
  tasks: readonly Task[],
  groupBy: GroupBy,
  members: readonly Member[],
): TaskGroup[] {
  if (groupBy === 'none') {
    return [{ id: 'all', label: 'All tasks', tasks: [...tasks] }];
  }
  if (tasks.length === 0) {
    return [];
  }

  const buckets: TaskGroup[] = [];
  const keyOf = (task: Task): string => {
    switch (groupBy) {
      case 'status':
        return task.status;
      case 'kind':
        return task.kind;
      case 'priority':
        return String(task.priority);
      case 'assignee':
        return task.assigneeId ?? 'none';
    }
  };

  switch (groupBy) {
    case 'status':
      for (const status of WORK_STATUSES) {
        buckets.push({ id: status, label: STATUS_META[status].label, tasks: [] });
      }
      break;
    case 'kind':
      for (const kind of TASK_KINDS) {
        buckets.push({ id: kind, label: KIND_META[kind].label, tasks: [] });
      }
      break;
    case 'priority':
      for (const priority of [4, 3, 2, 1, 0]) {
        buckets.push({ id: String(priority), label: PRIORITY_META[priority].label, tasks: [] });
      }
      break;
    case 'assignee':
      for (const member of members) {
        buckets.push({ id: member.id, label: member.name, tasks: [] });
      }
      buckets.push({ id: 'none', label: 'Unassigned', tasks: [] });
      break;
  }

  const index = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  for (const task of tasks) {
    index.get(keyOf(task))?.tasks.push(task);
  }
  return buckets.filter((bucket) => bucket.tasks.length > 0);
}

/* ================================================================================================
 * The standard task row
 * ============================================================================================== */

/**
 * One task, as the list and My work draw it.
 *
 * Clicking peeks rather than navigates: the panel keeps the context the row was found
 * in, which is the whole reason the peek exists beside the list. A surface without a
 * peek of its own can pass `onOpen` to send the reader somewhere that has one.
 */
export function TaskRow({
  task,
  selected,
  onOpen,
  actions,
}: {
  task: Task;
  selected?: boolean;
  onOpen?: () => void;
  /** Trailing menu actions. Without them the row is only a link, as it was before. */
  actions?: RowAction[];
}) {
  const { dispatch } = useApp();
  const row = (
    <button
      type="button"
      onClick={onOpen ?? (() => dispatch({ type: 'route/go', route: paths.task(task.id) }))}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-surface',
        selected && 'bg-surface',
      )}
    >
      <KindGlyph kind={task.kind} className="w-4 shrink-0 text-center" />
      <TaskKey task={task} className="w-[68px] shrink-0" />
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{task.title}</span>
      <LabelDots task={task} className="hidden xl:flex" />
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span className="hidden w-[54px] items-center justify-end gap-2 lg:flex">
          {task.evidence.length > 0 && (
            <span className="flex items-center gap-1 text-meta tabular-nums text-muted">
              <FileText className="size-3" aria-hidden />
              {task.evidence.length}
            </span>
          )}
          {task.comments.length > 0 && (
            <span className="flex items-center gap-1 text-meta tabular-nums text-muted">
              <MessageSquare className="size-3" aria-hidden />
              {task.comments.length}
            </span>
          )}
        </span>
        <span className="w-7 text-right text-meta tabular-nums text-muted">
          {task.estimate !== null ? `${task.estimate}d` : ''}
        </span>
        <span className="w-[52px] text-right">
          <DueDate task={task} />
        </span>
        <PriorityGlyph priority={task.priority} />
        <StatusDot status={task.status} />
        <MemberAvatar id={task.assigneeId} />
      </span>
    </button>
  );

  if (!actions) {
    return row;
  }

  // The menu sits beside the row's button, never inside it: a pressable cannot contain
  // another pressable.
  return (
    <div className="group flex items-center gap-1">
      <div className="min-w-0 flex-1">{row}</div>
      <RowMenu label={`Actions for ${task.key}`} actions={actions} />
    </div>
  );
}
