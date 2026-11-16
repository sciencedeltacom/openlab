/**
 * The figure studio.
 *
 * A whole-surface editor for one figure document: a tool rail, the canvas, and a side panel
 * for the library, the layers and the selected element's properties. It is routed, not a
 * modal, so a figure you are working on is a place you can come back to.
 *
 * The studio owns three things the canvas does not: the undo history, the viewport, and the
 * save. Everything the canvas or a panel changes comes back through one `applyEdit`, which is
 * what keeps a drag, a slider and a paste undoable in the same way.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  BringToFront,
  ChevronLeft,
  ChevronRight,
  Component,
  Copy,
  Eye,
  EyeOff,
  Layers,
  Lock,
  SendToBack,
  SlidersHorizontal,
  Trash2,
  Unlock,
} from 'lucide-react';

import { Button, Chip, IconButton, ScrollShadow, SectionLabel, Tabs, Tip } from '@/components/ui';
import { RowMenu } from '@/components/common/RowMenu';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { MOTION } from '@/theme/tokens';
import { useApp, usePageTitle } from '@/store/app';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { InsertPanel } from './InsertPanel';
import { exportJson, exportPng, exportSvg, toSvgString } from './export';
import { renderMermaid, type MermaidDrawing } from './mermaid';
import { figureById, patchFigure, saveDoc } from './store';
import { setStudioControls } from './studio-bridge';
import { StudioTitle, StudioTools } from './StudioControls';
import { TOOLS, toolForKey, type Tool } from './tools';
import { boundsOf, unionBounds, type FigureDoc, type FigureElement } from './types';

type RightTab = 'components' | 'layers' | 'properties';

const HISTORY_LIMIT = 120;

/** The side panel's width when it is open, in pixels. */
const PANEL_WIDTH = 380;

/**
 * The entrance for anything that appears: a spring rather than a curve, so a panel that
 * slides in has weight and settles instead of arriving on a schedule.
 */
const SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 } as const;

/** A panel's content, revealed as its tab becomes the one in front. */
function PanelReveal({ id, children }: { id: string; children: ReactNode }) {
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: MOTION.signature }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}

