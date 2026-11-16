/**
 * The studio canvas.
 *
 * One SVG holds the whole document. Zoom and pan are a transform on a single group, so
 * everything — the artboard, the elements, the selection chrome — moves together and the
 * pointer maths is one matrix inverse rather than a per-element calculation.
 *
 * The canvas owns interaction, never the document: every change goes back through `onEdit`,
 * which is what lets the studio keep one undo history for clicks, drags and typing alike.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { Artboard, type RenderContext } from './render';
import { addAtom, cycleBond, nearestAtom, nearestBond, removeAtom, toggleBond, toLocal } from './molecule';
import {
  HANDLES,
  HANDLE_ANCHOR,
  boundsOf,
  boxesOverlap,
  isLineShape,
  newIcon,
  newMath,
  newMermaid,
  newMolecule,
  newPlot,
  newSequence,
  newShape,
  newTable,
  newText,
  resizeElement,
  uid,
  type Box,
  type FigureDoc,
  type FigureElement,
  type HandleId,
  type MoleculeElement,
} from './types';
import { INSERT_TOOLS, type Tool } from './tools';

/** A box drawn while dragging: the marquee, or the shape being placed. */
interface Preview {
  box: Box;
  kind: 'marquee' | 'draw';
  tool?: Tool;
}

interface DragState {
  kind: 'move' | 'resize' | 'pan' | 'marquee' | 'draw';
  start: { x: number; y: number };
  /** Client coordinates, for pan. */
  client: { x: number; y: number };
  origins: Record<string, { x: number; y: number }>;
  handle?: HandleId;
  /** The element as it was when the drag began, for resize. */
  snapshot?: FigureElement;
  pan0?: { x: number; y: number };
  moved: boolean;
  /** Whether the move has already opened a history entry. */
  movedOnce?: boolean;
  /** The insert tool that began a draw or marquee. */
  tool?: Tool;
}

export interface CanvasProps {
  doc: FigureDoc;
  tool: Tool;
  atomEl: string;
  iconId: string;
  selectedIds: string[];
  zoom: number;
  pan: { x: number; y: number };
  snap: boolean;
  grid: boolean;
  mermaid: Record<string, import('./mermaid').MermaidDrawing>;
  onSelect: (ids: string[]) => void;
  onEdit: (updater: (doc: FigureDoc) => FigureDoc, options?: { history?: boolean }) => void;
  onViewport: (viewport: { zoom: number; pan: { x: number; y: number } }) => void;
  onToolChange: (tool: Tool) => void;
  onCursor?: (point: { x: number; y: number } | null) => void;
}

const SNAP = 10;
const MIN_DRAW = 6;

const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** Build the element a draw-tool releases into. */
function elementFor(tool: Tool, box: Box, iconId: string): FigureElement | null {
  const lineLike = tool === 'line' || tool === 'arrow';
  const over = lineLike
    ? { x: box.x, y: box.y, w: box.w, h: box.h }
    : { x: box.x, y: box.y, w: Math.max(24, box.w), h: Math.max(20, box.h) };
  switch (tool) {
    case 'rect':
    case 'roundRect':
    case 'ellipse':
    case 'triangle':
    case 'line':
    case 'arrow':
    case 'bracket':
      return newShape(tool, over);
    case 'text':
      return newText('Text', over);
    case 'math':
      return newMath('\\bar{x} = \\frac{1}{n}\\sum x_i', over);
    case 'icon':
      return newIcon(iconId, over);
    case 'plot':
      return newPlot(over);
    case 'table':
      return newTable(over);
    case 'molecule':
      return newMolecule(over);
    case 'sequence':
      return newSequence(over);
    case 'mermaid':
      return newMermaid(over);
    default:
      return null;
  }
}

