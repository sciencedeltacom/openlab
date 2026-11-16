/**
 * The command palette.
 *
 * With this many surfaces, the sidebar stops being enough: you know the name of the thing you
 * want and you should not have to remember which section it was filed under. So the palette
 * searches two kinds of thing at once — the route tree, and the workspace's own data: reviews,
 * sources, databases, tasks, studies, programs, waves, saved views, sessions, results, jobs and
 * targets.
 *
 * It is drawn after the Apple Spotlight, but animated the cheap way: opacity and transform only,
 * no SVG filter and no layout animation. A gooey filter or a `layout` container re-measures and
 * re-rasterises the whole subtree every frame — smooth-looking in a demo, a stutter on a real
 * screen — so the search field and its circles keep their boxes and move inside them.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  BookMarked,
  CalendarRange,
  ChevronRight,
  Columns3,
  Database,
  FileText,
  FolderTree,
  LayoutGrid,
  ListChecks,
  Plug,
  Plus,
  Search,
  Sparkles,
  Sun,
  Timer,
  type LucideIcon,
} from 'lucide-react';

import { HIDDEN_VIEWS, PAGES, paths } from '@/app/routes';
import { useDatabases } from '@/components/databases/store';
import { REVIEWS } from '@/components/literature/data';
import { useReviews } from '@/components/literature/store';
import { ScrollShadow } from '@/components/ui';
import { useSources } from '@/hooks/useSources';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';

/** One row in the palette. */
interface Command {
  id: string;
  label: string;
  hint: string;
  group: string;
  icon: LucideIcon;
  run: () => void;
}

/** The circles that lift out of the search field on hover. */
const QUICK_ACTIONS: { icon: LucideIcon; label: string; route: string }[] = [
  { icon: LayoutGrid, label: 'Databases', route: 'library/databases' },
  { icon: FolderTree, label: 'Files', route: 'library/files' },
  { icon: Activity, label: 'Analytics', route: 'research/analytics' },
  { icon: FileText, label: 'Reviews', route: 'literature-reviews' },
];

/** Score a command against a query. Higher is better; 0 means no match. */
function score(command: Command, needle: string): number {
  const label = command.label.toLowerCase();
  if (label === needle) return 100;
  if (label.startsWith(needle)) return 90;
  if (label.includes(needle)) return 70;
  if (command.hint.toLowerCase().includes(needle)) return 40;
  if (command.group.toLowerCase().includes(needle)) return 20;
  return 0;
}

