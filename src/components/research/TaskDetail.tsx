/**
 * A task's page.
 *
 * The peek kept the list visible; a page gives the task a URL, which is what makes it
 * citable from a review or a message. The record sits on the left and the facts on the
 * right, because the facts are reference material rather than work.
 *
 * Title, assignee, due date, wave, status, priority, subtasks and comments are stored on the
 * task and written through `task/patch`, so they survive navigation and a reload. A reply is
 * a comment with a `parentId` in the same list, and an attachment is a path the task carries;
 * both travel with the task and are written to the database.
 */

import { Fragment, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  CalendarClock,
  CalendarPlus,
  CalendarRange,
  Check,
  CircleDashed,
  Copy,
  CornerDownRight,
  Database,
  FileText,
  Image,
  Link2,
  NotebookText,
  Pencil,
  RefreshCw,
  Reply,
  SendHorizontal,
  SmilePlus,
  Tag,
  Timer,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';

import {
  Button,
  Cell,
  CellGroup,
  CellSeparator,
  IconButton,
  Popover,
  SectionLabel,
  Select,
  TextArea,
} from '@/components/ui';
import { pathFor, paths } from '@/app/routes';
import { cn } from '@/lib/cn';
import { invokeCommand, isDesktop } from '@/lib/ipc';
import { formatBytes, relativeTime, shortPath } from '@/lib/format';
import { notify } from '@/lib/toast';
import {
  KIND_META,
  PRIORITY_META,
  STATUS_META,
  WORK_STATUSES,
  memberById,
  type Comment,
  type Evidence,
  type Relation,
  type Task,
  type TaskAttachment,
  type WorkStatus,
} from '@/store/research';
import { ChoiceModal, DateModal, RenameModal, RowMenu, type RowAction } from '@/components/common/RowMenu';
import { MemberPicker } from '@/components/common/MemberPicker';
import { useApp, usePageTitle } from '@/store/app';
import { activeProject } from '@/store/types';
import { MOTION } from '@/theme/tokens';
import {
  dayLabel,
  EVIDENCE_MARK,
  KindGlyph,
  LabelDots,
  MemberAvatar,
  PRIORITY_MARK,
  ProgressLine,
  TaskKey,
} from './shared';
import { Fact, FactGroup, RecordLink, RecordMissing, RecordPage } from './PageShell';

/** The reactions the picker offers. A small set, so the row stays a row. */
const REACTIONS = ['👍', '🎯', '❓', '🔁'] as const;

const STATUS_OPTIONS = WORK_STATUSES.map((status) => ({
  value: status,
  label: STATUS_META[status].label,
}));

/**
 * A status, drawn the way the tracker draws it everywhere: the icon it is known by, on the
 * tint it is known by. A control that shows a bare word here and a coloured dot in the list
 * makes the reader learn the same thing twice.
 */
function StatusOption({ status, label }: { status: WorkStatus; label: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    // No tint: a select's rows are a list, and seven coloured bars down one is decoration.
    <span className={cn('flex w-full min-w-0 items-center gap-2 px-2 py-0.5', meta.ink)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate text-body">{label}</span>
    </span>
  );
}

/**
 * A priority, drawn the way the filter draws it: the level's icon on the level's tint.
 *
 * Urgent is red, high amber, medium and low muted. The mark is deliberately not the
 * four-bar {@link PriorityGlyph} used in dense rows — a control has room for one icon,
 * and the same icon in the trigger and the menu keeps it from changing on open.
 */
function PriorityOption({ priority, label }: { priority: number; label: string }) {
  const mark = PRIORITY_MARK[priority] ?? PRIORITY_MARK[0];
  const Icon = mark.icon;
  return (
    <span className={cn('flex w-full min-w-0 items-center gap-2 px-2 py-0.5', mark.ink)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate text-body">{label}</span>
    </span>
  );
}

const PRIORITY_OPTIONS = [4, 3, 2, 1, 0].map((priority) => ({
  value: String(priority),
  label: PRIORITY_META[priority].label,
}));

type TaskField = 'due' | 'wave';

/**
 * How each relation reads: the verb, the icon that says which way it points, and the tint
 * that tells the four apart at a glance. A link says two things depend on each other; a
 * ban says one is in the way; an arrow out says this task is the one in the way.
 */
const RELATION_META: Record<Relation['type'], { label: string; icon: LucideIcon; tone: string }> = {
  blocks: {
    label: 'Blocks',
    icon: ArrowUpRight,
    tone: 'bg-warning-soft text-warning-soft-foreground',
  },
  'blocked-by': {
    label: 'Blocked by',
    icon: Ban,
    tone: 'bg-danger-soft text-danger-soft-foreground',
  },
  related: {
    label: 'Related',
    icon: Link2,
    tone: 'bg-accent-soft text-accent-soft-foreground',
  },
  duplicates: {
    label: 'Duplicates',
    icon: Copy,
    tone: 'bg-surface-tertiary text-muted',
  },
};

/**
 * Where a piece of evidence goes when it is opened.
 *
 * Evidence is an artefact, not a record, so its home is the section that owns that class of
 * artefact: files for a dataset, notebook or protocol, the figure gallery for a figure, the
 * job list for a run. A run whose ref is a job id opens that run outright. A paper names a
 * DOI and has no page here, so its card stays still.
 */
const EVIDENCE_SECTION: Partial<Record<Evidence['kind'], string>> = {
  dataset: 'library/files',
  notebook: 'library/files',
  code: 'library/files',
  protocol: 'library/files',
  figure: 'analyze/figures',
  run: 'compute/jobs',
};

/** The page a piece of evidence can open, or `null` when it has nowhere to go. */
function evidenceRoute(item: Evidence): string | null {
  if (item.kind === 'run' && item.ref.startsWith('job-')) {
    return pathFor('compute/jobs/:jobId', { jobId: item.ref });
  }
  return EVIDENCE_SECTION[item.kind] ?? null;
}

/** A file hung on a task. The domain has no attachment field, so this is a local shape. */
/**
 * The kind an attachment wears, from its extension.
 *
 * The kind is a label for the icon, not a promise about the file: the bytes are read by the
 * viewer when the reader opens it, and the path stays the source of truth.
 */
function attachmentKind(name: string): TaskAttachment['kind'] {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (['csv', 'tsv', 'xlsx', 'xls', 'parquet', 'json'].includes(extension)) return 'dataset';
  if (['ipynb', 'rmd', 'qmd'].includes(extension)) return 'notebook';
  if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(extension)) return 'figure';
  if (extension === 'pdf') return 'document';
  if (['zip', 'tar', 'gz', 'tgz', '7z', 'bz2'].includes(extension)) return 'archive';
  return 'document';
}

/** The mark an attachment kind wears: a file kind's icon on the file kind's tint. */
const ATTACHMENT_MARK: Record<TaskAttachment['kind'], { icon: LucideIcon; mark: string; tone: string }> = {
  dataset: { icon: Database, mark: 'bg-accent-soft', tone: 'text-accent-soft-foreground' },
  notebook: { icon: NotebookText, mark: 'bg-warning-soft', tone: 'text-warning-soft-foreground' },
  figure: { icon: Image, mark: 'bg-success-soft', tone: 'text-success-soft-foreground' },
  document: { icon: FileText, mark: 'bg-surface-tertiary', tone: 'text-muted' },
  archive: { icon: Archive, mark: 'bg-surface-tertiary', tone: 'text-muted' },
};

/**
 * The reactions on one comment: the ones already there, each a chip that toggles the
 * reader's own, plus a picker for a reaction nobody has used yet. A chip the reader has
 * joined is tinted, so the row says what you did as well as what everyone did.
 */
function Reactions({
  reactions,
  onToggle,
}: {
  reactions: Record<string, string[]>;
  onToggle: (emoji: string) => void;
}) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  // There is no account yet, so the reader is the first member in the workspace, the same
  // list the member pickers read. With no members nothing is the reader's own.
  const currentUserId = state.members[0]?.id ?? null;
  const present = Object.entries(reactions).filter(([, ids]) => ids.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {present.map(([emoji, ids]) => {
        const mine = currentUserId !== null && ids.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={mine}
            aria-label={`${emoji} ${ids.length}`}
            onClick={() => onToggle(emoji)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-meta tabular-nums transition-colors',
              mine
                ? 'bg-accent-soft text-accent-soft-foreground'
                : 'bg-surface text-muted hover:bg-surface-tertiary',
            )}
          >
            <span aria-hidden>{emoji}</span>
            {ids.length}
          </button>
        );
      })}
      <Popover
        isOpen={open}
        onOpenChange={setOpen}
        trigger={
          <IconButton aria-label="Add a reaction" title="Add a reaction">
            <SmilePlus className="size-3.5" />
          </IconButton>
        }
      >
        <div className="flex items-center gap-1 p-1">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              onClick={() => {
                onToggle(emoji);
                setOpen(false);
              }}
              className="grid size-7 place-items-center rounded-lg text-body transition-colors hover:bg-surface"
            >
              {emoji}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/**
 * One top-level comment, its replies, and its reply composer.
 *
 * Replies indent one level and stop: a reply is drawn as a note on the comment, not as
 * another comment to answer, so the thread cannot run away sideways. The reply header
 * names the author it is answering, which is the one thing indentation alone cannot say.
 */
function CommentRow({
  comment,
  replies,
  replyOpen,
  replyDraft,
  onToggleReaction,
  onToggleReply,
  onReplyDraft,
  onSendReply,
}: {
  comment: Comment;
  replies: Comment[];
  replyOpen: boolean;
  replyDraft: string;
  onToggleReaction: (commentId: string, emoji: string) => void;
  onToggleReply: (commentId: string) => void;
  onReplyDraft: (value: string) => void;
  onSendReply: (commentId: string) => void;
}) {
  const { state } = useApp();
  const author = memberById(state.members, comment.authorId);
  const canSendReply = replyDraft.trim().length > 0;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: MOTION.duration.micro, ease: MOTION.micro }}
      className="flex gap-2"
    >
      <MemberAvatar id={comment.authorId} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-label text-foreground">{author?.name ?? 'Someone'}</span>
          <span className="shrink-0 text-meta tabular-nums text-muted">
            {relativeTime(comment.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 text-body text-foreground">{comment.body}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Reactions
            reactions={comment.reactions}
            onToggle={(emoji) => onToggleReaction(comment.id, emoji)}
          />
          <Button variant="ghost" size="sm" className="gap-1" onPress={() => onToggleReply(comment.id)}>
            <Reply className="size-3.5" aria-hidden />
            Reply
          </Button>
        </div>

        {(replies.length > 0 || replyOpen) && (
          <div className="mt-2 flex flex-col gap-3 rounded-2xl bg-surface p-3">
            {replies.length > 0 && (
              <ul className="flex flex-col gap-3">
                <AnimatePresence initial={false}>
                  {replies.map((reply) => {
                    const replyAuthor = memberById(state.members, reply.authorId);
                    return (
                      <motion.li
                        key={reply.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: MOTION.duration.micro, ease: MOTION.micro }}
                        className="flex gap-2"
                      >
                        <MemberAvatar id={reply.authorId} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="truncate text-label text-foreground">
                              {replyAuthor?.name ?? 'Someone'}
                            </span>
                            <span className="shrink-0 text-meta tabular-nums text-muted">
                              {relativeTime(reply.createdAt)}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1 text-meta text-muted">
                              <CornerDownRight className="size-3" aria-hidden />
                              Reply to {author?.name ?? 'this comment'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-body text-foreground">{reply.body}</p>
                          <div className="mt-1.5">
                            <Reactions
                              reactions={reply.reactions}
                              onToggle={(emoji) => onToggleReaction(reply.id, emoji)}
                            />
                          </div>
                        </div>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}

            <AnimatePresence initial={false}>
              {replyOpen && (
                <motion.div
                  key="composer"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: MOTION.duration.micro, ease: MOTION.micro }}
                  className="flex flex-col gap-2"
                >
                  <TextArea
                    rows={2}
                    value={replyDraft}
                    onChange={(event) => onReplyDraft(event.target.value)}
                    placeholder={`Reply to ${author?.name ?? 'this comment'}…`}
                    aria-label="Reply"
                    className="w-full"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={!canSendReply}
                    onPress={() => onSendReply(comment.id)}
                    className="ml-auto gap-1.5"
                  >
                    <SendHorizontal className="size-3.5" aria-hidden />
                    Reply
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.li>
  );
}

/**
 * The description, written on the page.
 *
 * A task's description is the field a reader changes most, and its page is where they read it,
 * so it opens in place: press, type, leave. A description nobody can change is a form.
 */
function DescriptionEditor({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const save = () => {
    onSave(draft.trim());
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="-mx-1 w-full rounded-xl px-1 py-1 text-start transition-colors hover:bg-surface-tertiary"
      >
        {value ? (
          <span className="block max-w-[68ch] text-body leading-relaxed whitespace-pre-wrap text-foreground">
            {value}
          </span>
        ) : (
          <span className="block text-body text-muted">Add a description…</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <TextArea
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="What this task involves, and how it is done."
        className="min-h-[110px] w-full"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            cancel();
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            save();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onPress={cancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onPress={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** The page body, keyed by id so local edits reset when the reader moves to another task. */
function TaskDetailBody({ task }: { task: Task }) {
  const { state, dispatch } = useApp();
  const waveOptions = [
    { value: '', label: 'No wave' },
    ...state.waves.map((wave) => ({ value: wave.id, label: `W${wave.number} · ${wave.name}` })),
  ];
  const [renameOpen, setRenameOpen] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [field, setField] = useState<TaskField | null>(null);
  usePageTitle(`${task.key} · ${task.title}`);

  // The rail reads the task in the store, so a change through the menu is visible where it lives.
  const wave = state.waves.find((candidate) => candidate.id === task.waveId);

  /**
   * An attached file opens in a tab of its own.
   *
   * The peek used to hold it, which is the wrong surface for a file the reader may want to
   * read beside the task. The path is stored as picked — absolute when it came from the
   * dialog — so it is made workspace-relative before it becomes a route.
   */
  const openAttachment = (path: string) => {
    const root = activeProject(state)?.path ?? '';
    const relative = root && path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]+/, '') : path;
    dispatch({ type: 'route/go', route: paths.file(relative) });
  };

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const attachments = task.attachments ?? [];
  /** Replies live in the same list as comments, told apart by `parentId`. */
  const repliesOf = (parentId: string) => task.comments.filter((comment) => comment.parentId === parentId);
  const topLevel = task.comments.filter((comment) => !comment.parentId);

  // There is no account yet, so the reader is the first member in the workspace — the same
  // list the member pickers read. With no members a comment is stored without an author
  // rather than under an invented one.
  const authorId = state.members[0]?.id ?? '';

  const doneCount = task.subtasks.filter((subtask) => subtask.done).length;
  const canSend = draft.trim().length > 0;

  /** Every edit to a field the task carries goes through the store, so it survives navigation. */
  const patch = (changes: Partial<Task>) =>
    dispatch({ type: 'task/patch', id: task.id, patch: { ...changes, updatedAt: Date.now() } });

  const send = () => {
    const body = draft.trim();
    if (!body) {
      return;
    }
    patch({
      comments: [
        ...task.comments,
        { id: `c-${crypto.randomUUID().slice(0, 8)}`, authorId, body, createdAt: Date.now(), reactions: {} },
      ],
    });
    setDraft('');
  };

  /** Add or drop the reader's own reaction, on a top-level comment or on a reply. */
  const toggleReaction = (commentId: string, emoji: string) => {
    if (!authorId) {
      return;
    }
    const update = (list: Comment[]) =>
      list.map((comment) => {
        if (comment.id !== commentId) {
          return comment;
        }
        const ids = comment.reactions[emoji] ?? [];
        const mine = ids.includes(authorId);
        const nextIds = mine ? ids.filter((id) => id !== authorId) : [...ids, authorId];
        const next = { ...comment.reactions };
        if (nextIds.length > 0) {
          next[emoji] = nextIds;
        } else {
          delete next[emoji];
        }
        return { ...comment, reactions: next };
      });
    patch({ comments: update(task.comments) });
  };

  const toggleReply = (commentId: string) => {
    setReplyTo((current) => (current === commentId ? null : commentId));
    setReplyDraft('');
  };

  const sendReply = (parentId: string) => {
    const body = replyDraft.trim();
    if (!body) {
      return;
    }
    patch({
      comments: [
        ...task.comments,
        {
          id: `c-${crypto.randomUUID().slice(0, 8)}`,
          authorId,
          body,
          createdAt: Date.now(),
          reactions: {},
          parentId,
        },
      ],
    });
    setReplyDraft('');
    setReplyTo(null);
  };

  /** Attach the files the reader picks, storing their paths rather than copying bytes. */
  const attach = async () => {
    if (!isDesktop()) {
      return;
    }
    const root = activeProject(state)?.path ?? '';
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: true, directory: false, defaultPath: root || undefined });
    if (!picked) {
      return;
    }
    const paths = Array.isArray(picked) ? picked : [picked];
    const added: TaskAttachment[] = [];
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() ?? path;
      // The workspace is the boundary every other tool respects; an attachment outside it
      // could be recorded but never opened or read back.
      const size = await invokeCommand<number>('file_size', { path, root: root || null });
      if (!size.ok) {
        notify(`${name} is outside this workspace`, { tone: 'warning' });
        continue;
      }
      added.push({
        id: `a-${crypto.randomUUID().slice(0, 8)}`,
        kind: attachmentKind(name),
        name,
        path,
        bytes: size.value,
        by: authorId,
        at: Date.now(),
      });
    }
    if (added.length === 0) {
      return;
    }
    patch({ attachments: [...attachments, ...added] });
    notify(`Attached ${added.length} file${added.length === 1 ? '' : 's'}`, { tone: 'success' });
  };

  const pageActions: RowAction[] = [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setRenameOpen(true) },
    { id: 'due', label: 'Set due date…', icon: CalendarClock, onSelect: () => setField('due') },
    { id: 'wave', label: 'Move to wave…', icon: CalendarRange, onSelect: () => setField('wave') },
    { id: 'estimate', label: 'Set estimate…', icon: Timer, onSelect: () => setEstimateOpen(true) },
  ];

  return (
    <RecordPage
      eyebrow={
        <>
          <KindGlyph kind={task.kind} />
          <TaskKey task={task} />
          <span className="text-meta text-muted">{KIND_META[task.kind].label}</span>
          <span className="ml-auto">
            <RowMenu label={`Actions for ${task.key}`} actions={pageActions} always />
          </span>
        </>
      }
      title={task.title}
      aside={
        <FactGroup>
          {wave && (
            <Fact icon={CalendarRange} label="Wave">
              <RecordLink
                route={pathFor('research/waves/:waveId', { waveId: wave.id })}
                className="block w-full truncate text-link hover:underline"
              >
                W{wave.number} · {wave.name}
              </RecordLink>
            </Fact>
          )}
          <Fact icon={User} label="Assignee">
            <MemberPicker
              value={task.assigneeId}
              onChange={(id) => {
                patch({ assigneeId: id });
                notify(id ? 'Task reassigned' : 'Task unassigned');
              }}
            />
          </Fact>
          {task.labels.length > 0 && (
            <Fact icon={Tag} label="Labels">
              <LabelDots task={task} max={6} className="flex-wrap" />
            </Fact>
          )}
          {task.estimate !== null && (
            <Fact icon={Timer} label="Estimate">
              <span className="tabular-nums">{task.estimate} days</span>
            </Fact>
          )}
          {task.dueDate && (
            <Fact icon={CalendarClock} label="Due">
              <span className="tabular-nums">{dayLabel(task.dueDate)}</span>
            </Fact>
          )}
          <Fact icon={CalendarPlus} label="Created">
            <span className="tabular-nums">{relativeTime(task.createdAt)}</span>
          </Fact>
          <Fact icon={RefreshCw} label="Updated">
            <span className="tabular-nums">{relativeTime(task.updatedAt)}</span>
          </Fact>
        </FactGroup>
      }
    >
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select
          variant="primary"
          value={task.status}
          options={STATUS_OPTIONS}
          onChange={(value) => {
            patch({ status: value });
            notify(
              `Status changed to ${STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value}`,
            );
          }}
          label="Status"
          className="w-full"
          renderOption={(option) => <StatusOption status={option.value} label={option.label} />}
          renderValue={(option) => option && <StatusOption status={option.value} label={option.label} />}
        />
        <Select
          variant="primary"
          value={String(task.priority)}
          options={PRIORITY_OPTIONS}
          onChange={(value) => {
            patch({ priority: Number(value) });
            notify(
              `Priority changed to ${PRIORITY_OPTIONS.find((option) => option.value === value)?.label ?? value}`,
            );
          }}
          label="Priority"
          className="w-full"
          renderOption={(option) => <PriorityOption priority={Number(option.value)} label={option.label} />}
          renderValue={(option) =>
            option && <PriorityOption priority={Number(option.value)} label={option.label} />
          }
        />
      </section>

      <section className="flex flex-col gap-2 rounded-3xl bg-surface p-4">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Description</SectionLabel>
          {task.description && <span className="ml-auto text-meta text-muted">Click to edit</span>}
        </div>
        <DescriptionEditor
          value={task.description}
          onSave={(next) => {
            if (next === task.description) {
              return;
            }
            patch({ description: next });
            notify(next ? 'Description updated' : 'Description cleared');
          }}
        />
      </section>

      {task.subtasks.length > 0 && (
        <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
          <div className="flex items-baseline gap-2">
            <SectionLabel>Subtasks</SectionLabel>
            <span className="text-meta tabular-nums text-muted">
              {doneCount}/{task.subtasks.length}
            </span>
          </div>
          <ProgressLine
            value={task.subtasks.length > 0 ? doneCount / task.subtasks.length : 0}
            tone={doneCount === task.subtasks.length ? 'success' : 'accent'}
          />
          <ul className="flex flex-col gap-0.5">
            {task.subtasks.map((subtask) => (
              <li key={subtask.id}>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      subtasks: task.subtasks.map((candidate) =>
                        candidate.id === subtask.id ? { ...candidate, done: !candidate.done } : candidate,
                      ),
                    })
                  }
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface"
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-sm',
                      subtask.done ? 'bg-accent text-accent-foreground' : 'bg-surface-tertiary',
                    )}
                  >
                    {subtask.done && <Check className="size-2.5" aria-hidden />}
                  </span>
                  <span
                    className={
                      subtask.done ? 'text-body text-muted line-through' : 'text-body text-foreground'
                    }
                  >
                    {subtask.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Evidence</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{task.evidence.length}</span>
        </div>
        {task.evidence.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {task.evidence.map((item) => {
              const mark = EVIDENCE_MARK[item.kind];
              const Icon = mark.icon;
              const route = evidenceRoute(item);
              const cardClassName =
                'group flex h-full w-full flex-col gap-3 rounded-2xl bg-surface p-4 text-left transition-colors hover:bg-surface-tertiary';
              const body = (
                <>
                  <span className="flex items-start gap-3">
                    <span
                      aria-label={mark.label}
                      className={cn('grid size-9 shrink-0 place-items-center rounded-xl', mark.mark)}
                    >
                      <Icon className={cn('size-4', mark.tone)} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-body leading-snug text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-1 block truncate text-meta tabular-nums text-muted">
                        {item.ref}
                      </span>
                    </span>
                  </span>
                  <span className="mt-auto flex items-center gap-2">
                    <span
                      className={cn(
                        'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-meta',
                        item.verified
                          ? 'bg-success-soft text-success-soft-foreground'
                          : 'bg-warning-soft text-warning-soft-foreground',
                      )}
                    >
                      {item.verified ? (
                        <BadgeCheck className="size-3" aria-hidden />
                      ) : (
                        <CircleDashed className="size-3" aria-hidden />
                      )}
                      {item.verified ? 'Verified' : 'Missing'}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={item.id} className="min-w-0">
                  {route ? (
                    <RecordLink route={route} className={cardClassName}>
                      {body}
                    </RecordLink>
                  ) : (
                    <div className={cardClassName}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-body text-muted">No evidence attached yet.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Attached files</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{attachments.length}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto gap-1.5"
            isDisabled={!isDesktop()}
            onPress={() => void attach()}
          >
            <ArrowUpRight className="size-3.5" aria-hidden />
            Attach
          </Button>
        </div>
        {attachments.length > 0 ? (
          <CellGroup>
            {attachments.map((file, index) => {
              const mark = ATTACHMENT_MARK[file.kind];
              const Icon = mark.icon;
              const owner = memberById(state.members, file.by);
              return (
                <Fragment key={file.id}>
                  {index > 0 && <CellSeparator />}
                  <Cell
                    leading={
                      <span
                        className={cn('grid size-8 shrink-0 place-items-center rounded-lg', mark.mark)}
                        aria-hidden
                      >
                        <Icon className={cn('size-4', mark.tone)} />
                      </span>
                    }
                    label={
                      <button
                        type="button"
                        onClick={() => openAttachment(file.path)}
                        className="block w-full text-start"
                      >
                        <span className="block truncate text-body text-foreground">{file.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-meta text-muted">
                          <span className="min-w-0 truncate">{shortPath(file.path)}</span>
                          <span className="tabular-nums">{formatBytes(file.bytes)}</span>
                          <span className="tabular-nums">
                            {owner?.name ?? 'Someone'} · {relativeTime(file.at)}
                          </span>
                        </span>
                      </button>
                    }
                    control={
                      <IconButton
                        aria-label={`Remove ${file.name}`}
                        title="Remove"
                        onPress={() =>
                          patch({ attachments: attachments.filter((candidate) => candidate.id !== file.id) })
                        }
                      >
                        <X className="size-3.5" />
                      </IconButton>
                    }
                  />
                </Fragment>
              );
            })}
          </CellGroup>
        ) : (
          <p className="text-body text-muted">No files attached.</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Relations</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{task.relations.length}</span>
        </div>
        {task.relations.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {task.relations.map((relation) => {
              const meta = RELATION_META[relation.type];
              const Icon = meta.icon;
              const target = state.tasks.find((candidate) => candidate.id === relation.id);
              return (
                <li key={`${relation.type}-${relation.id}`} className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-meta',
                      meta.tone,
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    {meta.label}
                  </span>
                  {target ? (
                    <RecordLink
                      route={pathFor('research/tasks/:taskId', { taskId: target.id })}
                      className="flex min-w-0 items-center gap-1.5 text-link hover:underline"
                    >
                      <span className="shrink-0 text-meta tabular-nums">{target.key}</span>
                      <span className="truncate text-body">{target.title}</span>
                    </RecordLink>
                  ) : (
                    <span className="text-meta tabular-nums text-muted">{relation.id}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-body text-muted">Nothing links to this task.</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
        <div className="flex items-baseline gap-2">
          <SectionLabel>Comments</SectionLabel>
          <span className="text-meta tabular-nums text-muted">{task.comments.length}</span>
        </div>
        {topLevel.length > 0 ? (
          <ul className="flex flex-col gap-4">
            <AnimatePresence initial={false}>
              {topLevel.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  replies={repliesOf(comment.id)}
                  replyOpen={replyTo === comment.id}
                  replyDraft={replyDraft}
                  onToggleReaction={toggleReaction}
                  onToggleReply={toggleReply}
                  onReplyDraft={setReplyDraft}
                  onSendReply={sendReply}
                />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="text-body text-muted">No comments yet.</p>
        )}
        <div className="mt-1 flex flex-col gap-2">
          <TextArea
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment…"
            aria-label="New comment"
            className="w-full"
          />
          <Button
            variant="primary"
            size="sm"
            isDisabled={!canSend}
            onPress={send}
            className="ml-auto gap-1.5"
          >
            <SendHorizontal className="size-3.5" aria-hidden />
            Send
          </Button>
        </div>
      </section>

      <RenameModal
        open={renameOpen}
        title="Rename task"
        value={task.title}
        onClose={() => setRenameOpen(false)}
        onSubmit={(value) => {
          patch({ title: value });
          notify(`Renamed to “${value}”`);
        }}
      />
      {field === 'wave' && (
        <ChoiceModal
          open
          title="Move to wave"
          label="Wave"
          value={task.waveId ?? ''}
          options={waveOptions}
          onClose={() => setField(null)}
          onSubmit={(value) => {
            patch({ waveId: value || null });
            notify(
              value
                ? `Moved to ${state.waves.find((wave) => wave.id === value)?.name ?? 'a wave'}`
                : 'Moved out of the wave',
            );
          }}
        />
      )}
      {estimateOpen && (
        <RenameModal
          open
          title="Set estimate"
          label="Days"
          value={task.estimate === null ? '' : String(task.estimate)}
          onClose={() => setEstimateOpen(false)}
          onSubmit={(value) => {
            const days = Number(value.trim());
            if (!Number.isFinite(days) || days < 0) {
              notify('An estimate is a number of days', { tone: 'warning' });
              return;
            }
            patch({ estimate: Math.round(days) });
            notify(`Estimated at ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`);
            setEstimateOpen(false);
          }}
        />
      )}
      {field === 'due' && (
        <DateModal
          open
          title="Set due date"
          label="Due date"
          value={task.dueDate}
          onClose={() => setField(null)}
          onSubmit={(value) => {
            patch({ dueDate: value });
            notify(value ? `Due date set to ${value}` : 'Due date cleared');
          }}
        />
      )}
    </RecordPage>
  );
}

/** A task's page; an unknown id gets the shared not-found state. */
export function TaskDetail({ taskId }: { taskId: string }) {
  const { state } = useApp();
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return <RecordMissing what="task" back="research/tasks" backLabel="Tasks" />;
  }
  return <TaskDetailBody key={task.id} task={task} />;
}
