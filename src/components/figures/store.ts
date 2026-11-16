/**
 * The figures, live.
 *
 * A figure is a document the lab shares, not a note the app keeps, so the figures are files
 * in the workspace: `.openlab/figures/<id>-<caption>.json`, one per figure, written by
 * openlab and read by git. That is what makes a figure travel — with the folder it belongs
 * to, to a colleague who commits it, and out of the app entirely.
 *
 * The store owns the list and the documents; it does not own the undo history. History is a
 * property of one open document, and belongs to the studio that is editing it. Writes are
 * debounced, because the studio saves on every edit and a file per keystroke is not a
 * version history, it is noise.
 *
 * A workspace with no figures shows none. The eight example figures are templates to copy in,
 * not records to display: nothing appears in a gallery that is not in the folder.
 */

import { useSyncExternalStore } from 'react';

import { isDesktop } from '@/lib/ipc';
import { createMirror } from '@/lib/workspace/mirror';
import { SEED_FIGURES, starterElements } from './seed';
import { blankDoc, figureSlug, uid, type Figure, type FigureDoc, type FigureKind } from './types';

/** Where a workspace keeps its figures. */
export const FIGURE_DIR = '.openlab/figures';

/** The folder's own explanation, so a reader arriving by git knows what a file is. */
export const FIGURE_README = `${FIGURE_DIR}/README.md`;

/** The key the pre-folder build wrote, read once so nobody's figures are lost to the move. */
const LEGACY_KEY = 'openlab.figures.v1';

/** How long the studio may keep editing before the folder is written. */
const WRITE_DELAY = 500;

const mirror = createMirror({ id: 'figures', pattern: `${FIGURE_DIR}/*.json` });

let figures: Figure[] = [];
/** The order the gallery reads: newest edit first. Cached, because `useSyncExternalStore`
 * compares snapshots by identity and a freshly sorted array every call is an infinite loop. */
let sorted: Figure[] = [];
const listeners = new Set<() => void>();

/** The folder the store is pointed at, or `null` when no workspace is open. */
let root: string | null = null;
let timer: number | null = null;

function sortByUpdated(list: readonly Figure[]): Figure[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

function emit(): void {
  sorted = sortByUpdated(figures);
  for (const listener of listeners) listener();
}

/** Replace the list without writing: what a read does. */
function adopt(next: Figure[]): void {
  figures = next;
  emit();
}

/** Write the folder, after the edits have settled. */
function scheduleWrite(): void {
  if (typeof window === 'undefined') return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    flushFigures();
  }, WRITE_DELAY);
}

/** Write the figures now, whether or not an edit is still settling. */
export function flushFigures(): void {
  if (!root || !isDesktop()) return;
  void mirror.write(root, figureFiles()).catch((error) => {
    console.error('openlab could not write its figures to the workspace', error);
  });
}

/**
 * The figures as the files they should be. Pure: no disk, no store.
 *
 * One JSON document per figure, pretty-printed so a diff reads. The README is not a figure:
 * it is there so the folder explains itself to whoever opens the repository.
 */
export function figureFiles(list: readonly Figure[] = figures): Map<string, string> {
  const files = new Map<string, string>([
    [
      FIGURE_README,
      [
        '# Figures',
        '',
        'The workspace figures, one JSON document each, written by openlab and read by git.',
        '',
        'A document is the editable source: open it in the app to change it, or read it as JSON',
        'to see exactly what the figure is made of. An export for a paper belongs in `results/`.',
        'This folder holds the source, not the rendered output.',
        '',
        'openlab rewrites a file when its figure changes and reads a file back when a workspace',
        'opens, so a figure a colleague commits arrives with their next open.',
        '',
      ].join('\n'),
    ],
  ]);
  for (const figure of list) {
    files.set(`${FIGURE_DIR}/${figureSlug(figure)}.json`, `${JSON.stringify(figure, null, 2)}\n`);
  }
  return files;
}

/** A stored document may predate an element kind; a missing document is the only fatal one. */
function revive(parsed: unknown): Figure | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const figure = parsed as Figure;
  if (typeof figure.id !== 'string' || typeof figure.caption !== 'string') return null;
  return { ...figure, doc: figure.doc ?? blankDoc() };
}

/** The figures the previous build left in webview storage, if any. */
function readLegacy(): Figure[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: number; figures?: unknown[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.figures) || parsed.figures.length === 0) return null;
    return parsed.figures.flatMap((entry) => revive(entry) ?? []);
  } catch {
    return null;
  }
}

/** What a read of a workspace's figures did. */
export interface FigureLoad {
  /** Figures read from the folder. */
  read: number;
  /** Files that changed since openlab wrote them — a commit, or an edit. */
  foreign: number;
  /** True when the figures the old build kept in app storage were adopted into the folder. */
  migrated: boolean;
  problems: string[];
}

/**
 * Point the figures at a workspace and read them.
 *
 * Called once per open, from the shell. A folder with no figures is a folder with no figures
 * — except on the first open after the move, when the list the old build kept in app storage
 * is written into it rather than dropped. That list had no workspace of its own, so the first
 * one to be opened claims it; the key is removed once it has landed, so it happens once.
 */