/** The placeholder that blurs away as the field fills, and the hovered row takes its place. */
function Placeholder({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 start-0 z-10 flex items-center">
      <AnimatePresence mode="popLayout">
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="text-[1.375rem] whitespace-nowrap text-muted"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** One result row: icon, label, its category, and a chevron that appears on hover. */
function ResultRow({
  icon: Icon,
  label,
  description,
  active,
  onHover,
  onRun,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  active: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onRun}
      className={cn(
        'group/card flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors',
        active ? 'bg-surface' : 'hover:bg-surface',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center text-foreground/70 [&_svg]:size-5">
        <Icon aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-foreground">{label}</span>
        <span className="truncate text-meta text-muted">{description}</span>
      </span>
      <span
        className={cn(
          'flex shrink-0 items-center transition-opacity duration-150',
          active ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100',
        )}
      >
        <ChevronRight className="size-5 text-muted" aria-hidden />
      </span>
    </button>
  );
}

/** The palette. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch, newSession } = useApp();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [hoveredResult, setHoveredResult] = useState<number | null>(null);
  const [hoveredShortcut, setHoveredShortcut] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useReviews();
  const sources = useSources();
  const databases = useDatabases();

  const go = (route: string) => () => {
    dispatch({ type: 'route/go', route });
    onClose();
  };

  const commands = useMemo<Command[]>(() => {
    // Every page. The strip pins six of them; the palette is the complete index, hidden
    // pages included, because it is what you reach for when you know the name and not
    // where it lives.
    const pages: Command[] = PAGES.map((item) => ({
      id: item.path,
      label: item.label,
      hint: 'Page',
      group: 'Pages',
      icon: item.icon,
      run: go(item.path),
    }));

    const hidden: Command[] = HIDDEN_VIEWS.map((view) => ({
      id: view.path,
      label: view.label,
      hint: 'Page',
      group: 'Pages',
      icon: view.icon,
      run: go(view.path),
    }));

    const actions: Command[] = [
      {
        id: 'action:new-session',
        label: 'New session',
        hint: 'Actions',
        group: 'Actions',
        icon: Plus,
        run: () => {
          // `newSession` already navigates to the new session's own route.
          newSession();
          onClose();
        },
      },
      {
        id: 'action:theme',
        label: 'Toggle appearance',
        hint: 'Actions',
        group: 'Actions',
        icon: Sun,
        run: () => dispatch({ type: 'theme/toggled' }),
      },
      {
        id: 'action:layout-board',
        label: 'Tracker: board layout',
        hint: 'Actions',
        group: 'Actions',
        icon: Columns3,
        run: () => {
          dispatch({ type: 'route/go', route: 'research/tasks' });
          dispatch({ type: 'task/layout', layout: 'board' });
          onClose();
        },
      },
      {
        id: 'action:layout-timeline',
        label: 'Tracker: timeline layout',
        hint: 'Actions',
        group: 'Actions',
        icon: CalendarRange,
        run: () => {
          dispatch({ type: 'route/go', route: 'research/tasks' });
          dispatch({ type: 'task/layout', layout: 'timeline' });
          onClose();
        },
      },
    ];

    // The workspace's own records. Each carries the route that opens it, so a hit is a jump.
    const data: Command[] = [
      ...REVIEWS.map((review) => ({
        id: `review:${review.id}`,
        label: review.question,
        hint: 'Review',
        group: 'Reviews',
        icon: ListChecks,
        run: go(`literature-reviews/${review.id}`),
      })),
      ...sources.map((source) => ({
        id: `source:${source.id}`,
        label: source.name,
        hint: 'Source',
        group: 'Sources',
        icon: FolderTree,
        run: go(paths.source(source.id)),
      })),
      ...databases.map((database) => ({
        id: `database:${database.id}`,
        label: database.name,
        hint: 'Database',
        group: 'Databases',
        icon: Database,
        run: go(paths.database(database.id)),
      })),
      ...state.tasks.map((task) => ({
        id: `task:${task.id}`,
        label: task.title,
        hint: `Task · ${task.key}`,
        group: 'Tasks',
        icon: ListChecks,
        run: go(paths.task(task.id)),
      })),
      ...state.waves.map((wave) => ({
        id: `wave:${wave.id}`,
        label: wave.name,
        hint: `Wave ${wave.number}`,
        group: 'Waves',
        icon: CalendarRange,
        run: go(paths.wave(wave.id)),
      })),
      ...state.views.map((view) => ({
        id: `view:${view.id}`,
        label: view.name,
        hint: 'Saved view',
        group: 'Views',
        icon: Columns3,
        run: go(paths.view(view.id)),
      })),
      ...state.sessions
        .filter((session) => !session.parentId)
        .map((session) => ({
          id: `session:${session.id}`,
          label: session.title,
          hint: 'Session',
          group: 'Sessions',
          icon: Sparkles,
          run: go(paths.session(session.id)),
        })),
      ...state.results.map((result) => ({
        id: `result:${result.id}`,
        label: result.name,
        hint: 'Saved result',
        group: 'Results',
        icon: BookMarked,
        run: go(paths.result(result.id)),
      })),
      ...state.jobs.map((job) => ({
        id: `job:${job.id}`,
        label: job.name,
        hint: 'Job',
        group: 'Jobs',
        icon: Timer,
        run: go(paths.job(job.id)),
      })),
      ...state.targets.map((target) => ({
        id: `target:${target.id}`,
        label: target.name,
        hint: 'Target',
        group: 'Targets',
        icon: Plug,
        run: go(paths.target(target.id)),
      })),
    ];

    return [...pages, ...hidden, ...actions, ...data];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, newSession, onClose, sources, databases, state]);

  const needle = query.trim().toLowerCase();

  /** The scored results, best first. No grouping — the category is the row's own subtitle. */
  const results = useMemo<Command[]>(() => {
    if (!needle) {
      return [];
    }
    return commands
      .map((command) => ({ command, value: score(command, needle) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value || a.command.label.localeCompare(b.command.label))
      .slice(0, 12)
      .map((entry) => entry.command);
  }, [commands, needle]);

  // Reset between openings so the palette never reopens mid-scroll from last time. The
  // element that had focus gets it back when the palette closes: a dialog that drops focus on
  // the body is a dead end for a keyboard reader.
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setHovered(false);
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => {
        window.clearTimeout(timer);
        previous?.focus();
      };
    }
  }, [open]);

  /** Keep Tab inside the dialog, the same way a native modal does. */
  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => setIndex(0), [query]);

  // Escape closes from anywhere, not just the field.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((current) => Math.min(current + 1, results.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((current) => Math.max(current - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      results[index]?.run();
    }
  };

  const placeholder =
    hoveredShortcut !== null && !query
      ? QUICK_ACTIONS[hoveredShortcut]!.label
      : hoveredResult !== null
        ? (results[hoveredResult]?.label ?? 'Search')
        : 'Search';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[14vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 480, damping: 36, mass: 0.7 }}
            ref={dialogRef}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={trapFocus}
            className="relative z-10 flex w-full max-w-3xl flex-col gap-2.5"
          >
            {/* The search field. The circles keep their boxes and fade in — no layout thrash. */}
            <div
              className="flex items-center gap-3 rounded-[28px] border border-separator bg-overlay px-6 shadow-[var(--island-shadow)] focus-within:ring-2 focus-within:ring-accent/40"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => {
                setHovered(false);
                setHoveredShortcut(null);
              }}
            >
              <Search className="size-6 shrink-0 text-muted" aria-hidden />
              <div className="relative h-16 flex-1">
                {!query && <Placeholder text={placeholder} />}
                <input
                  ref={inputRef}
                  aria-label="Search everything"
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onKeyDown}
                  className="h-full w-full bg-transparent text-[1.375rem] text-foreground outline-none"
                  style={{ outline: 'none', boxShadow: 'none' }}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {QUICK_ACTIONS.map((action, position) => (
                  <motion.button
                    key={action.label}
                    type="button"
                    aria-label={action.label}
                    title={action.label}
                    onClick={go(action.route)}
                    onMouseEnter={() => setHoveredShortcut(position)}
                    initial={false}
                    animate={hovered ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
                    transition={{
                      type: 'spring',
                      stiffness: 520,
                      damping: 30,
                      mass: 0.6,
                      delay: hovered ? position * 0.04 : 0,
                    }}
                    style={{ pointerEvents: hovered ? 'auto' : 'none', outline: 'none' }}
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-secondary text-foreground/70 hover:text-foreground focus-visible:outline-none"
                  >
                    <action.icon className="size-5" aria-hidden />
                  </motion.button>
                ))}
              </div>
            </div>

            {/* The results sheet, open only while there is something to answer. */}
            <AnimatePresence>
              {query && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.14, ease: 'easeOut' }}
                  className="overflow-hidden rounded-[28px] border border-separator bg-overlay shadow-[var(--island-shadow)]"
                >
                  <ScrollShadow className="max-h-[56vh] p-2">
                    {results.length === 0 ? (
                      <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
                        <Search className="size-5 text-muted" aria-hidden />
                        <p className="text-title text-foreground">Nothing matches “{query}”.</p>
                        <p className="text-body text-muted">Try a review, a task, or a page name.</p>
                      </div>
                    ) : (
                      results.map((command, position) => (
                        <ResultRow
                          key={command.id}
                          icon={command.icon}
                          label={command.label}
                          description={command.hint}
                          active={position === index}
                          onHover={() => {
                            setHoveredResult(position);
                            setIndex(position);
                          }}
                          onRun={command.run}
                        />
                      ))
                    )}
                  </ScrollShadow>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
