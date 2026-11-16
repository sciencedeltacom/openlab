/**
 * Create a workspace.
 *
 * A full-window stepper, deliberately outside the sidebar: you are building a workspace, not
 * working inside one, so none of the workbench's chrome belongs here. Each step asks one
 * question, and the answers become the workspace's `.labconfig` — its protocols, methods and
 * settings, written once at creation and read from then on. A cloud store is connected from
 * the Files page, where its credentials and provider fields actually live.
 *
 * The folder is chosen native, the same picker the rest of the app uses; everything after it
 * is ordinary form state, so a step can be revisited without anything having been written to
 * disk yet. Nothing exists until the final step confirms.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, FolderOpen, X } from 'lucide-react';

import {
  Button,
  IconButton,
  Input,
  ScrollShadow,
  SectionLabel,
  Separator,
  SwitchRow,
  TextArea,
} from '@/components/ui';
import { LabLogo } from '@/components/brand/Marks';
import { cn } from '@/lib/cn';
import { folderIsEmpty, PROJECT_FILES, PROJECT_FOLDERS, scaffoldProject } from '@/lib/workspace-project';
import { pickWorkspaceFolder, folderName } from '@/lib/workspace';
import { ensureOpenWiki } from '@/lib/knowledge/init';
import { PROTOCOL_PRESETS, writeLabConfig, type LabConfig } from '@/lib/workspace-config';
import { PROJECT_ICON_NAMES, projectIcon, randomProjectIcon } from '@/lib/project-icons';
import { MOTION } from '@/theme/tokens';
import { useApp } from '@/store/app';

/** The questions, in order. */
const STEPS = [
  { id: 'location', title: 'Location', hint: 'Where the workspace lives on this machine.' },
  { id: 'identity', title: 'Identity', hint: 'The name and icon it wears in the sidebar.' },
  { id: 'protocols', title: 'Protocols', hint: 'The rules the work is held to.' },
  { id: 'methods', title: 'Methods', hint: 'The methods it starts with, one per line.' },
  { id: 'review', title: 'Review', hint: 'Confirm and create.' },
] as const;

/**
 * The step rail.
 *
 * Vertical rather than a row of dots: each step gets its name, so the reader can see the whole
 * shape of the form before starting it, and a finished step is a place to go back to.
 */
function StepList({ current, onSelect }: { current: number; onSelect: (index: number) => void }) {
  return (
    <nav aria-label="Steps" className="flex flex-col gap-0.5">
      {STEPS.map((step, index) => {
        const active = index === current;
        const done = index < current;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(index)}
            disabled={index > current}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-start transition-colors',
              active && 'bg-surface',
              !active && index <= current && 'hover:bg-surface-secondary',
              index > current && 'opacity-45',
            )}
          >
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-meta font-semibold tabular-nums transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : done
                    ? 'bg-accent-soft text-accent'
                    : 'bg-surface-tertiary text-muted',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                'min-w-0 truncate text-body',
                active ? 'font-semibold text-foreground' : 'text-muted',
              )}
            >
              {step.title}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** One row in the review summary. */
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1.5">
      <span className="text-label text-muted">{label}</span>
      <span className="min-w-0 break-words text-body text-foreground">{value}</span>
    </div>
  );
}

/** One fact in the preview rail. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-meta text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-label text-foreground">{value}</dd>
    </div>
  );
}

/**
 * What the workspace will look like.
 *
 * The form asks for a folder, a name and a handful of rules; this shows the result of those
 * answers as one object, so the reader is choosing a workspace rather than filling a form.
 */
function Preview({
  name,
  path,
  icon,
  layout,
  protocols,
  methodCount,
}: {
  name: string;
  path: string | null;
  icon: string;
  layout: string;
  protocols: number;
  methodCount: number;
}) {
  const Icon = projectIcon(icon);
  return (
    <aside className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
      <SectionLabel>Preview</SectionLabel>

      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-title text-foreground">{name || 'Untitled workspace'}</p>
          <p className="truncate font-mono text-meta text-muted">{path ?? 'No folder yet'}</p>
        </div>
      </div>

      <Separator />

      <dl className="flex flex-col gap-2.5">
        <Fact label="Layout" value={layout} />
        <Fact label="Protocols" value={protocols === 0 ? 'None' : String(protocols)} />
        <Fact
          label="Methods"
          value={methodCount === 0 ? 'None yet' : `${methodCount} method${methodCount === 1 ? '' : 's'}`}
        />
      </dl>

      <Separator />

      <p className="text-meta text-muted">
        Writes <span className="font-mono text-foreground">.labconfig</span> and a starter wiki into the
        folder when you create it.
      </p>
    </aside>
  );
}