export function Canvas(props: CanvasProps) {
  const { doc, tool, atomEl, iconId, selectedIds, zoom, pan, snap, grid, mermaid } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const spaceRef = useRef(false);
  const lastCursor = useRef('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bondStart, setBondStart] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  const context: RenderContext = { mermaid, editingMolecule: isMoleculeEditing(tool, doc, selectedIds) };

  /**
   * No viewBox: the SVG's user space is then its own CSS pixels, which makes the camera a
   * plain `translate(pan) scale(zoom)` and keeps artboard units equal to pixels at zoom 1.
   * A viewBox equal to the artboard would instead clip everything the moment zoom passed 1.
   */

  /** A client point in artboard coordinates. */
  const toArtboard = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  };

  /** A client point in viewBox coordinates — where zooming keeps its anchor. */
  const toViewBox = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const snapValue = (value: number): number => (snap ? Math.round(value / SNAP) * SNAP : Math.round(value));

  /** The topmost visible, unlocked element under an artboard point. */
  const elementAt = (x: number, y: number): FigureElement | null => {
    for (let index = doc.elements.length - 1; index >= 0; index -= 1) {
      const element = doc.elements[index]!;
      if (element.hidden || element.locked) continue;
      const box = boundsOf(element);
      const pad = element.kind === 'shape' && isLineShape(element.shape) ? 8 : 0;
      if (x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad) {
        return element;
      }
    }
    return null;
  };

  /* ------------------------------------------------------------------ pointer down */

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (editing) setEditing(null);
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    const point = toArtboard(event.clientX, event.clientY);

    // Pan: the pan tool, the space bar, or the middle button.
    if (tool === 'pan' || spaceRef.current || event.button === 1) {
      dragRef.current = {
        kind: 'pan',
        start: point,
        client: { x: event.clientX, y: event.clientY },
        origins: {},
        moved: false,
        pan0: pan,
      };
      event.preventDefault();
      return;
    }

    if (tool === 'atom' || tool === 'bond') {
      applyMoleculeOp(point, tool, event.shiftKey);
      return;
    }

    if (INSERT_TOOLS.includes(tool)) {
      dragRef.current = {
        kind: 'draw',
        start: point,
        client: { x: event.clientX, y: event.clientY },
        origins: {},
        moved: false,
        tool,
      };
      setPreview({ box: { x: point.x, y: point.y, w: 0, h: 0 }, kind: 'draw', tool });
      return;
    }

    // Select.
    const hit = elementAt(point.x, point.y);
    if (hit) {
      let next = selectedIds;
      if (event.shiftKey) {
        next = selectedIds.includes(hit.id)
          ? selectedIds.filter((id) => id !== hit.id)
          : [...selectedIds, hit.id];
      } else if (!selectedIds.includes(hit.id)) {
        next = [hit.id];
      }
      props.onSelect(next);
      const origins: Record<string, { x: number; y: number }> = {};
      for (const element of doc.elements) {
        if (next.includes(element.id)) origins[element.id] = { x: element.x, y: element.y };
      }
      dragRef.current = {
        kind: 'move',
        start: point,
        client: { x: event.clientX, y: event.clientY },
        origins,
        moved: false,
      };
      event.preventDefault();
      return;
    }

    if (!event.shiftKey) props.onSelect([]);
    dragRef.current = {
      kind: 'marquee',
      start: point,
      client: { x: event.clientX, y: event.clientY },
      origins: {},
      moved: false,
    };
  };

  /* ------------------------------------------------------------------ pointer move */

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = toArtboard(event.clientX, event.clientY);
    // The status bar reads the cursor, so only report a change the reader would see.
    const key = `${Math.round(point.x)},${Math.round(point.y)}`;
    if (key !== lastCursor.current) {
      lastCursor.current = key;
      props.onCursor?.(point);
    }
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;

    if (drag.kind === 'pan' && drag.pan0) {
      props.onViewport({
        zoom,
        pan: {
          x: drag.pan0.x + (event.clientX - drag.client.x),
          y: drag.pan0.y + (event.clientY - drag.client.y),
        },
      });
      return;
    }

    if (drag.kind === 'marquee' || drag.kind === 'draw') {
      const box = normalise(drag.start, point);
      setPreview({ box, kind: drag.kind, tool: drag.tool });
      return;
    }

    if (drag.kind === 'move') {
      const dx = snapValue(point.x - drag.start.x);
      const dy = snapValue(point.y - drag.start.y);
      const origins = drag.origins;
      props.onEdit(
        (current) => ({
          ...current,
          elements: current.elements.map((element) => {
            const origin = origins[element.id];
            return origin ? { ...element, x: origin.x + dx, y: origin.y + dy } : element;
          }),
        }),
        { history: !drag.movedOnce },
      );
      drag.movedOnce = true;
      return;
    }

    if (drag.kind === 'resize' && drag.snapshot && drag.handle) {
      const dx = snapValue(point.x - drag.start.x);
      const dy = snapValue(point.y - drag.start.y);
      const snapshot = drag.snapshot;
      const handle = drag.handle;
      props.onEdit(
        (current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === snapshot.id ? resizeElement(snapshot, handle, dx, dy) : element,
          ),
        }),
        { history: !drag.movedOnce },
      );
      drag.movedOnce = true;
    }
  };

  /* -------------------------------------------------------------------- pointer up */

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    svgRef.current?.releasePointerCapture(event.pointerId);
    if (!drag) return;

    if (drag.kind === 'marquee' && drag.moved) {
      const box = normalise(drag.start, toArtboard(event.clientX, event.clientY));
      const hits = doc.elements
        .filter((element) => !element.hidden && !element.locked && boxesOverlap(boundsOf(element), box))
        .map((element) => element.id);
      props.onSelect(event.shiftKey ? Array.from(new Set([...selectedIds, ...hits])) : hits);
    }

    if (drag.kind === 'draw') {
      const raw = normalise(drag.start, toArtboard(event.clientX, event.clientY));
      const small = raw.w < MIN_DRAW && raw.h < MIN_DRAW;
      const box = small ? defaultBox(drag.start, drag.tool ?? 'rect') : raw;
      const element = elementFor(drag.tool ?? 'rect', box, iconId);
      if (element) {
        props.onEdit((current) => ({ ...current, elements: [...current.elements, element] }));
        props.onSelect([element.id]);
        // Placing is done; the next press should select, not place another.
        props.onToolChange(drag.tool === 'molecule' ? 'atom' : 'select');
      }
    }

    setPreview(null);
  };

  const onDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const point = toArtboard(event.clientX, event.clientY);
    const hit = elementAt(point.x, point.y);
    if (hit?.kind === 'text') {
      setEditing({ id: hit.id, value: hit.text });
      props.onSelect([hit.id]);
    }
  };

  /* ---------------------------------------------------------------- molecule edits */

  const selectedMolecule = (): MoleculeElement | null => {
    if (selectedIds.length !== 1) return null;
    const element = doc.elements.find((candidate) => candidate.id === selectedIds[0]);
    return element && element.kind === 'molecule' ? element : null;
  };

  const applyMoleculeOp = (point: { x: number; y: number }, activeTool: Tool, shift: boolean) => {
    let molecule = selectedMolecule();

    if (activeTool === 'atom') {
      if (!molecule) {
        // Placing an atom with nothing selected starts a structure at that point.
        const created = newMolecule({
          x: point.x - 18,
          y: point.y - 18,
          w: 36,
          h: 36,
          atoms: [{ id: uid(), el: atomEl, x: 18, y: 18, charge: 0 }],
          bonds: [],
        });
        props.onEdit((current) => ({ ...current, elements: [...current.elements, created] }));
        props.onSelect([created.id]);
        return;
      }
      const local = toLocal(molecule, point.x, point.y);
      const hit = nearestAtom(molecule, local.x, local.y, 16);
      if (hit && shift) {
        const removed = hit.id;
        props.onEdit((current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === molecule!.id && element.kind === 'molecule'
              ? removeAtom(element, removed)
              : element,
          ),
        }));
        return;
      }
      props.onEdit((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === molecule!.id && element.kind === 'molecule'
            ? addAtom(element, local.x, local.y, atomEl)
            : element,
        ),
      }));
      return;
    }

    // Bond tool.
    if (!molecule) return;
    const local = toLocal(molecule, point.x, point.y);
    const atom = nearestAtom(molecule, local.x, local.y, 20);
    const bond = atom ? null : nearestBond(molecule, local.x, local.y, 10);
    const moleculeId = molecule.id;

    if (bond) {
      props.onEdit((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === moleculeId && element.kind === 'molecule' ? cycleBond(element, bond.id) : element,
        ),
      }));
      return;
    }
    if (!atom) {
      setBondStart(null);
      return;
    }
    if (!bondStart) {
      setBondStart(atom.id);
      return;
    }
    const from = bondStart;
    setBondStart(null);
    if (from === atom.id) return;
    props.onEdit((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === moleculeId && element.kind === 'molecule'
          ? toggleBond(element, from, atom.id)
          : element,
      ),
    }));
  };

  /* -------------------------------------------------------------------- viewport */

  /**
   * The wheel handler in a ref, refreshed each render: attaching a fresh closure in an effect
   * without deps detached and reattached the listener on every render, including mid-drag.
   */
  const wheel = useRef<(event: WheelEvent) => void>(() => {});
  wheel.current = (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const box = toViewBox(event.clientX, event.clientY);
      const anchor = { x: (box.x - pan.x) / zoom, y: (box.y - pan.y) / zoom };
      const next = Math.min(6, Math.max(0.12, zoom * Math.exp(-event.deltaY * 0.0022)));
      props.onViewport({ zoom: next, pan: { x: box.x - anchor.x * next, y: box.y - anchor.y * next } });
      return;
    }
    props.onViewport({ zoom, pan: { x: pan.x - event.deltaX, y: pan.y - event.deltaY } });
  };

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => wheel.current(event);
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // The space bar turns any tool into pan for as long as it is held.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceRef.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* -------------------------------------------------------------------- handles */

  const selection = doc.elements.filter((element) => selectedIds.includes(element.id) && !element.hidden);
  const single = selection.length === 1 ? selection[0] : undefined;
  const editable = tool === 'select' || tool === 'pan';

  const startResize = (event: ReactPointerEvent<SVGRectElement>, handle: HandleId) => {
    if (!single) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'resize',
      start: toArtboard(event.clientX, event.clientY),
      client: { x: event.clientX, y: event.clientY },
      origins: {},
      handle,
      snapshot: single,
      moved: false,
    };
  };

  /* -------------------------------------------------------------------- render */

  const editingElement = editing ? doc.elements.find((element) => element.id === editing.id) : undefined;

  return (
    <svg
      ref={svgRef}
      className="size-full touch-none select-none"
      style={{ cursor: tool === 'pan' ? 'grab' : INSERT_TOOLS.includes(tool) ? 'crosshair' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => props.onCursor?.(null)}
      onDoubleClick={onDoubleClick}
    >
      <defs>
        <pattern id="figure-grid" width={SNAP * 4} height={SNAP * 4} patternUnits="userSpaceOnUse">
          <path
            d={`M ${SNAP * 4} 0 L 0 0 0 ${SNAP * 4}`}
            fill="none"
            stroke="var(--border)"
            strokeWidth={0.6}
          />
        </pattern>
      </defs>

      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        <rect
          x={-2}
          y={-2}
          width={doc.width + 4}
          height={doc.height + 4}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1 / zoom}
        />
        <g style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.08))' }}>
          <Artboard doc={doc} context={context} />
        </g>
        {grid && (
          <rect
            x={0}
            y={0}
            width={doc.width}
            height={doc.height}
            fill="url(#figure-grid)"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Selection outlines. */}
        {selection.map((element) => {
          const box = boundsOf(element);
          return (
            <rect
              key={element.id}
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.4 / zoom}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              style={{ pointerEvents: 'none' }}
            />
          );
        })}

        {/* Resize handles, only for a single selection with a select tool. */}
        {single && editable && !single.locked && (
          <g>
            {HANDLES.map((handle) => {
              const box = boundsOf(single);
              const anchor = HANDLE_ANCHOR[handle];
              const size = 9 / zoom;
              return (
                <rect
                  key={handle}
                  x={box.x + anchor.x * box.w - size / 2}
                  y={box.y + anchor.y * box.h - size / 2}
                  width={size}
                  height={size}
                  rx={1.5 / zoom}
                  fill="var(--paper-raised, #fff)"
                  stroke="var(--accent)"
                  strokeWidth={1.2 / zoom}
                  style={{ cursor: HANDLE_CURSOR[handle] }}
                  onPointerDown={(event) => startResize(event, handle)}
                />
              );
            })}
          </g>
        )}

        {/* Molecule editing chrome: atom dots and the pending bond. */}
        {context.editingMolecule && (
          <MoleculeChrome doc={doc} elementId={context.editingMolecule} bondStart={bondStart} zoom={zoom} />
        )}

        {preview && (
          <rect
            x={preview.box.x}
            y={preview.box.y}
            width={preview.box.w}
            height={preview.box.h}
            fill={preview.kind === 'draw' ? 'var(--accent)' : 'var(--accent)'}
            fillOpacity={preview.kind === 'draw' ? 0.08 : 0.1}
            stroke="var(--accent)"
            strokeWidth={1.2 / zoom}
            strokeDasharray={preview.kind === 'marquee' ? `${5 / zoom} ${4 / zoom}` : undefined}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {editing && editingElement?.kind === 'text' && (
          <foreignObject
            x={editingElement.x}
            y={editingElement.y}
            width={Math.max(120, editingElement.w)}
            height={Math.max(40, editingElement.h)}
          >
            <textarea
              ref={(node) => node?.focus()}
              value={editing.value}
              onChange={(event) => setEditing({ id: editing.id, value: event.target.value })}
              onBlur={() => {
                const value = editing.value;
                props.onEdit((current) => ({
                  ...current,
                  elements: current.elements.map((element) =>
                    element.id === editing.id && element.kind === 'text'
                      ? { ...element, text: value, name: value.slice(0, 24) || element.name }
                      : element,
                  ),
                }));
                setEditing(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(null);
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  (event.target as HTMLTextAreaElement).blur();
                }
                event.stopPropagation();
              }}
              style={{
                width: '100%',
                height: '100%',
                border: '1.5px solid var(--accent)',
                background: 'white',
                color: editingElement.color,
                font: `${editingElement.italic ? 'italic ' : ''}${editingElement.fontWeight} ${editingElement.fontSize}px ui-sans-serif, system-ui, sans-serif`,
                outline: 'none',
                resize: 'none',
              }}
            />
          </foreignObject>
        )}
      </g>
    </svg>
  );
}

