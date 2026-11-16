/**
 * The composer.
 *
 * The placeholder is documentation, not decoration: `@` pulls in records, files and skills,
 * `/` opens commands and skills, `!` runs a shell command, `#` inserts a snippet. Those
 * prefixes are the whole command surface, so they belong where the user types — and the
 * buttons that insert them do exactly that, at the cursor.
 *
 * The controls are one `sm` row: what the agent may do is a segmented control, because
 * three exclusive options should show which one is current without being opened; the
 * session model is a searchable popover, because the registry outgrew a flat select; and
 * effort is a small select with a brain on its trigger. Attachments are real paths picked
 * from the OS dialog, and guarded mode is a real toggle the engine reads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  CornerDownLeft,
  Database as DatabaseGlyph,
  FileText,
  FlaskConical,
  Hammer,
  ListChecks,
  Map,
  MessageCircleQuestion,
  Mic,
  MicOff,
  Paperclip,
  Rocket,
  Server,
  ShieldCheck,
  ShieldOff,
  Slash,
  Square,
  Terminal,
  Wand2,
  Waves,
  X,
} from 'lucide-react';

import {
  Button,
  Chip,
  IconButton,
  NavSection,
  Popover,
  Row,
  RowList,
  ScrollShadow,
  SearchField,
  Select,
  Spinner,
  Surface,
  TextArea,
  Tip,
  ToggleButton,
  ToggleButtonGroup,
} from '@/components/ui';
import { cn } from '@/lib/cn';

import { fileName, pickFiles } from '@/lib/workspace';
import { invokeCommand } from '@/lib/ipc';
import { executionPayload } from '@/lib/execution';
import { allCommands, useCommands, type SlashCommand } from '@/lib/commands/commands';
import {
  MENTION_KINDS,
  mentionKind,
  referencesFrom,
  type MentionKind,
  type Reference,
} from '@/lib/chat/references';
import { BUILTIN_SCIENCE_SKILLS } from '@/lib/science/skills';
import { useExperiments } from '@/components/experiments/store';
import { useDatabases } from '@/components/databases/store';
import { useApp } from '@/store/app';
import { MOTION } from '@/theme/tokens';
import { activeProject, allProviders, type AgentMode, type ReasoningEffort } from '@/store/types';

/** Modes the agent accepts. The icon is what the row shows; the label names it on hover. */
const MODES: { value: AgentMode; label: string; hint: string; icon: LucideIcon; tint: string }[] = [
  {
    value: 'agent',
    label: 'Build',
    hint: 'Works in the lab: reads, writes, runs.',
    icon: Hammer,
    tint: 'text-accent',
  },
  {
    value: 'plan',
    label: 'Plan',
    hint: 'Agrees on the method first.',
    icon: Map,
    tint: 'text-warning',
  },
  {
    value: 'ask',
    label: 'Ask',
    hint: 'Answers, changes nothing.',
    icon: MessageCircleQuestion,
    tint: 'text-accent-secondary',
  },
];

/** Reasoning effort. */
const EFFORTS = [
  { value: 'off' as ReasoningEffort, label: 'No thinking' },
  { value: 'low' as ReasoningEffort, label: 'Low effort' },
  { value: 'medium' as ReasoningEffort, label: 'Medium effort' },
  { value: 'high' as ReasoningEffort, label: 'High effort' },
];

/** One provider's slice of the model picker. */
interface ModelGroup {
  id: string;
  label: string;
  models: { ref: string; label: string }[];
}

/** How many models the picker renders at once, before the query has to narrow it. */
const MAX_PICKER_MODELS = 400;

/** The icon each kind of record wears in the menu, the way its own screen draws it. */
const MENTION_ICON: Record<MentionKind, LucideIcon> = {
  job: Rocket,
  target: Server,
  experiment: FlaskConical,
  database: DatabaseGlyph,
  task: ListChecks,
  wave: Waves,
};

/** One row in the `@` mention menu: a kind, a record, a workspace file or a bundled skill. */
interface MentionItem {
  key: string;
  label: string;
  hint: string;
  /** The text dropped into the draft, e.g. `@src/app.ts` or `@job:j-1a2b3c4d`. Empty: not chooseable. */
  insert: string;
  icon: LucideIcon;
  /**
   * A row that names a kind rather than one record. Choosing it inserts `@job:` and leaves the
   * menu open on that kind's records, so the id is picked rather than typed.
   */
  opens?: MentionKind;
}