export async function loadWorkspaceFigures(nextRoot: string): Promise<FigureLoad> {
  const load: FigureLoad = { read: 0, foreign: 0, migrated: false, problems: [] };
  // Whatever the workspace being left was editing is written before the store is pointed at
  // another one: a debounced edit belongs to the folder it was made in.
  if (root && root !== nextRoot) flushFigures();
  root = nextRoot;
  if (!isDesktop() || !nextRoot) {
    adopt([]);
    return load;
  }

  const found = await mirror.read(nextRoot);
  load.foreign = found.foreign.length;
  load.problems = found.problems;

  const fromFolder = [...found.files.entries()].flatMap(([path, text]) => {
    try {
      const figure = revive(JSON.parse(text));
      return figure ? [figure] : [];
    } catch {
      load.problems.push(`${path}: not valid JSON`);
      return [];
    }
  });

  // The move happens once, into an empty folder: an existing figure is never overwritten.
  const legacy = fromFolder.length === 0 ? readLegacy() : null;
  if (legacy) {
    adopt(legacy);
    load.migrated = true;
    load.read = legacy.length;
    flushFigures();
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Storage disabled mid-session; the import already happened.
    }
  } else {
    adopt(fromFolder);
    load.read = fromFolder.length;
  }

  mirror.ready(nextRoot);
  return load;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every figure in this workspace, newest edit first — the order the gallery reads. */
export function allFigures(): Figure[] {
  return sorted;
}

/** The same list, as a component reads it. */
export function useFigures(): Figure[] {
  return useSyncExternalStore(subscribe, allFigures);
}

export function figureById(id: string): Figure | undefined {
  return figures.find((figure) => figure.id === id);
}

/** A stable, short identifier for a new figure. */
function newFigureId(): string {
  return `F-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

/** The document a figure of this kind starts from. */
export function startDocument(kind: FigureKind): FigureDoc {
  return { ...blankDoc(), elements: starterElements(kind) };
}

/** Create a figure and put it at the top. */
export function createFigure(input: {
  caption: string;
  kind: FigureKind;
  format?: Figure['format'];
  size?: string;
  doc?: FigureDoc;
}): Figure {
  const figure: Figure = {
    id: newFigureId(),
    caption: input.caption,
    kind: input.kind,
    format: input.format ?? (input.kind === 'Micrograph' ? 'TIFF' : 'SVG'),
    size: input.size ?? '180 mm',
    script: '—',
    data: '—',
    dpi: input.kind === 'Micrograph' ? 600 : null,
    palette: 'openlab',
    vector: input.kind !== 'Micrograph',
    updatedAt: Date.now(),
    doc: input.doc ?? startDocument(input.kind),
  };
  figures = [figure, ...figures];
  scheduleWrite();
  emit();
  return figure;
}

/** Merge changes into a figure's metadata. */
export function patchFigure(id: string, patch: Partial<Figure>): void {
  figures = figures.map((figure) =>
    figure.id === id ? { ...figure, ...patch, id, updatedAt: Date.now() } : figure,
  );
  scheduleWrite();
  emit();
}

/** Replace one figure's document — what the studio writes on every edit. */
export function saveDoc(id: string, doc: FigureDoc): void {
  figures = figures.map((figure) => (figure.id === id ? { ...figure, doc, updatedAt: Date.now() } : figure));
  scheduleWrite();
  emit();
}

/** Remove a figure, returning it and its place so the removal can be undone. */
export function removeFigure(id: string): { figure: Figure; index: number } | null {
  const index = figures.findIndex((figure) => figure.id === id);
  if (index === -1) return null;
  const [figure] = figures.splice(index, 1);
  scheduleWrite();
  emit();
  return { figure: figure!, index };
}

/** Put a removed figure back where it was. */
export function restoreFigure(figure: Figure, index: number): void {
  const next = [...figures];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, figure);
  figures = next;
  scheduleWrite();
  emit();
}

/** Copy a figure, document and all. */
export function duplicateFigure(id: string): Figure | null {
  const source = figureById(id);
  if (!source) return null;
  const copy: Figure = {
    ...source,
    id: newFigureId(),
    caption: `${source.caption} (copy)`,
    updatedAt: Date.now(),
    doc: {
      ...source.doc,
      elements: source.doc.elements.map((element) => ({ ...element, id: uid() })),
    },
  };
  figures = [copy, ...figures];
  scheduleWrite();
  emit();
  return copy;
}

/**
 * Copy the example figures into this workspace.
 *
 * The eight examples that ship with openlab are documents worth having, and none of them
 * belongs in a gallery nobody put it in. They are written into the folder like any other
 * figure, so from here on they are this workspace's — editable, committable, deletable.
 */
export function addExampleFigures(): number {
  const existing = new Set(figures.map((figure) => figure.caption));
  const added = SEED_FIGURES.filter((figure) => !existing.has(figure.caption)).map((figure) => ({
    ...figure,
    id: newFigureId(),
    updatedAt: Date.now(),
  }));
  if (added.length === 0) return 0;
  figures = [...added, ...figures];
  scheduleWrite();
  emit();
  return added.length;
}

/** Forget what was written and read the folder again, for a full reset or a test. */
export function forgetFigureMemory(nextRoot?: string): void {
  mirror.forget(nextRoot);
}

// A debounced write still settling when the window closes is the one edit that would be
// lost, so the folder is written on the way out.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flushFigures());
}