/* ================================================================================================
 * Helpers
 * ============================================================================================== */

function normalise(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** A sensible size for a click without a drag, by tool. */
function defaultBox(point: { x: number; y: number }, tool: Tool): Box {
  const sizes: Partial<Record<Tool, { w: number; h: number }>> = {
    rect: { w: 220, h: 140 },
    roundRect: { w: 260, h: 160 },
    ellipse: { w: 180, h: 180 },
    triangle: { w: 180, h: 160 },
    line: { w: 180, h: 0 },
    arrow: { w: 180, h: 0 },
    bracket: { w: 60, h: 200 },
    text: { w: 260, h: 44 },
    math: { w: 240, h: 60 },
    icon: { w: 96, h: 96 },
    plot: { w: 400, h: 260 },
    table: { w: 380, h: 170 },
    molecule: { w: 220, h: 200 },
    sequence: { w: 560, h: 140 },
    mermaid: { w: 520, h: 320 },
  };
  const size = sizes[tool] ?? { w: 200, h: 120 };
  return { x: point.x - size.w / 2, y: point.y - size.h / 2, w: size.w, h: size.h };
}

function isMoleculeEditing(tool: Tool, doc: FigureDoc, selectedIds: string[]): string | undefined {
  if (tool !== 'atom' && tool !== 'bond') return undefined;
  if (selectedIds.length !== 1) return undefined;
  const element = doc.elements.find((candidate) => candidate.id === selectedIds[0]);
  return element?.kind === 'molecule' ? element.id : undefined;
}

/** Atom dots and the pending bond, drawn above the structure while it is being edited. */
function MoleculeChrome({
  doc,
  elementId,
  bondStart,
  zoom,
}: {
  doc: FigureDoc;
  elementId: string;
  bondStart: string | null;
  zoom: number;
}) {
  const element = doc.elements.find((candidate) => candidate.id === elementId);
  if (!element || element.kind !== 'molecule') return null;
  const pending = bondStart ? element.atoms.find((atom) => atom.id === bondStart) : undefined;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {element.atoms.map((atom) => (
        <circle
          key={atom.id}
          cx={element.x + atom.x}
          cy={element.y + atom.y}
          r={3 / zoom + 1.5}
          fill={atom.id === bondStart ? 'var(--accent)' : 'var(--muted)'}
          opacity={0.9}
        />
      ))}
      {pending && (
        <circle
          cx={element.x + pending.x}
          cy={element.y + pending.y}
          r={12 / zoom}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2 / zoom}
        />
      )}
    </g>
  );
}