export function FigureStudio({ figureId }: { figureId: string }) {
  const { dispatch } = useApp();
  const figure = figureById(figureId);
  usePageTitle(figure ? `Figure ${figure.id}` : 'Figure studio');

  const [doc, setDoc] = useState<FigureDoc | null>(figure?.doc ?? null);
  const docRef = useRef<FigureDoc | null>(doc);
  const past = useRef<FigureDoc[]>([]);
  const future = useRef<FigureDoc[]>([]);
  const [, bump] = useReducer((value: number) => value + 1, 0);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(0.6);
  const [pan, setPan] = useState({ x: 120, y: 90 });
  const [snap, setSnap] = useState(false);
  const [grid, setGrid] = useState(false);
  const [tab, setTab] = useState<RightTab>('components');
  const [panelOpen, setPanelOpen] = useState(true);
  const [added, setAdded] = useState<{ key: number; name: string; preview?: ReactNode } | null>(null);
  const [atomEl, setAtomEl] = useState('C');
  const [iconId, setIconId] = useState('cell');
  const [mermaid, setMermaid] = useState<Record<string, MermaidDrawing>>({});
  const [caption, setCaption] = useState(figure?.caption ?? '');
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  /** True while the figure is kept fitted and the reader has not moved the viewport. */
  const [autoFit, setAutoFit] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  /** The box the last fit used, so a small layout change does not rescale the drawing. */
  const lastFit = useRef<{ w: number; h: number } | null>(null);

  const setDocBoth = useCallback((next: FigureDoc) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  /** The one write path. `history: false` keeps a live drag out of the undo stack. */
  const applyEdit = useCallback(
    (updater: (current: FigureDoc) => FigureDoc, options?: { history?: boolean }) => {
      const current = docRef.current;
      if (!current) return;
      const next = updater(current);
      if (next === current) return;
      if (options?.history !== false) {
        past.current.push(current);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
        future.current = [];
      }
      setDocBoth(next);
      bump();
    },
    [setDocBoth],
  );

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous || !docRef.current) return;
    future.current.push(docRef.current);
    setDocBoth(previous);
    bump();
  }, [setDocBoth]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !docRef.current) return;
    past.current.push(docRef.current);
    setDocBoth(next);
    bump();
  }, [setDocBoth]);

  /* ------------------------------------------------------------------ load and save */

  useEffect(() => {
    if (!figure) return;
    past.current = [];
    future.current = [];
    setDocBoth(figure.doc);
    setSelectedIds([]);
    setCaption(figure.caption);
    setAutoFit(true);
    lastFit.current = null;
    // The document is loaded once per figure; edits afterwards are local until saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figureId]);

  // An undo can remove what was selected; a selection that names nothing is cleared.
  useEffect(() => {
    setSelectedIds((ids) => {
      const elements = doc?.elements ?? [];
      const next = ids.filter((id) => elements.some((element) => element.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [doc?.elements]);

  // Autosave: the document belongs to the user the moment it changes.
  useEffect(() => {
    if (!doc || !figure) return;
    const timeout = window.setTimeout(() => saveDoc(figure.id, doc), 500);
    return () => window.clearTimeout(timeout);
  }, [doc, figure]);

  /* ------------------------------------------------------------------ mermaid render */

  const mermaidKey = useMemo(
    () =>
      (doc?.elements ?? [])
        .filter((element) => element.kind === 'mermaid')
        .map((element) =>
          element.kind === 'mermaid' ? `${element.id}:${element.tone}:${element.source}` : '',
        )
        .join('|'),
    [doc?.elements],
  );

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const diagrams = doc.elements.filter((element) => element.kind === 'mermaid');
      void Promise.all(
        diagrams.map(async (element) => {
          if (element.kind !== 'mermaid') return null;
          try {
            return [element.id, await renderMermaid(element.source, element.tone)] as const;
          } catch {
            return null;
          }
        }),
      ).then((entries) => {
        if (cancelled) return;
        const map: Record<string, MermaidDrawing> = {};
        for (const entry of entries) {
          if (entry) map[entry[0]] = entry[1];
        }
        setMermaid(map);
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mermaidKey]);

  /* ------------------------------------------------------------------ fit to view */

  const fit = useCallback(() => {
    const container = containerRef.current;
    const current = docRef.current;
    if (!container || !current) return;
    const rect = container.getBoundingClientRect();
    const pad = 40;
    const next = Math.min((rect.width - pad * 2) / current.width, (rect.height - pad * 2) / current.height);
    const clamped = Math.max(0.1, Math.min(3, next));
    setZoom(clamped);
    // `pan` is in the canvas's own pixels, so centring is the leftover space halved.
    setPan({
      x: (rect.width - current.width * clamped) / 2,
      y: (rect.height - current.height * clamped) / 2,
    });
  }, []);

  /** Zoom about the middle of the viewport, so the drawing does not slide off. */
  const zoomBy = useCallback(
    (factor: number) => {
      setAutoFit(false);
      const rect = containerRef.current?.getBoundingClientRect();
      const next = Math.max(0.12, Math.min(6, zoom * factor));
      if (rect) {
        const centre = { x: rect.width / 2, y: rect.height / 2 };
        const anchor = { x: (centre.x - pan.x) / zoom, y: (centre.y - pan.y) / zoom };
        setPan({ x: centre.x - anchor.x * next, y: centre.y - anchor.y * next });
      }
      setZoom(next);
    },
    [pan.x, pan.y, zoom],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    // Fit until the reader touches the viewport. The shell lays the canvas out over more
    // than one frame, so the first measurement can be of a box that has not reached its
    // size yet: retry across a few frames, then keep a resize observer for later changes.
    // A refit only happens when the box really changes — the selection toolbar appearing
    // must not rescale the drawing under the reader.
    let frame = 0;
    const attempt = (tries: number) => {
      const box = containerRef.current;
      if (!box || !autoFit) return;
      if (box.clientWidth < 60 || box.clientHeight < 60) {
        if (tries > 0) frame = requestAnimationFrame(() => attempt(tries - 1));
        return;
      }
      const last = lastFit.current;
      const changed =
        !last ||
        Math.abs(box.clientWidth - last.w) / last.w > 0.15 ||
        Math.abs(box.clientHeight - last.h) / last.h > 0.15;
      if (!changed) return;
      lastFit.current = { w: box.clientWidth, h: box.clientHeight };
      fit();
    };
    attempt(12);

    const observer = container ? new ResizeObserver(() => attempt(0)) : null;
    if (container && observer) observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [autoFit, fit, figureId]);

  /* ------------------------------------------------------------------ selection edits */

  const selected = useMemo(
    () => (doc?.elements ?? []).filter((element) => selectedIds.includes(element.id)),
    [doc?.elements, selectedIds],
  );

  const patchSelected = useCallback(
    (changes: Record<string, unknown>, message?: string) => {
      applyEdit((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          selectedIds.includes(element.id) ? ({ ...element, ...changes } as FigureElement) : element,
        ),
      }));
      if (message) notify(message);
    },
    [applyEdit, selectedIds],
  );

  const replaceElement = useCallback(
    (element: FigureElement) => {
      applyEdit((current) => ({
        ...current,
        elements: current.elements.map((candidate) => (candidate.id === element.id ? element : candidate)),
      }));
    },
    [applyEdit],
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    applyEdit((current) => ({
      ...current,
      elements: current.elements.filter((element) => !selectedIds.includes(element.id)),
    }));
    setSelectedIds([]);
  }, [applyEdit, selectedIds]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const copies: FigureElement[] = [];
    applyEdit((current) => {
      const next: FigureElement[] = [];
      for (const element of current.elements) {
        next.push(element);
        if (selectedIds.includes(element.id)) {
          const copy = {
            ...element,
            id: `${element.id}-${Math.random().toString(36).slice(2, 6)}`,
            x: element.x + 24,
            y: element.y + 24,
          };
          copies.push(copy);
          next.push(copy);
        }
      }
      return { ...current, elements: next };
    });
    setSelectedIds(copies.map((copy) => copy.id));
  }, [applyEdit, selectedIds]);

  const align = useCallback(
    (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
      if (selectedIds.length < 2) return;
      const box = unionBounds(selected);
      if (!box) return;
      applyEdit((current) => ({
        ...current,
        elements: current.elements.map((element) => {
          if (!selectedIds.includes(element.id)) return element;
          const own = boundsOf(element);
          switch (mode) {
            case 'left':
              return { ...element, x: element.x + (box.x - own.x) };
            case 'hcenter':
              return { ...element, x: element.x + (box.x + box.w / 2 - (own.x + own.w / 2)) };
            case 'right':
              return { ...element, x: element.x + (box.x + box.w - (own.x + own.w)) };
            case 'top':
              return { ...element, y: element.y + (box.y - own.y) };
            case 'vcenter':
              return { ...element, y: element.y + (box.y + box.h / 2 - (own.y + own.h / 2)) };
            case 'bottom':
              return { ...element, y: element.y + (box.y + box.h - (own.y + own.h)) };
          }
        }),
      }));
    },
    [applyEdit, selected, selectedIds],
  );

  const order = useCallback(
    (mode: 'front' | 'forward' | 'backward' | 'back') => {
      if (selectedIds.length === 0) return;
      applyEdit((current) => {
        const picked = current.elements.filter((element) => selectedIds.includes(element.id));
        const rest = current.elements.filter((element) => !selectedIds.includes(element.id));
        if (mode === 'front') return { ...current, elements: [...rest, ...picked] };
        if (mode === 'back') return { ...current, elements: [...picked, ...rest] };
        const elements = [...current.elements];
        if (mode === 'forward') {
          for (let index = elements.length - 2; index >= 0; index -= 1) {
            if (selectedIds.includes(elements[index]!.id) && !selectedIds.includes(elements[index + 1]!.id)) {
              [elements[index], elements[index + 1]] = [elements[index + 1]!, elements[index]!];
            }
          }
        } else {
          for (let index = 1; index < elements.length; index += 1) {
            if (selectedIds.includes(elements[index]!.id) && !selectedIds.includes(elements[index - 1]!.id)) {
              [elements[index], elements[index - 1]] = [elements[index - 1]!, elements[index]!];
            }
          }
        }
        return { ...current, elements };
      });
    },
    [applyEdit, selectedIds],
  );

  /* ------------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;

      if (typing) return;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedIds(
          (docRef.current?.elements ?? [])
            .filter((element) => !element.locked && !element.hidden)
            .map((element) => element.id),
        );
        return;
      }
      if (mod && (event.key === '0' || event.key === '9')) {
        event.preventDefault();
        fit();
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        zoomBy(1.2);
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        zoomBy(1 / 1.2);
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key === 'Escape') {
        setSelectedIds([]);
        setTool('select');
        return;
      }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        applyEdit((current) => ({
          ...current,
          elements: current.elements.map((element) =>
            selectedIds.includes(element.id) ? { ...element, x: element.x + dx, y: element.y + dy } : element,
          ),
        }));
        return;
      }
      if (!mod) {
        const next = toolForKey(event.key);
        if (next) {
          setTool(next);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyEdit, deleteSelected, duplicateSelected, fit, redo, selectedIds, undo, zoomBy]);

  /* ------------------------------------------------------- the top bar's controls */

  /** Run an export, saying what happened either way. */
  const runExport = useCallback(
    (kind: 'svg' | 'png' | 'png4' | 'json' | 'copy') => {
      const target = figure && doc ? { ...figure, caption, doc } : null;
      if (!target) return;
      const work = async () => {
        if (kind === 'svg') await exportSvg(target, mermaid);
        if (kind === 'png') await exportPng(target, mermaid, 2);
        if (kind === 'png4') await exportPng(target, mermaid, 4);
        if (kind === 'json') await exportJson(target);
        if (kind === 'copy') {
          const svg = await toSvgString(target.doc, mermaid);
          await navigator.clipboard.writeText(svg);
        }
      };
      void work().then(
        () =>
          notify(kind === 'copy' ? 'SVG copied to the clipboard' : 'Figure exported', { tone: 'success' }),
        (error: unknown) =>
          notify(kind === 'copy' ? 'Could not copy the SVG' : 'Export failed', {
            description: error instanceof Error ? error.message : undefined,
            tone: 'danger',
          }),
      );
    },
    [caption, doc, figure, mermaid],
  );

  /**
   * Centre what was just placed on the middle of the view.
   *
   * An element carries the coordinates it was built with, which are nowhere in particular;
   * a reader who has panned somewhere else would place it off screen. The view is the only
   * sensible answer to "where", and it is where the reader is looking.
   */
  const centreOnView = useCallback(
    (elements: FigureElement[]): FigureElement[] => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return elements;
      const box = unionBounds(elements);
      if (!box) return elements;
      const at = { x: (rect.width / 2 - pan.x) / zoom, y: (rect.height / 2 - pan.y) / zoom };
      const dx = at.x - (box.x + box.w / 2);
      const dy = at.y - (box.y + box.h / 2);
      return elements.map((element) => ({ ...element, x: element.x + dx, y: element.y + dy }));
    },
    [pan.x, pan.y, zoom],
  );

  /** Say what was just placed, on the canvas, for a moment. */
  const announce = useCallback((name: string, preview?: ReactNode) => {
    setAdded({ key: Date.now(), name, preview });
  }, []);

  useEffect(() => {
    if (!added) return;
    const timeout = window.setTimeout(() => setAdded(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [added]);

  /**
   * Publish the controls the top bar draws.
   *
   * Re-published on every render, so the bar always drives the document that is on screen;
   * cleared on unmount, so the bar falls back to the plain title on any other route.
   */
  useLayoutEffect(() => {
    if (!figure || !doc) {
      setStudioControls(null);
      return;
    }
    setStudioControls({
      caption,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      grid,
      snap,
      onCaption: setCaption,
      commitCaption: () => patchFigure(figure.id, { caption }),
      undo,
      redo,
      zoomBy,
      fit,
      toggleGrid: () => setGrid((value) => !value),
      toggleSnap: () => setSnap((value) => !value),
      runExport,
    });
    return () => setStudioControls(null);
  });

  if (!figure || !doc) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <Layers className="mx-auto size-6 text-muted" />
          <p className="mt-3 text-body text-muted">This figure is no longer in the library.</p>
          <Button
            variant="secondary"
            className="mt-4"
            onPress={() => dispatch({ type: 'route/go', route: 'analyze/figures' })}
          >
            Back to figures
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-2 bg-background p-2">
      {/* The tool rail: an island of its own, off the window's edge like the panel. */}
      <nav
        aria-label="Tools"
        className="flex w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto rounded-2xl border border-separator bg-surface py-2"
      >
        {TOOLS.map((meta, index) => {
          const Icon = meta.icon;
          const active = tool === meta.id;
          // A hairline where the tool changes purpose: select/pan, draw, annotate, science.
          const divider = index > 0 && TOOLS[index - 1]!.group !== meta.group;
          return (
            <div key={meta.id} className="flex w-full flex-col items-center">
              {divider && <div className="my-1 h-px w-6 bg-separator" aria-hidden />}
              <Tip
                content={meta.key ? `${meta.label} (${meta.key.toUpperCase()})` : meta.label}
                placement="right"
              >
                <button
                  type="button"
                  aria-label={meta.label}
                  aria-pressed={active}
                  onClick={() => setTool(meta.id)}
                  className={cn(
                    'grid size-9 place-items-center rounded-lg transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted hover:bg-surface-secondary hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                </button>
              </Tip>
            </div>
          );
        })}

        {/* The atom palette rides in with the tool that needs it. */}
        <AnimatePresence initial={false}>
          {(tool === 'atom' || tool === 'bond') && (
            <motion.div
              key="atoms"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING}
              className="flex w-full flex-col items-center gap-1 overflow-hidden"
            >
              <div className="mt-1 h-px w-6 bg-separator" aria-hidden />
              <span className="text-[10px] uppercase tracking-wide text-muted">Atom</span>
              {['C', 'N', 'O', 'S', 'P'].map((element) => (
                <button
                  key={element}
                  type="button"
                  onClick={() => setAtomEl(element)}
                  className={cn(
                    'grid size-7 place-items-center rounded-md text-meta',
                    atomEl === element
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted hover:bg-surface-secondary',
                  )}
                >
                  {element}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Canvas column: one island, with the selection chrome floating over it. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The studio's own header. Its controls were in the application's top bar, which is
            gone; a document editor carries its own. */}
        <header className="flex h-11 shrink-0 items-center gap-3 px-2">
          <StudioTitle />
          <StudioTools />
        </header>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-separator bg-surface-secondary"
        >
          <Canvas
            doc={doc}
            tool={tool}
            atomEl={atomEl}
            iconId={iconId}
            selectedIds={selectedIds}
            zoom={zoom}
            pan={pan}
            snap={snap}
            grid={grid}
            mermaid={mermaid}
            onSelect={setSelectedIds}
            onEdit={applyEdit}
            onViewport={({ zoom: nextZoom, pan: nextPan }) => {
              setAutoFit(false);
              setZoom(nextZoom);
              setPan(nextPan);
            }}
            onToolChange={setTool}
            onCursor={setCursor}
          />

          {/*
            What is selected, rising from the bottom of the canvas: it takes no space in the
            column, so the drawing keeps the whole island whether or not anything is picked.
          */}
          <AnimatePresence initial={false}>
            {selectedIds.length > 0 && (
              <motion.div
                key="selection"
                initial={{ opacity: 0, y: 26, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 26, scale: 0.96 }}
                transition={{ ...SPRING, opacity: { duration: 0.16 } }}
                className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
              >
                <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl border border-separator bg-surface px-2 py-1">
                  <span className="mr-1 truncate text-meta text-muted">
                    {selectedIds.length === 1
                      ? (selected[0]?.name ?? '1 element')
                      : `${selectedIds.length} elements`}
                  </span>
                  {selectedIds.length > 1 && (
                    <>
                      <IconButton aria-label="Align left" onPress={() => align('left')}>
                        <AlignStartVertical className="size-3.5" />
                      </IconButton>
                      <IconButton aria-label="Align centre" onPress={() => align('hcenter')}>
                        <AlignCenterVertical className="size-3.5" />
                      </IconButton>
                      <IconButton aria-label="Align right" onPress={() => align('right')}>
                        <AlignEndVertical className="size-3.5" />
                      </IconButton>
                      <IconButton aria-label="Align top" onPress={() => align('top')}>
                        <AlignStartHorizontal className="size-3.5" />
                      </IconButton>
                      <IconButton aria-label="Align middle" onPress={() => align('vcenter')}>
                        <AlignCenterHorizontal className="size-3.5" />
                      </IconButton>
                      <IconButton aria-label="Align bottom" onPress={() => align('bottom')}>
                        <AlignEndHorizontal className="size-3.5" />
                      </IconButton>
                      <div className="mx-1 h-4 w-px bg-separator" />
                    </>
                  )}
                  <IconButton aria-label="Bring to front" onPress={() => order('front')}>
                    <BringToFront className="size-3.5" />
                  </IconButton>
                  <IconButton aria-label="Send to back" onPress={() => order('back')}>
                    <SendToBack className="size-3.5" />
                  </IconButton>
                  <IconButton aria-label="Duplicate" onPress={duplicateSelected}>
                    <Copy className="size-3.5" />
                  </IconButton>
                  <IconButton aria-label="Delete" className="text-danger" onPress={deleteSelected}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* The status sits out of the way, in the corner the toolbar does not use. */}
          <div className="pointer-events-none absolute bottom-2 left-2 z-10">
            <div className="flex items-center gap-3 rounded-full border border-separator bg-surface/90 px-3 py-1 text-meta text-muted backdrop-blur">
              <span className="tabular-nums">
                {doc.width} × {doc.height}
              </span>
              <span className="tabular-nums">{doc.elements.length} elements</span>
              {cursor && (
                <span className="tabular-nums">
                  {Math.round(cursor.x)}, {Math.round(cursor.y)}
                </span>
              )}
              {snap && <span>snap</span>}
              {grid && <span>grid</span>}
              {(tool === 'atom' || tool === 'bond') && (
                <span>{tool === 'atom' ? `place ${atomEl}` : 'draw bond'}</span>
              )}
            </div>
          </div>

          {/* What was just placed, announced where it landed. */}
          <AnimatePresence>
            {added && (
              <motion.div
                key={added.key}
                initial={{ opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ ...SPRING, opacity: { duration: 0.2 } }}
                className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center"
              >
                <div className="flex items-center gap-2 rounded-2xl border border-separator bg-surface px-2.5 py-1.5">
                  <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-secondary p-1">
                    {added.preview}
                  </span>
                  <span className="max-w-[220px] truncate text-meta text-foreground">{added.name}</span>
                  <span className="text-[11px] text-muted">placed</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* The handle that folds the panel away, and brings it back. */}
          <Tip content={panelOpen ? 'Hide the panel' : 'Show the panel'} placement="left">
            <button
              type="button"
              aria-label={panelOpen ? 'Hide the panel' : 'Show the panel'}
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((open) => !open)}
              className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-full border border-separator bg-surface text-muted transition-colors hover:text-foreground"
            >
              {panelOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </button>
          </Tip>
        </div>
      </div>

      {/* Side panel: one island, folded by width so it slides rather than reflows. */}
      <AnimatePresence initial={false}>
        {panelOpen && (
          <motion.aside
            key="panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: PANEL_WIDTH, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={SPRING}
            className="shrink-0 overflow-hidden rounded-[calc(var(--radius)*2.5)] border border-separator bg-surface"
          >
            <div className="flex h-full flex-col" style={{ width: PANEL_WIDTH }}>
              <Tabs
                selectedKey={tab}
                onSelectionChange={(key) => setTab(String(key) as RightTab)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <Tabs.ListContainer>
                  <Tabs.List aria-label="Figure panel">
                    {(
                      [
                        ['components', 'Components', Component],
                        ['layers', 'Layers', Layers],
                        ['properties', 'Properties', SlidersHorizontal],
                      ] as const
                    ).map(([id, label, Icon]) => (
                      <Tabs.Tab key={id} id={id}>
                        <span className="flex items-center gap-1.5">
                          <Icon className="size-3.5 shrink-0" />
                          <span className="truncate">{label}</span>
                        </span>
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.ListContainer>

                <Tabs.Panel id="components" className="min-h-0 flex-1">
                  <PanelReveal id="components">
                    <InsertPanel
                      iconId={iconId}
                      onIconId={setIconId}
                      onInsertTemplate={(build, name, preview) => {
                        const elements = centreOnView(build().elements);
                        applyEdit((current) => ({
                          ...current,
                          elements: [...current.elements, ...elements],
                        }));
                        announce(name, preview);
                      }}
                      onInsertFragment={(build, name, preview) => {
                        const element = centreOnView([build()])[0]!;
                        applyEdit((current) => ({ ...current, elements: [...current.elements, element] }));
                        setSelectedIds([element.id]);
                        setTool('select');
                        announce(name, preview);
                      }}
                      onInsertElement={(element, preview) => {
                        const placed = centreOnView([element])[0]!;
                        applyEdit((current) => ({ ...current, elements: [...current.elements, placed] }));
                        setSelectedIds([placed.id]);
                        announce(placed.name, preview);
                      }}
                    />
                  </PanelReveal>
                </Tabs.Panel>

                <Tabs.Panel id="layers" className="min-h-0 flex-1">
                  <PanelReveal id="layers">
                    <ScrollShadow className="h-full">
                      <div className="flex flex-col gap-0.5 p-2">
                        <SectionLabel className="px-1 py-1">Top to bottom</SectionLabel>
                        {[...doc.elements].reverse().map((element) => {
                          const isSelected = selectedIds.includes(element.id);
                          return (
                            <div
                              key={element.id}
                              className={cn(
                                'flex items-center gap-1 rounded-lg px-1.5 py-1',
                                isSelected ? 'bg-accent/10' : 'hover:bg-surface-secondary',
                              )}
                            >
                              <button
                                type="button"
                                aria-label={element.hidden ? 'Show' : 'Hide'}
                                onClick={() => replaceElement({ ...element, hidden: !element.hidden })}
                                className="text-muted hover:text-foreground"
                              >
                                {element.hidden ? (
                                  <EyeOff className="size-3.5" />
                                ) : (
                                  <Eye className="size-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                aria-label={element.locked ? 'Unlock' : 'Lock'}
                                onClick={() => replaceElement({ ...element, locked: !element.locked })}
                                className={cn(
                                  'text-muted hover:text-foreground',
                                  element.locked && 'text-foreground',
                                )}
                              >
                                {element.locked ? (
                                  <Lock className="size-3.5" />
                                ) : (
                                  <Unlock className="size-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedIds([element.id]);
                                  setTab('properties');
                                }}
                                className="min-w-0 flex-1 truncate text-left text-meta text-foreground"
                              >
                                {element.name}
                              </button>
                              <span className="text-[10px] uppercase text-muted">{element.kind}</span>
                              <RowMenu
                                label={`Actions for ${element.name}`}
                                always
                                actions={[
                                  {
                                    id: 'up',
                                    label: 'Bring forward',
                                    icon: BringToFront,
                                    onSelect: () => {
                                      setSelectedIds([element.id]);
                                      order('forward');
                                    },
                                  },
                                  {
                                    id: 'down',
                                    label: 'Send backward',
                                    icon: SendToBack,
                                    onSelect: () => {
                                      setSelectedIds([element.id]);
                                      order('backward');
                                    },
                                  },
                                  {
                                    id: 'dup',
                                    label: 'Duplicate',
                                    icon: Copy,
                                    onSelect: () => {
                                      setSelectedIds([element.id]);
                                      applyEdit((current) => ({
                                        ...current,
                                        elements: [
                                          ...current.elements,
                                          {
                                            ...element,
                                            id: `${element.id}-${Math.random().toString(36).slice(2, 6)}`,
                                            x: element.x + 24,
                                            y: element.y + 24,
                                          },
                                        ],
                                      }));
                                    },
                                  },
                                  {
                                    id: 'del',
                                    label: 'Delete',
                                    icon: Trash2,
                                    danger: true,
                                    onSelect: () =>
                                      applyEdit((current) => ({
                                        ...current,
                                        elements: current.elements.filter(
                                          (candidate) => candidate.id !== element.id,
                                        ),
                                      })),
                                  },
                                ]}
                              />
                            </div>
                          );
                        })}
                        {doc.elements.length === 0 && (
                          <p className="px-1 py-6 text-center text-meta text-muted">
                            Nothing on the canvas yet.
                          </p>
                        )}
                      </div>
                    </ScrollShadow>
                  </PanelReveal>
                </Tabs.Panel>

                <Tabs.Panel id="properties" className="min-h-0 flex-1">
                  <PanelReveal id="properties">
                    <Inspector
                      selected={selected}
                      onPatch={patchSelected}
                      onReplace={replaceElement}
                      atomEl={atomEl}
                      onAtomEl={setAtomEl}
                    />
                  </PanelReveal>
                </Tabs.Panel>
              </Tabs>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