/** How many `@` suggestions to show at once. */
const MAX_MENTIONS = 40;

/** Speech recognition is vendor-prefixed in every engine that ships it. */
type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function speechRecognition(): SpeechCtor | undefined {
  const scope = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/**
 * The session model, as a searchable popover.
 *
 * A flat select stopped scaling once the registry grew past a couple of vendors, so the
 * list is grouped by provider and filtered as you type. Selection is programmatic: the
 * popover closes on the choice, which is why the wrapper takes controlled open state.
 */
function ModelPicker({ modelRef, onSelect }: { modelRef: string; onSelect: (ref: string) => void }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const all = useMemo(() => allProviders(state), [state.customProviders, state.catalogProviders]);

  // Only what the user can actually reach: a provider with a key, a loopback server, or an
  // endpoint that takes no key. Searching all 226 providers just surfaces models that fail
  // the moment they are picked.
  const reachable = useMemo(
    () =>
      all.filter(
        (provider) =>
          Boolean(state.providerKeys[provider.id]) || provider.protocol === 'local' || !provider.requiresKey,
      ),
    [all, state.providerKeys],
  );

  const { groups, capped } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out: ModelGroup[] = [];
    let shown = 0;
    let capped = false;
    // A connected catalog can still hold hundreds of models; render a working slice and let
    // the query narrow the rest, rather than mounting every row on open.
    for (const provider of reachable) {
      if (provider.models.length === 0) continue;
      const models = provider.models
        .filter((model) => `${provider.label} ${model.label}`.toLowerCase().includes(needle))
        .map((model) => ({ ref: `${provider.id}/${model.id}`, label: model.label }));
      if (models.length === 0) continue;
      const room = MAX_PICKER_MODELS - shown;
      out.push({ id: provider.id, label: provider.label, models: models.slice(0, room) });
      shown += Math.min(models.length, room);
      if (shown >= MAX_PICKER_MODELS) {
        capped = true;
        break;
      }
    }
    return { groups: out, capped };
  }, [reachable, query]);

  const current = useMemo(() => {
    for (const provider of all) {
      const model = provider.models.find((candidate) => `${provider.id}/${candidate.id}` === modelRef);
      if (model) return model.label;
    }
    return modelRef;
  }, [all, modelRef]);

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      placement="top end"
      className="w-[320px]"
      trigger={
        <Button size="sm" variant="secondary" className="rounded-full" aria-label="Session model">
          <span className="max-w-[128px] truncate">{current}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
        </Button>
      }
    >
      <div className="flex flex-col gap-2 p-2">
        <SearchField
          aria-label="Search models"
          variant="secondary"
          value={query}
          onChange={setQuery}
          className="rounded-full"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search models" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <ScrollShadow className="max-h-[280px]">
          <RowList
            label="Models"
            selectionMode="single"
            selectedKeys={[modelRef]}
            onSelectionChange={(keys) => {
              const [next] = keys;
              if (next) {
                onSelect(next);
                setOpen(false);
              }
            }}
          >
            {groups.map((group) => (
              <NavSection key={group.id} title={group.label}>
                {group.models.map((model) => (
                  <Row key={model.ref} id={model.ref} textValue={model.label}>
                    <span className="min-w-0 flex-1 truncate text-body">{model.label}</span>
                    {model.ref === modelRef && (
                      <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
                    )}
                  </Row>
                ))}
              </NavSection>
            ))}
          </RowList>
        </ScrollShadow>

        {groups.length === 0 ? (
          <p className="px-2 pb-1 text-meta text-muted">
            No connected provider. Add a key in Settings → Providers to pick a model.
          </p>
        ) : (
          capped && <p className="px-2 text-meta text-muted">Keep typing to narrow the list.</p>
        )}
      </div>
    </Popover>
  );
}