export function WorkspaceCreate() {
  const { dispatch } = useApp();

  const [step, setStep] = useState(0);
  const [path, setPath] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(randomProjectIcon());
  const [structure, setStructure] = useState(true);
  const [protocols, setProtocols] = useState<Set<string>>(new Set(['data-integrity', 'reproducibility']));
  const [methods, setMethods] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = () => dispatch({ type: 'route/go', route: 'home' });

  const chooseFolder = async () => {
    const picked = await pickWorkspaceFolder();
    if (!picked) {
      return;
    }
    const isEmpty = await folderIsEmpty(picked);
    setPath(picked);
    setEmpty(isEmpty);
    setStructure(isEmpty);
    setName((current) => current || folderName(picked));
  };

  const toggleProtocol = (id: string, on: boolean) => {
    setProtocols((current) => {
      const next = new Set(current);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const methodLines = methods
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  /** Whether the current step has what it needs to go on. */
  const canAdvance = (() => {
    switch (STEPS[step]!.id) {
      case 'location':
        return path !== null;
      case 'identity':
        return name.trim().length > 0;
      default:
        return true;
    }
  })();

  const create = async () => {
    if (!path) {
      return;
    }
    setBusy(true);
    setError(null);
    const finalName = name.trim() || folderName(path);
    try {
      if (empty && structure) {
        await scaffoldProject(path, finalName);
      }
      const wiki = await ensureOpenWiki(path, finalName);
      const config: LabConfig = {
        version: 1,
        name: finalName,
        icon,
        createdAt: new Date().toISOString(),
        protocols: PROTOCOL_PRESETS.filter((protocol) => protocols.has(protocol.id)).map((protocol) => ({
          ...protocol,
        })),
        methods: methodLines,
        settings: { structure: empty && structure, wiki, defaultModel: '' },
      };
      await writeLabConfig(path, config);
      // The reducer opens the project and lands on its home; there is nothing else to do.
      dispatch({ type: 'project/open', name: finalName, path, icon });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const current = STEPS[step]!;
  const id = current.id;
  const last = step === STEPS.length - 1;

  const layout = !path ? '—' : empty ? (structure ? 'Standard layout' : 'Empty folder') : 'Existing files';

  return (
    <div
      className="flex h-dvh w-screen flex-col overflow-hidden bg-background text-foreground"
      style={{ paddingTop: 'var(--titlebar-h)' }}
    >
      <header className="flex items-center gap-3 px-6 py-4">
        <span className="flex items-center gap-2 text-foreground">
          <LabLogo size={22} />
          <span className="text-[1.125rem] leading-none font-semibold tracking-[-0.01em]">openlab</span>
        </span>
        <div className="h-4 w-px bg-separator" aria-hidden />
        <span className="text-body text-muted">New workspace</span>
        <span className="ml-auto text-meta tabular-nums text-muted">
          Step {step + 1} of {STEPS.length}
        </span>
        <IconButton aria-label="Cancel" onPress={leave}>
          <X className="size-4" />
        </IconButton>
      </header>

      <ScrollShadow className="min-h-0 flex-1">
        <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col justify-center px-6 pb-14 pt-4">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_300px]">
            <div className="hidden lg:block">
              <StepList current={step} onSelect={setStep} />
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <section className="flex flex-col gap-5 rounded-3xl bg-surface p-6">
                <header className="flex flex-col gap-1">
                  <h1 className="text-[1.25rem] font-semibold text-foreground">{current.title}</h1>
                  <p className="text-body text-muted">{current.hint}</p>
                </header>

                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: MOTION.duration.micro, ease: MOTION.micro }}
                    className="flex flex-col gap-5"
                  >
                    {id === 'location' && (
                      <div className="flex flex-col gap-4">
                        <button
                          type="button"
                          onClick={() => void chooseFolder()}
                          className="group flex w-full items-center gap-3 rounded-2xl bg-surface-secondary px-4 py-3.5 text-start transition-colors hover:bg-surface-tertiary"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-accent">
                            <FolderOpen className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-body font-medium text-foreground">
                              {path ? 'Change folder…' : 'Choose a folder…'}
                            </span>
                            <span className={cn('block truncate text-meta text-muted', path && 'font-mono')}>
                              {path ??
                                'An empty folder gets the standard layout; one with files is added to as it is.'}
                            </span>
                          </span>
                          <ChevronRight
                            className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                            aria-hidden
                          />
                        </button>

                        {path && empty && (
                          <div className="flex flex-col gap-3">
                            <SwitchRow
                              label="Lay out the standard project structure"
                              hint="This folder is empty. openlab can give the work a home from the first commit."
                              checked={structure}
                              onChange={setStructure}
                            />
                            {structure && (
                              <div className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 rounded-2xl bg-surface-secondary p-3 ps-4 font-mono text-meta">
                                {[...PROJECT_FOLDERS, ...PROJECT_FILES].map(({ dir, description }) => (
                                  <div key={dir} className="col-span-2 grid grid-cols-subgrid">
                                    <span className="text-foreground">{dir}</span>
                                    <span className="text-muted">{description}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {path && !empty && (
                          <p className="rounded-2xl bg-surface-secondary p-3 text-meta text-muted">
                            This folder already has files. openlab adds its manifest and a starter wiki
                            without touching anything else.
                          </p>
                        )}
                      </div>
                    )}

                    {id === 'identity' && (
                      <div className="flex flex-col gap-5">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-label text-foreground">Name</span>
                          <Input
                            value={name}
                            onChange={(event) => setName((event.target as HTMLInputElement).value)}
                            placeholder="Workspace name"
                          />
                        </label>
                        <div className="flex flex-col gap-2">
                          <span className="text-label text-foreground">Icon</span>
                          <div className="grid grid-cols-8 gap-1.5">
                            {PROJECT_ICON_NAMES.map((key) => {
                              const Icon = projectIcon(key);
                              const active = key === icon;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  aria-label={key}
                                  aria-pressed={active}
                                  onClick={() => setIcon(key)}
                                  className={cn(
                                    'grid aspect-square place-items-center rounded-xl transition-colors',
                                    active
                                      ? 'bg-accent-soft text-accent ring-1 ring-accent/30'
                                      : 'text-muted hover:bg-surface-secondary hover:text-foreground',
                                  )}
                                >
                                  <Icon className="size-4" aria-hidden />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {id === 'protocols' && (
                      <div className="flex flex-col gap-1">
                        {PROTOCOL_PRESETS.map((protocol) => (
                          <SwitchRow
                            key={protocol.id}
                            label={protocol.name}
                            hint={protocol.note}
                            checked={protocols.has(protocol.id)}
                            onChange={(on) => toggleProtocol(protocol.id, on)}
                          />
                        ))}
                      </div>
                    )}

                    {id === 'methods' && (
                      <label className="flex flex-col gap-1.5">
                        <span className="text-label text-foreground">Methods</span>
                        <TextArea
                          rows={6}
                          value={methods}
                          onChange={(event) => setMethods((event.target as HTMLTextAreaElement).value)}
                          placeholder={
                            'One method per line, e.g.\nCRISPR off-target scoring\nBatch-effect correction with ComBat'
                          }
                        />
                        <span className="text-meta text-muted">
                          {methodLines.length} method{methodLines.length === 1 ? '' : 's'}
                        </span>
                      </label>
                    )}

                    {id === 'review' && (
                      <div className="flex flex-col">
                        <Summary label="Folder" value={path ?? '—'} />
                        <Summary label="Name" value={name.trim() || (path ? folderName(path) : '—')} />
                        <Summary
                          label="Structure"
                          value={empty && structure ? 'Standard layout' : 'Existing folder'}
                        />
                        <Summary
                          label="Protocols"
                          value={
                            PROTOCOL_PRESETS.filter((protocol) => protocols.has(protocol.id))
                              .map((protocol) => protocol.name)
                              .join(', ') || 'None'
                          }
                        />
                        <Summary
                          label="Methods"
                          value={methodLines.length > 0 ? methodLines.join(', ') : 'None yet'}
                        />
                        <Separator className="my-2" />
                        <p className="text-meta text-muted">
                          openlab writes <span className="font-mono text-foreground">.labconfig</span> into
                          the folder on create.
                        </p>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </section>

              {error && <p className="rounded-2xl bg-danger-soft p-3 text-body text-danger">{error}</p>}

              <footer className="flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  isDisabled={step === 0 || busy}
                  onPress={() => setStep((value) => value - 1)}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onPress={leave} isDisabled={busy}>
                    Cancel
                  </Button>
                  {!last ? (
                    <Button
                      variant="primary"
                      isDisabled={!canAdvance}
                      onPress={() => setStep((value) => value + 1)}
                    >
                      Next
                    </Button>
                  ) : (
                    <Button variant="primary" isDisabled={busy || !path} onPress={() => void create()}>
                      {busy ? 'Creating…' : 'Create workspace'}
                    </Button>
                  )}
                </div>
              </footer>
            </div>

            <div className="hidden xl:block">
              <div className="sticky top-4">
                <Preview
                  name={name.trim()}
                  path={path}
                  icon={icon}
                  layout={layout}
                  protocols={protocols.size}
                  methodCount={methodLines.length}
                />
              </div>
            </div>
          </div>
        </div>
      </ScrollShadow>
    </div>
  );
}