/** Prompt input plus the controls that qualify a request. */
export function Composer({
  placeholder,
  onStarted,
}: {
  /** The line the empty field shows. The session keeps its own. */
  placeholder?: string;
  /** Called with the session id as the turn starts, so a screen without one can follow it. */
  onStarted?: (sessionId: string) => void;
} = {}) {
  const { state, dispatch, send, stop } = useApp();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Shell mode: the island becomes a place to run a command in the workspace. One green band
  // sweeps across on entry, and the result shows above the input then fades like a toast.
  const reducedMotion = useReducedMotion();
  const [shell, setShell] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const [shellResult, setShellResult] = useState<{
    command: string;
    output: string;
    exitCode: number;
  } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);

  // `@` mentions: the token being typed, the records and files behind it, and the row lit up.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionAt, setMentionAt] = useState(0);
  const [files, setFiles] = useState<string[] | null>(null);

  // The experiment ledger and the database catalogue are their own stores, so they are read
  // here rather than through the app state the other three record lists live in.
  const experiments = useExperiments();
  const databases = useDatabases();
  const references = useMemo(
    () =>
      referencesFrom({
        jobs: state.jobs,
        targets: state.targets,
        tasks: state.tasks,
        waves: state.waves,
        experiments,
        databases,
      }),
    [state.jobs, state.targets, state.tasks, state.waves, experiments, databases],
  );

  // `/` commands: the same shape, over the command registry.
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  const [slashAt, setSlashAt] = useState(0);
  const commands = useCommands();

  const workspacePath = activeProject(state)?.path ?? null;
  const workspaceName = workspacePath?.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace';

  // Grow with the content, up to a point, then scroll.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [state.draft]);

  // A menu is anchored to the token being typed. Sending empties the draft from the store
  // rather than from a keystroke, so without this the menu would outlive the message it fed.
  useEffect(() => {
    if (!state.draft) {
      setMention(null);
      setSlash(null);
    }
  }, [state.draft]);

  // The file list behind `@`, fetched once per workspace the first time it is asked for.
  useEffect(() => {
    if (!mention || files !== null || !workspacePath) {
      return;
    }
    let alive = true;
    void invokeCommand<string[]>('glob_files', { pattern: '**/*', root: workspacePath, path: null }).then(
      (result) => {
        if (alive && result.ok) {
          setFiles(result.value);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [mention, files, workspacePath]);

  // A command's output is a glance, not a record: show it, then let it go.
  useEffect(() => {
    if (!shellResult) {
      return;
    }
    const timer = window.setTimeout(() => setShellResult(null), 8000);
    return () => window.clearTimeout(timer);
  }, [shellResult]);

  /** Insert text at the caret and keep focus, so the prefix buttons feel like typing. */
  const insertAtCursor = useCallback(
    (text: string) => {
      const element = textareaRef.current;
      const current = state.draft;
      const at = element?.selectionStart ?? current.length;
      const next = `${current.slice(0, at)}${text}${current.slice(element?.selectionEnd ?? at)}`;
      dispatch({ type: 'draft/changed', value: next });
      requestAnimationFrame(() => {
        element?.focus();
        const caret = at + text.length;
        element?.setSelectionRange(caret, caret);
      });
    },
    [state.draft, dispatch],
  );

  /** What `@query` matches: the record kinds, then their records, then skills and files. */
  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!mention) {
      return [];
    }
    const fileItems: MentionItem[] = (files ?? []).map((path) => ({
      key: `file:${path}`,
      label: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      hint: path,
      insert: `@${path}`,
      icon: FileText,
    }));
    const skillItems: MentionItem[] = BUILTIN_SCIENCE_SKILLS.map((skill) => ({
      key: `skill:${skill.id}`,
      label: skill.name,
      hint: `skill · ${skill.category}`,
      insert: `@skill:${skill.id}`,
      icon: Wand2,
    }));

    // `@job:` names a kind, so the menu switches to that kind's records and the id is picked
    // rather than typed. Everything after the colon narrows them.
    const typed = /^([a-z]+):(.*)$/i.exec(mention.query);
    const kind = typed ? mentionKind(typed[1]!) : undefined;
    if (kind) {
      const needle = typed![2]!.trim().toLowerCase();
      const meta = MENTION_KINDS.find((candidate) => candidate.kind === kind)!;
      const rows = references
        .filter((reference) => reference.kind === kind)
        .filter(
          (reference) =>
            !needle ||
            `${reference.label} ${reference.detail} ${reference.id}`.toLowerCase().includes(needle),
        )
        .slice(0, MAX_MENTIONS)
        .map((reference: Reference): MentionItem => ({
          key: `${reference.kind}:${reference.id}`,
          label: reference.label,
          hint: `@${reference.kind}:${reference.id} · ${reference.detail}`,
          insert: `@${reference.kind}:${reference.id}`,
          icon: MENTION_ICON[reference.kind],
        }));
      // Nothing to name yet is worth saying, since a menu that simply vanishes reads as a bug.
      return rows.length > 0
        ? rows
        : [
            {
              key: `empty:${kind}`,
              label: needle ? `No ${meta.label} matches that` : `No ${meta.label} yet`,
              hint: meta.noun,
              insert: '',
              icon: MENTION_ICON[kind],
            },
          ];
    }

    const needle = mention.query.toLowerCase();
    const matches = (item: MentionItem) =>
      !needle || `${item.label} ${item.hint}`.toLowerCase().includes(needle);
    const kindRows: MentionItem[] = MENTION_KINDS.filter(
      (meta) => !needle || `${meta.label} ${meta.noun}`.toLowerCase().includes(needle),
    ).map((meta) => ({
      key: `kind:${meta.kind}`,
      label: `@${meta.label}:`,
      hint: meta.noun,
      insert: `@${meta.label}:`,
      icon: MENTION_ICON[meta.kind],
      opens: meta.kind,
    }));

    return [...kindRows, ...skillItems.filter(matches), ...fileItems.filter(matches)].slice(0, MAX_MENTIONS);
  }, [mention, files, references]);

  /** What `/query` matches: every command, built-in and project alike. */
  const slashItems = useMemo<SlashCommand[]>(() => {
    if (!slash) return [];
    const needle = slash.query.toLowerCase();
    return allCommands()
      .filter((command) => !needle || `${command.name} ${command.description}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [slash, commands]);

  /** Keep the draft and the mention menu in step as the user types. */
  const onDraftChange = (value: string, caret: number) => {
    // A leading `!` is the shell switch, not content.
    if (!shell && value.startsWith('!')) {
      setShell(true);
      dispatch({ type: 'draft/changed', value: value.replace(/^!\s*/, '') });
      setMention(null);
      return;
    }
    dispatch({ type: 'draft/changed', value });

    // A mention is an `@` at a word boundary followed by a single unbroken token. Anchoring
    // on the boundary keeps an email address from opening the menu.
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    const token = at >= 0 ? before.slice(at + 1) : '';
    const boundary = at === 0 || (at > 0 && /\s/.test(before[at - 1] ?? ''));
    if (at >= 0 && boundary && !/[\s@]/.test(token) && token.length <= 64) {
      setMention({ start: at, query: token });
      setMentionAt(0);
      setSlash(null);
      return;
    }
    setMention(null);

    // A command is a `/` at a word boundary followed by one word: the name, before the
    // arguments start. `/` inside a path is not at a boundary, so a path never opens it.
    const slashAt = before.lastIndexOf('/');
    const word = slashAt >= 0 ? before.slice(slashAt + 1) : '';
    const slashBoundary = slashAt === 0 || (slashAt > 0 && /\s/.test(before[slashAt - 1] ?? ''));
    if (slashAt >= 0 && slashBoundary && !/[\s/]/.test(word) && word.length <= 32) {
      setSlash({ start: slashAt, query: word });
      setSlashAt(0);
    } else {
      setSlash(null);
    }
  };

  /** Drop a chosen command in place of the `/query` being typed. */
  const applyCommand = (command: SlashCommand) => {
    const element = textareaRef.current;
    const value = state.draft;
    const caret = element?.selectionStart ?? value.length;
    const start = slash?.start ?? caret;
    const insert = `/${command.name} `;
    const next = `${value.slice(0, start)}${insert}${value.slice(caret)}`;
    dispatch({ type: 'draft/changed', value: next });
    setSlash(null);
    const position = start + insert.length;
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  };

  /** Drop a chosen mention in place of the `@query` being typed. */
  const applyMention = (item: MentionItem) => {
    // A row saying there is nothing to name inserts nothing; choosing it puts the menu away.
    if (!item.insert) {
      setMention(null);
      return;
    }
    const element = textareaRef.current;
    const value = state.draft;
    const caret = element?.selectionStart ?? value.length;
    const start = mention?.start ?? caret;
    // A kind row is a step, not a choice: it inserts `@job:` with no trailing space and keeps
    // the menu open, so the next keystrokes are the record's name.
    const insert = item.opens ? item.insert : `${item.insert} `;
    const next = `${value.slice(0, start)}${insert}${value.slice(caret)}`;
    dispatch({ type: 'draft/changed', value: next });
    if (item.opens) {
      setMention({ start, query: item.insert.slice(1) });
      setMentionAt(0);
    } else {
      setMention(null);
    }
    const position = start + insert.length;
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  };

  /** Run the draft as a shell command in the workspace and surface its output briefly. */
  const runShell = async () => {
    const command = state.draft.trim();
    if (!command || !workspacePath || shellBusy) {
      return;
    }
    setShellBusy(true);
    setMention(null);
    setShellResult(null);
    dispatch({ type: 'draft/changed', value: '' });
    setHistory((past) => [command, ...past].slice(0, 50));
    setHistoryAt(-1);

    const result = await invokeCommand<{ output: string; exitCode: number }>('run_command', {
      command,
      cwd: null,
      root: workspacePath,
      execution: executionPayload(state.execution),
    });
    setShellResult(
      result.ok
        ? { command, output: result.value.output, exitCode: result.value.exitCode }
        : { command, output: result.error.message, exitCode: -1 },
    );
    setShellBusy(false);
  };

  const attach = useCallback(async () => {
    const picked = await pickFiles();
    if (picked.length === 0) {
      setNotice('The file picker is only available in the desktop app.');
      window.setTimeout(() => setNotice(null), 2600);
      return;
    }
    picked.forEach((path) => dispatch({ type: 'attachment/add', path }));
  }, [dispatch]);

  const dictate = useCallback(() => {
    const Recognition = speechRecognition();
    if (!Recognition) {
      setNotice('This build has no speech recognition available.');
      window.setTimeout(() => setNotice(null), 2600);
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (transcript) {
        insertAtCursor(transcript);
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
    setListening(true);
  }, [listening, insertAtCursor]);

  const canSend = state.draft.trim().length > 0 && !state.running;
  const canRunShell = state.draft.trim().length > 0 && !shellBusy;
  /** When the current turn started, so each send gets its own glow rather than one long one. */
  const runStartedAt = state.activeSessionId ? state.runs[state.activeSessionId]?.startedAt : undefined;
  /**
   * Whether the agent has begun answering.
   *
   * The glow is the wait, not the work: the moment the first prose arrives the answer is on
   * screen, and a ring still asking to be waited for would be lying.
   */
  const last = state.messages[state.messages.length - 1];
  const answering = last?.role === 'assistant' && last.blocks.some((block) => block.kind === 'text');
  const waiting = state.running && !answering;

  return (
    <div className="px-6 pb-5">
      <div className="relative mx-auto w-full max-w-[760px]">
        <AnimatePresence>
          {slash && slashItems.length > 0 && !shellResult && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: MOTION.duration.entrance, ease: MOTION.signature }}
              className="absolute bottom-full start-0 z-20 mb-2 w-full max-w-[560px] overflow-hidden rounded-2xl border border-border bg-surface"
            >
              <div className="flex items-center gap-2 px-3 py-2 text-meta text-muted">
                <Slash className="size-3.5" aria-hidden />
                Run a command
              </div>
              <ScrollShadow className="max-h-[260px]">
                {slashItems.map((command, index) => (
                  <button
                    key={command.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyCommand(command);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-start',
                      index === slashAt ? 'bg-surface-secondary' : 'hover:bg-surface-secondary',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="font-mono text-body text-foreground">/{command.name}</span>
                        {command.argumentHint && (
                          <span className="text-meta text-muted">{command.argumentHint}</span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-meta text-muted">
                        {command.description}
                      </span>
                    </span>
                    {command.source !== 'builtin' && (
                      <Chip size="sm" variant="soft" color="default">
                        {command.source}
                      </Chip>
                    )}
                  </button>
                ))}
              </ScrollShadow>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {mention && mentionItems.length > 0 && !shellResult && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: MOTION.duration.entrance, ease: MOTION.signature }}
              className="absolute bottom-full start-0 z-20 mb-2 w-full max-w-[520px] overflow-hidden rounded-2xl border border-border bg-surface"
            >
              <div className="flex items-center gap-2 px-3 py-2 text-meta text-muted">
                <AtSign className="size-3.5" aria-hidden />
                Mention a record, a file or a skill
              </div>
              <ScrollShadow className="max-h-[260px]">
                {mentionItems.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-disabled={!item.insert}
                      onMouseDown={(event) => {
                        // Prevent the textarea losing focus before the click lands.
                        event.preventDefault();
                        applyMention(item);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-start',
                        index === mentionAt ? 'bg-surface-secondary' : 'hover:bg-surface-secondary',
                        !item.insert && 'cursor-default',
                      )}
                    >
                      <Icon
                        className={cn('size-3.5 shrink-0 text-muted', item.opens && 'text-accent')}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-body',
                          item.opens ? 'font-mono text-accent' : 'text-foreground',
                          !item.insert && 'text-muted italic',
                        )}
                      >
                        {item.label}
                      </span>
                      <span className="min-w-0 max-w-[55%] truncate text-meta text-muted">{item.hint}</span>
                    </button>
                  );
                })}
              </ScrollShadow>
            </motion.div>
          )}
        </AnimatePresence>

        {/* A command's output, above the input and gone in a few seconds. */}
        <AnimatePresence>
          {shellResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
              className="absolute bottom-full start-0 z-30 mb-2 w-full overflow-hidden rounded-2xl border border-success/30 bg-surface"
            >
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="shrink-0 font-mono text-meta text-success">$</span>
                <span className="min-w-0 flex-1 truncate font-mono text-meta text-foreground">
                  {shellResult.command}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-meta tabular-nums',
                    shellResult.exitCode === 0 ? 'text-muted' : 'text-danger',
                  )}
                >
                  {shellResult.exitCode}
                </span>
                <IconButton aria-label="Dismiss output" onPress={() => setShellResult(null)}>
                  <X className="size-3.5" />
                </IconButton>
              </div>
              {shellResult.output && (
                <pre className="max-h-[220px] overflow-y-auto px-3 pb-2 font-mono text-meta leading-relaxed whitespace-pre-wrap text-foreground/90">
                  {shellResult.output}
                </pre>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* The wait, drawn on the input: bright the moment a turn is sent, hushing until the
            answer starts, then out. Keyed per run, so every send breathes once. */}
        <AnimatePresence>
          {waiting && runStartedAt !== undefined && (
            <motion.span
              key={runStartedAt}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: MOTION.signature }}
              aria-hidden
              className="composer-glow pointer-events-none absolute inset-0 rounded-3xl"
            />
          )}
        </AnimatePresence>

        <motion.div
          animate={{
            backgroundColor: shell
              ? 'color-mix(in oklch, var(--success) 8%, var(--surface))'
              : 'var(--surface)',
          }}
          transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
          className={cn(
            'relative overflow-hidden rounded-3xl border transition-colors',
            shell ? 'border-success/40' : 'border-border',
          )}
        >
          {/* The way into shell mode: one green band sweeps across once, then leaves only the
              tint behind. A mechanical mode change, marked rather than performed. */}
          {shell && !reducedMotion && (
            <motion.div
              aria-hidden
              initial={{ x: '0%' }}
              animate={{ x: '350%' }}
              transition={{ duration: 1.35, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-y-[-25%] left-0 w-[30%] rotate-[8deg]"
              style={{
                background:
                  'linear-gradient(90deg, rgba(15,191,119,0) 0%, rgba(15,191,119,0.55) 30%, rgba(157,247,205,0.95) 50%, rgba(15,191,119,0.55) 70%, rgba(15,191,119,0) 100%)',
                filter: 'blur(6px)',
                opacity: 0.85,
              }}
            />
          )}

          {state.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {state.attachments.map((path) => {
                const name = fileName(path);
                const dot = name.lastIndexOf('.');
                const base = dot > 0 ? name.slice(0, dot) : name;
                const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : 'file';
                return (
                  <Surface
                    key={path}
                    variant="secondary"
                    className="group flex max-w-[248px] items-center gap-2.5 rounded-xl p-1.5 pe-2"
                  >
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-lg bg-background text-muted"
                      aria-hidden
                    >
                      <FileText className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label font-medium text-foreground" title={path}>
                        {base}
                      </span>
                      <span className="block truncate text-meta text-muted">{extension}</span>
                    </span>
                    <IconButton
                      aria-label={`Remove ${name}`}
                      onPress={() => dispatch({ type: 'attachment/remove', path })}
                      className="size-6 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
                    >
                      <X className="size-3.5" />
                    </IconButton>
                  </Surface>
                );
              })}
            </div>
          )}

          <TextArea
            variant="secondary"
            ref={textareaRef}
            value={state.draft}
            onChange={(event) => {
              const element = event.target as HTMLTextAreaElement;
              onDraftChange(element.value, element.selectionStart ?? element.value.length);
            }}
            onKeyDown={(event) => {
              // The mention menu owns the arrows and Enter while it is open.
              if (mention && mentionItems.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setMentionAt((index) => Math.min(index + 1, mentionItems.length - 1));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setMentionAt((index) => Math.max(index - 1, 0));
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  applyMention(mentionItems[mentionAt] ?? mentionItems[0]!);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMention(null);
                  return;
                }
              }

              // The command menu owns the arrows and Enter while it is open.
              if (slash && slashItems.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSlashAt((index) => Math.min(index + 1, slashItems.length - 1));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSlashAt((index) => Math.max(index - 1, 0));
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  applyCommand(slashItems[slashAt] ?? slashItems[0]!);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSlash(null);
                  return;
                }
              }

              if (shell) {
                // Recall past commands the way a terminal does.
                if (event.key === 'ArrowUp' && history.length > 0) {
                  event.preventDefault();
                  const index = Math.min(historyAt + 1, history.length - 1);
                  setHistoryAt(index);
                  dispatch({ type: 'draft/changed', value: history[index] ?? '' });
                  return;
                }
                if (event.key === 'ArrowDown' && historyAt >= 0) {
                  event.preventDefault();
                  const index = historyAt - 1;
                  setHistoryAt(index);
                  dispatch({ type: 'draft/changed', value: index < 0 ? '' : (history[index] ?? '') });
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setShell(false);
                  setMention(null);
                  return;
                }
              }

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (shell) {
                  void runShell();
                } else {
                  void send(undefined, onStarted);
                }
              }
            }}
            rows={1}
            placeholder={
              shell
                ? `Run a command in ${workspaceName}…`
                : (placeholder ?? 'Ask about your data, your literature, or the manuscript…')
            }
            /* A bare field: the island is the only surface. HeroUI rings a focused field, which is
               right for a form and wrong for the one control that is always focused. */
            className="max-h-[180px] min-h-[46px] w-full resize-none border-0 bg-transparent px-3.5 py-2.5 text-body leading-relaxed text-foreground shadow-none outline-none focus:ring-0! focus:shadow-none! focus-visible:ring-0! outline-none! placeholder:text-field-placeholder"
          />

          {/* Both rows share one fixed-height box, so the swap is a swap and not a jump. The
              band above is the only moment the change gets; the controls do not animate. */}
          <div className="relative mx-2.5 mb-2.5 h-8">
            {shell ? (
              <div className="absolute inset-0 flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-1 text-meta text-success">
                  <Terminal className="size-3.5" aria-hidden />
                  shell
                </span>
                <span className="min-w-0 truncate text-meta text-muted" title={workspacePath ?? ''}>
                  {workspaceName}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Tip content="Leave shell mode">
                    <IconButton aria-label="Leave shell mode" onPress={() => setShell(false)}>
                      <X className="size-[15px]" />
                    </IconButton>
                  </Tip>
                  <Button
                    variant="primary"
                    size="sm"
                    className="gap-1.5 bg-success! text-success-foreground!"
                    isDisabled={!canRunShell}
                    onPress={() => void runShell()}
                    aria-label="Run command"
                  >
                    {shellBusy ? <Spinner /> : <CornerDownLeft className="size-3.5" />}
                    Run
                  </Button>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center gap-1">
                <div className="flex items-center gap-0.5">
                  <Tip content="Attach files">
                    <IconButton aria-label="Attach files" onPress={() => void attach()}>
                      <Paperclip className="size-[15px]" />
                    </IconButton>
                  </Tip>
                  <Tip
                    content={
                      state.guarded
                        ? 'Guarded: the agent asks before writing or reaching the network'
                        : 'Unguarded: the agent acts without asking'
                    }
                  >
                    <IconButton
                      aria-label="Guarded mode"
                      active={state.guarded}
                      onPress={() => dispatch({ type: 'guarded/toggled' })}
                    >
                      {state.guarded ? (
                        <ShieldCheck className="size-[15px]" />
                      ) : (
                        <ShieldOff className="size-[15px]" />
                      )}
                    </IconButton>
                  </Tip>
                  <Tip content="Shell mode (!)">
                    <IconButton aria-label="Run a command" onPress={() => setShell(true)}>
                      <Terminal className="size-[15px]" />
                    </IconButton>
                  </Tip>
                  <Tip content="Mention a file or a skill (@)">
                    <IconButton
                      aria-label="Add context"
                      onPress={() => {
                        const element = textareaRef.current;
                        const at = element?.selectionStart ?? state.draft.length;
                        insertAtCursor('@');
                        setMention({ start: at, query: '' });
                        setMentionAt(0);
                      }}
                    >
                      <AtSign className="size-[15px]" />
                    </IconButton>
                  </Tip>
                </div>

                <div className="ml-auto flex items-center justify-end gap-1.5">
                  {/* The mode sits beside the effort and the model, because all three answer the
                      same question: how should this run? Each carries its own colour, and the one
                      you are in says its name — a row of three unlabelled glyphs tells you what
                      you may choose and not what you chose. */}
                  <ToggleButtonGroup
                    aria-label="What the agent is allowed to do"
                    size="sm"
                    selectionMode="single"
                    selectedKeys={[state.mode]}
                    onSelectionChange={(keys) => {
                      const [next] = keys as Set<string>;
                      if (next) dispatch({ type: 'model/mode', mode: next as AgentMode });
                    }}
                  >
                    {MODES.map((option) => {
                      const Icon = option.icon;
                      const active = state.mode === option.value;
                      return (
                        <ToggleButton
                          key={option.value}
                          id={option.value}
                          aria-label={option.hint}
                          title={option.hint}
                          className={cn('gap-1.5 text-meta', active && option.tint)}
                        >
                          <Icon className="size-3.5" aria-hidden />
                          {active && option.label}
                        </ToggleButton>
                      );
                    })}
                  </ToggleButtonGroup>

                  {/* HeroUI's Select has no `size`, so the one layout-only height override in
                      this file brings its trigger down to the `sm` row (h-8). */}
                  <Select
                    variant="secondary"
                    label="How hard the model should think"
                    value={state.reasoning}
                    options={EFFORTS}
                    onChange={(value) => dispatch({ type: 'model/reasoning', effort: value })}
                    renderValue={(option) => (
                      <span className="flex items-center gap-1.5">
                        <Brain className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{option?.label}</span>
                      </span>
                    )}
                    className="w-[162px] [&_[data-slot='select-trigger']]:h-8 [&_[data-slot='select-trigger']]:min-h-8 [&_[data-slot='select-trigger']]:py-0"
                  />

                  <ModelPicker
                    modelRef={state.modelRef}
                    onSelect={(modelRef) => dispatch({ type: 'model/selected', modelRef })}
                  />

                  <Tip content={listening ? 'Stop dictating' : 'Dictate'}>
                    <IconButton aria-label="Dictate" active={listening} onPress={dictate}>
                      {listening ? <MicOff className="size-[15px]" /> : <Mic className="size-[15px]" />}
                    </IconButton>
                  </Tip>

                  {state.running ? (
                    <Button variant="danger" size="sm" isIconOnly onPress={stop} aria-label="Stop">
                      <Square className="size-3.5 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      isIconOnly
                      onPress={() => void send(undefined, onStarted)}
                      isDisabled={!canSend}
                      aria-label="Send"
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {notice && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-2 px-1 text-meta text-warning"
          >
            {notice}
          </motion.p>
        )}
      </div>
    </div>
  );
}
