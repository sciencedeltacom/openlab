/**
 * The element renderers.
 *
 * Each element is drawn with the SVG primitives that match its kind, in artboard units, so
 * the same code paints the screen and produces the export — there is no second renderer to
 * drift. A renderer never reads the screen: it is a pure function of one element, which is
 * what makes a figure reproducible and exportable.
 */

import type { ReactNode } from 'react';
import katex from 'katex';

import { IconGlyph } from './icons';
import type { MermaidDrawing } from './mermaid';
import {
  PALETTE,
  isLineShape,
  type Atom,
  type FigureDoc,
  type FigureElement,
  type MoleculeElement,
  type PlotElement,
  type SequenceElement,
  type ShapeElement,
  type TableElement,
  type TextElement,
} from './types';

/** How the figure is drawn: the one piece of volatile state is the rendered mermaid. */
export interface RenderContext {
  /** Rendered mermaid, keyed by element id. Absent until the diagram has rendered. */
  mermaid?: Record<string, MermaidDrawing>;
  /** The molecule being edited by hand, whose implicit carbons are shown. */
  editingMolecule?: string;
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';
const SANS = 'ui-sans-serif, system-ui, "Inter", "Helvetica Neue", Arial, sans-serif';

function fontFamily(name: TextElement['font']): string {
  return name === 'mono' ? MONO : name === 'serif' ? SERIF : SANS;
}

/* ================================================================================================
 * Shapes
 * ============================================================================================== */

function polygonPoints(kind: 'triangle' | 'diamond' | 'hexagon', w: number, h: number): string {
  switch (kind) {
    case 'triangle':
      return `${w / 2},0 ${w},${h} 0,${h}`;
    case 'diamond':
      return `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
    case 'hexagon':
      return `${w * 0.25},0 ${w * 0.75},0 ${w},${h / 2} ${w * 0.75},${h} ${w * 0.25},${h} 0,${h / 2}`;
  }
}

function ShapeView({ element }: { element: ShapeElement }) {
  const { shape, w, h, fill, stroke, strokeWidth, dashed, radius } = element;
  const dash = dashed ? `${strokeWidth * 4} ${strokeWidth * 3}` : undefined;

  if (isLineShape(shape)) {
    const angle = Math.atan2(h, w);
    const head = 4 + strokeWidth * 2.2;
    const startsArrow = shape === 'arrow' || shape === 'doubleArrow';
    const endsArrow = shape === 'doubleArrow' || shape === 'arrow';
    const x1 = 0;
    const y1 = 0;
    const x2 = w;
    const y2 = h;
    const sx = startsArrow ? x1 + Math.cos(angle) * head : x1;
    const sy = startsArrow ? y1 + Math.sin(angle) * head : y1;
    const ex = endsArrow ? x2 - Math.cos(angle) * head : x2;
    const ey = endsArrow ? y2 - Math.sin(angle) * head : y2;
    return (
      <g>
        <line
          x1={sx}
          y1={sy}
          x2={ex}
          y2={ey}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
        {startsArrow && <path d={arrowPath(x1, y1, angle, head * 1.9)} fill={stroke} />}
        {endsArrow && <path d={arrowPath(x2, y2, angle + Math.PI, head * 1.9)} fill={stroke} />}
      </g>
    );
  }

  if (shape === 'bracket' || shape === 'brace') {
    const d =
      shape === 'bracket'
        ? `M${w} 0 H0 V${h} H${w}`
        : `M${w} 0 C${w * 0.4} 0 ${w * 0.6} ${h * 0.1} ${w * 0.5} ${h * 0.5} C${w * 0.6} ${h * 0.9} ${w * 0.4} ${h} ${w} ${h}`;
    return (
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  const common = { fill: fill === PALETTE.none ? 'none' : fill, stroke, strokeWidth, strokeDasharray: dash };
  switch (shape) {
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
    case 'triangle':
    case 'diamond':
    case 'hexagon':
      return <polygon points={polygonPoints(shape, w, h)} strokeLinejoin="round" {...common} />;
    case 'roundRect':
      return <rect x={0} y={0} width={w} height={h} rx={radius} ry={radius} {...common} />;
    default:
      return <rect x={0} y={0} width={w} height={h} rx={2} {...common} />;
  }
}

/** A chevron arrowhead as a path, so it needs no fill rule for thin strokes. */
function arrowPath(x: number, y: number, angle: number, size: number): string {
  const p1x = x - size * Math.cos(angle - Math.PI / 7);
  const p1y = y - size * Math.sin(angle - Math.PI / 7);
  const p2x = x - size * Math.cos(angle + Math.PI / 7);
  const p2y = y - size * Math.sin(angle + Math.PI / 7);
  return `M${x} ${y} L${p1x} ${p1y} L${p2x} ${p2y} Z`;
}

/* ================================================================================================
 * Text and math
 * ============================================================================================== */

/** Break a paragraph into lines that fit a width, at an approximate character size. */
function wrapLines(text: string, maxWidth: number, fontSize: number): string[] {
  if (maxWidth <= 0) return text.split('\n');
  // A rough advance width per character. Exact metrics would need the font loaded and
  // measured; a figure's text box is a layout aid, not a typesetter.
  const perChar = fontSize * 0.54;
  const maxChars = Math.max(4, Math.floor(maxWidth / perChar));
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= maxChars) {
      lines.push(paragraph);
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && line.length + 1 + word.length > maxChars) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function TextElementView({ element }: { element: TextElement }) {
  const lines = wrapLines(element.text, element.w, element.fontSize);
  const lineHeight = element.fontSize * 1.28;
  const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start';
  const x = element.align === 'center' ? element.w / 2 : element.align === 'right' ? element.w : 0;
  return (
    <text
      x={x}
      y={element.fontSize}
      fill={element.color}
      fontFamily={fontFamily(element.font)}
      fontSize={element.fontSize}
      fontWeight={element.fontWeight}
      fontStyle={element.italic ? 'italic' : undefined}
      textAnchor={anchor}
    >
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : lineHeight}>
          {line || ' '}
        </tspan>
      ))}
    </text>
  );
}

function katexHtml(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false, output: 'html' });
  } catch {
    return `<span style="color:${PALETTE.coral}">${latex}</span>`;
  }
}

function MathElementView({ element }: { element: import('./types').MathElement }) {
  // KaTeX is HTML; an SVG `foreignObject` is how HTML lives inside a vector drawing. The
  // wrapper is the element's own box, so moving the box moves the equation.
  return (
    <foreignObject x={0} y={0} width={element.w} height={element.h} style={{ overflow: 'visible' }}>
      <div
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: katexHtml(element.latex, element.display) }}
        style={{
          color: element.color,
          fontSize: element.fontSize,
          textAlign: element.align,
          lineHeight: 1.2,
          width: element.w,
        }}
      />
    </foreignObject>
  );
}

/* ================================================================================================
 * Icon
 * ============================================================================================== */

function IconElementView({ element }: { element: import('./types').IconElement }) {
  return (
    <svg
      x={0}
      y={0}
      width={element.w}
      height={element.h}
      viewBox="0 0 24 24"
      style={{ color: element.color }}
    >
      <IconGlyph id={element.iconId} strokeWidth={element.strokeWidth} />
    </svg>
  );
}

/* ================================================================================================
 * Plot
 * ============================================================================================== */

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function PlotElementView({ element }: { element: PlotElement }) {
  const { w, h, series, plotKind, color, accent, axes, grid, legend, title, xLabel, yLabel } = element;
  const padTop = title ? 30 : 14;
  const padRight = legend ? 78 : 16;
  const padBottom = xLabel ? 40 : 22;
  const padLeft = axes ? (yLabel ? 54 : 40) : 12;
  const plotW = Math.max(10, w - padLeft - padRight);
  const plotH = Math.max(10, h - padTop - padBottom);
  const max = niceMax(Math.max(1, ...series.map((point) => point.value)));
  const body: ReactNode[] = [];

  if (plotKind === 'pie') {
    const total = series.reduce((sum, point) => sum + Math.max(0, point.value), 0) || 1;
    const colors = [color, accent, PALETTE.teal, PALETTE.amber, PALETTE.violet, PALETTE.pink];
    const cx = w / 2;
    const cy = padTop + plotH / 2;
    const r = Math.min(plotW, plotH) / 2 - 4;
    let angle = -Math.PI / 2;
    series.forEach((point, index) => {
      const slice = (Math.max(0, point.value) / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + slice);
      const y2 = cy + r * Math.sin(angle + slice);
      const large = slice > Math.PI ? 1 : 0;
      body.push(
        <path
          key={point.label}
          d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
          fill={colors[index % colors.length]}
          stroke={PALETTE.paper}
          strokeWidth={1.5}
        />,
      );
      angle += slice;
    });
    return <g>{body}</g>;
  }

  const x = (index: number) =>
    padLeft + (series.length === 1 ? plotW / 2 : (index / (series.length - 1)) * plotW);
  const y = (value: number) => padTop + plotH - (value / max) * plotH;

  if (grid || axes) {
    const ticks = 4;
    // A small range (an AUROC, a probability) needs decimals; a large one does not.
    const label = (value: number) =>
      max <= 5 ? String(Math.round(value * 100) / 100) : String(Math.round(value));
    for (let index = 0; index <= ticks; index += 1) {
      const gy = padTop + (index / ticks) * plotH;
      if (grid && index > 0 && index < ticks) {
        body.push(
          <line
            key={`g${index}`}
            x1={padLeft}
            y1={gy}
            x2={padLeft + plotW}
            y2={gy}
            stroke={PALETTE.line}
            strokeWidth={1}
          />,
        );
      }
      if (axes) {
        body.push(
          <text
            key={`t${index}`}
            x={padLeft - 6}
            y={gy + 4}
            textAnchor="end"
            fontSize={11}
            fill={PALETTE.muted}
          >
            {label(((ticks - index) / ticks) * max)}
          </text>,
        );
      }
    }
  }

  if (plotKind === 'bar') {
    const gap = series.length > 1 ? plotW / series.length : plotW;
    const barW = Math.min(64, gap * 0.6);
    series.forEach((point, index) => {
      const cx = padLeft + (index + 0.5) * gap;
      const barH = (point.value / max) * plotH;
      body.push(
        <rect
          key={point.label}
          x={cx - barW / 2}
          y={padTop + plotH - barH}
          width={barW}
          height={Math.max(1, barH)}
          rx={3}
          fill={color}
        />,
      );
    });
  } else {
    const points = series.map((point, index) => ({ x: x(index), y: y(point.value) }));
    if (plotKind === 'area') {
      body.push(
        <path
          key="area"
          d={`M${points[0]?.x ?? padLeft} ${padTop + plotH} ${points.map((p) => `L${p.x} ${p.y}`).join(' ')} L${points.at(-1)?.x ?? padLeft} ${padTop + plotH} Z`}
          fill={color}
          opacity={0.18}
        />,
      );
    }
    if (plotKind === 'line' || plotKind === 'area') {
      body.push(
        <polyline
          key="line"
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />,
      );
    }
    body.push(
      <g key="dots">
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={plotKind === 'scatter' ? 5 : 3.5}
            fill={plotKind === 'scatter' ? accent : color}
          />
        ))}
      </g>,
    );
  }

  if (axes) {
    body.push(
      <line
        key="ax"
        x1={padLeft}
        y1={padTop}
        x2={padLeft}
        y2={padTop + plotH}
        stroke={PALETTE.muted}
        strokeWidth={1}
      />,
    );
    body.push(
      <line
        key="ay"
        x1={padLeft}
        y1={padTop + plotH}
        x2={padLeft + plotW}
        y2={padTop + plotH}
        stroke={PALETTE.muted}
        strokeWidth={1}
      />,
    );
  }

  series.forEach((point, index) => {
    if (plotKind === 'bar') {
      const gap = series.length > 1 ? plotW / series.length : plotW;
      const cx = padLeft + (index + 0.5) * gap;
      body.push(
        <text
          key={`x${point.label}`}
          x={cx}
          y={padTop + plotH + 16}
          textAnchor="middle"
          fontSize={11}
          fill={PALETTE.muted}
        >
          {point.label}
        </text>,
      );
    } else {
      body.push(
        <text
          key={`x${point.label}`}
          x={x(index)}
          y={padTop + plotH + 16}
          textAnchor="middle"
          fontSize={11}
          fill={PALETTE.muted}
        >
          {point.label}
        </text>,
      );
    }
  });

  if (title) {
    body.push(
      <text key="title" x={padLeft} y={16} fontSize={13} fontWeight={600} fill={PALETTE.ink}>
        {title}
      </text>,
    );
  }
  if (xLabel) {
    body.push(
      <text
        key="xlabel"
        x={padLeft + plotW / 2}
        y={h - 6}
        textAnchor="middle"
        fontSize={12}
        fill={PALETTE.ink}
      >
        {xLabel}
      </text>,
    );
  }
  if (yLabel) {
    body.push(
      <text
        key="ylabel"
        x={14}
        y={padTop + plotH / 2}
        textAnchor="middle"
        fontSize={12}
        fill={PALETTE.ink}
        transform={`rotate(-90 14 ${padTop + plotH / 2})`}
      >
        {yLabel}
      </text>,
    );
  }
  if (legend) {
    const colors = [color, accent];
    series.forEach((point, index) => {
      const ly = padTop + index * 18;
      body.push(
        <rect
          key={`lk${index}`}
          x={w - padRight + 8}
          y={ly}
          width={10}
          height={10}
          rx={2}
          fill={colors[index % colors.length]}
        />,
      );
      body.push(
        <text key={`lt${index}`} x={w - padRight + 24} y={ly + 9} fontSize={11} fill={PALETTE.ink}>
          {point.label}
        </text>,
      );
    });
  }

  return <g>{body}</g>;
}

/* ================================================================================================
 * Molecule
 * ============================================================================================== */

function atomLabel(atom: Atom, showCarbons: boolean): string | null {
  const isCarbon = atom.el === 'C';
  if (isCarbon && !showCarbons && atom.charge === 0) return null;
  const charge =
    atom.charge === 0
      ? ''
      : atom.charge > 0
        ? atom.charge === 1
          ? '⁺'
          : `${atom.charge}⁺`
        : atom.charge === -1
          ? '⁻'
          : `${Math.abs(atom.charge)}⁻`;
  return `${atom.el}${charge}`;
}

function MoleculeView({ element, showCarbons }: { element: MoleculeElement; showCarbons: boolean }) {
  const byId = new Map(element.atoms.map((atom) => [atom.id, atom]));
  const bonds: ReactNode[] = [];
  for (const bond of element.bonds) {
    const a = byId.get(bond.a);
    const b = byId.get(bond.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offsets = bond.order === 1 ? [0] : bond.order === 2 ? [-3, 3] : [-4, 0, 4];
    for (const offset of offsets) {
      bonds.push(
        <line
          key={`${bond.id}-${offset}`}
          x1={a.x + nx * offset}
          y1={a.y + ny * offset}
          x2={b.x + nx * offset}
          y2={b.y + ny * offset}
          stroke={element.color}
          strokeWidth={2}
          strokeLinecap="round"
        />,
      );
    }
  }
  return (
    <g>
      {bonds}
      {element.atoms.map((atom) => {
        const label = atomLabel(atom, showCarbons || element.showCarbons);
        if (!label) return null;
        return (
          <text
            key={atom.id}
            x={atom.x}
            y={atom.y + 5}
            textAnchor="middle"
            fontSize={16}
            fontWeight={600}
            fill={element.color}
            stroke={PALETTE.paper}
            strokeWidth={4}
            paintOrder="stroke"
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}

/* ================================================================================================
 * Sequence
 * ============================================================================================== */

const DNA_COLOR: Record<string, string> = {
  A: '#2FBF8F',
  C: '#1E5DB3',
  G: '#F2A93B',
  T: '#E5534B',
  U: '#E5534B',
};

function SequenceView({ element }: { element: SequenceElement }) {
  const wrap = Math.max(10, element.wrap);
  const lineHeight = 22;
  const rows: string[] = [];
  for (let index = 0; index < element.sequence.length; index += wrap) {
    rows.push(element.sequence.slice(index, index + wrap));
  }
  const trackY = 6;
  return (
    <g>
      {element.features.map((feature, index) => {
        const row = Math.floor((feature.start - 1) / wrap);
        const startCol = (feature.start - 1) % wrap;
        const endCol = (Math.min(feature.end, (row + 1) * wrap) - 1) % wrap;
        const x = startCol * 12 + 8;
        const width = Math.max(8, (endCol - startCol + 1) * 12);
        const y = trackY + index * 22;
        void row;
        return (
          <g key={feature.id}>
            <rect x={x} y={y} width={width} height={14} rx={3} fill={feature.color} opacity={0.85} />
            {feature.label && (
              <text x={x + width + 6} y={y + 11} fontSize={11} fill={PALETTE.ink}>
                {feature.label}
              </text>
            )}
          </g>
        );
      })}
      {rows.map((row, rowIndex) => (
        <text
          key={rowIndex}
          x={8}
          y={trackY + element.features.length * 22 + (rowIndex + 1) * lineHeight}
          fontFamily={MONO}
          fontSize={15}
          letterSpacing={element.seqType === 'dna' ? 2 : 1}
        >
          {row.split('').map((base, baseIndex) => (
            <tspan
              key={baseIndex}
              fill={element.seqType === 'dna' ? (DNA_COLOR[base] ?? element.color) : element.color}
            >
              {base}
            </tspan>
          ))}
        </text>
      ))}
    </g>
  );
}

/* ================================================================================================
 * Mermaid, table, background
 * ============================================================================================== */

function MermaidView({ element, drawing }: { element: FigureElement; drawing?: MermaidDrawing }) {
  if (!drawing) {
    // A diagram that has not rendered yet: a small node graph, so a thumbnail still reads
    // as "a diagram" and the canvas does not flash an empty box while mermaid works.
    const w = element.w;
    const h = element.h;
    const boxW = Math.min(90, w * 0.28);
    const boxH = Math.min(46, h * 0.2);
    const row = (h - boxH) / 2;
    return (
      <g>
        <rect x={0} y={0} width={w} height={h} rx={10} fill="#F4F6F8" />
        <g fill={PALETTE.paper} stroke={PALETTE.line} strokeWidth={2}>
          <rect x={w * 0.06} y={row} width={boxW} height={boxH} rx={6} />
          <rect x={w * 0.5 - boxW / 2} y={h * 0.14} width={boxW} height={boxH} rx={6} />
          <rect x={w * 0.5 - boxW / 2} y={h * 0.66} width={boxW} height={boxH} rx={6} />
          <rect x={w * 0.94 - boxW} y={row} width={boxW} height={boxH} rx={6} />
        </g>
        <g stroke={PALETTE.line} strokeWidth={2} fill="none">
          <path d={`M${w * 0.06 + boxW} ${row + boxH / 2} L${w * 0.5 - boxW / 2} ${h * 0.14 + boxH / 2}`} />
          <path d={`M${w * 0.06 + boxW} ${row + boxH / 2} L${w * 0.5 - boxW / 2} ${h * 0.66 + boxH / 2}`} />
          <path d={`M${w * 0.5 + boxW / 2} ${h * 0.14 + boxH / 2} L${w * 0.94 - boxW} ${row + boxH / 2}`} />
          <path d={`M${w * 0.5 + boxW / 2} ${h * 0.66 + boxH / 2} L${w * 0.94 - boxW} ${row + boxH / 2}`} />
        </g>
      </g>
    );
  }
  const scale = Math.min(element.w / drawing.width, element.h / drawing.height);
  const dx = (element.w - drawing.width * scale) / 2;
  const dy = (element.h - drawing.height * scale) / 2;
  return (
    <g transform={`translate(${dx} ${dy}) scale(${scale})`}>
      {/*
        Mermaid writes its stylesheet scoped to the id of the `<svg>` it produced. Keeping
        that id on the wrapper is what keeps the diagram's own CSS applying — without it,
        every node falls back to the SVG default of solid black.
      */}
      {/* eslint-disable-next-line react/no-danger */}
      <g id={drawing.id} dangerouslySetInnerHTML={{ __html: drawing.markup }} />
    </g>
  );
}

function TableView({ element }: { element: TableElement }) {
  const cols = Math.max(1, element.columns.length);
  const colW = element.w / cols;
  const rowH = Math.min(34, element.h / (element.rows.length + 1));
  return (
    <g fontFamily={SANS} fontSize={element.fontSize}>
      <rect
        x={0}
        y={0}
        width={element.w}
        height={element.h}
        rx={6}
        fill={PALETTE.paper}
        stroke={PALETTE.line}
      />
      <rect x={0} y={0} width={element.w} height={rowH} rx={6} fill={element.headerFill} />
      {element.columns.map((column, index) => (
        <text
          key={index}
          x={index * colW + 12}
          y={rowH / 2 + element.fontSize * 0.35}
          fill={PALETTE.paper}
          fontWeight={600}
        >
          {column}
        </text>
      ))}
      {element.rows.map((row, rowIndex) =>
        row.map((cell, colIndex) => (
          <text
            key={`${rowIndex}-${colIndex}`}
            x={colIndex * colW + 12}
            y={rowH * (rowIndex + 1) + rowH / 2 + element.fontSize * 0.35}
            fill={element.color}
          >
            {cell}
          </text>
        )),
      )}
      {element.zebra &&
        element.rows.map((_, rowIndex) =>
          rowIndex % 2 === 1 ? (
            <rect
              key={rowIndex}
              x={0}
              y={rowH * (rowIndex + 1)}
              width={element.w}
              height={rowH}
              fill={PALETTE.ink}
              opacity={0.03}
            />
          ) : null,
        )}
      {element.rows.map((_, rowIndex) => (
        <line
          key={`r${rowIndex}`}
          x1={0}
          y1={rowH * (rowIndex + 1)}
          x2={element.w}
          y2={rowH * (rowIndex + 1)}
          stroke={PALETTE.line}
        />
      ))}
      {element.columns.map((_, colIndex) =>
        colIndex === 0 ? null : (
          <line
            key={`c${colIndex}`}
            x1={colIndex * colW}
            y1={0}
            x2={colIndex * colW}
            y2={element.h}
            stroke={PALETTE.line}
          />
        ),
      )}
    </g>
  );
}

/* ================================================================================================
 * The element dispatch
 * ============================================================================================== */

/** Draw one element, positioned and rotated in artboard space. */
export function ElementView({ element, context }: { element: FigureElement; context: RenderContext }) {
  if (element.hidden) return null;

  // A line keeps its own origin because its `w`/`h` are a signed delta from it; everything
  // else is drawn from the top-left of its box.
  const isLine = element.kind === 'shape' && isLineShape(element.shape);
  const box = isLine
    ? { x: element.x, y: element.y, w: element.w, h: element.h }
    : { x: element.x, y: element.y, w: element.w, h: element.h };

  let body: ReactNode;
  switch (element.kind) {
    case 'shape':
      body = <ShapeView element={element} />;
      break;
    case 'text':
      body = <TextElementView element={element} />;
      break;
    case 'math':
      body = <MathElementView element={element} />;
      break;
    case 'icon':
      body = <IconElementView element={element} />;
      break;
    case 'plot':
      body = <PlotElementView element={element} />;
      break;
    case 'molecule':
      body = <MoleculeView element={element} showCarbons={context.editingMolecule === element.id} />;
      break;
    case 'sequence':
      body = <SequenceView element={element} />;
      break;
    case 'mermaid':
      body = <MermaidView element={element} drawing={context.mermaid?.[element.id]} />;
      break;
    case 'table':
      body = <TableView element={element} />;
      break;
  }

  const transform =
    element.rotation && !isLine
      ? `translate(${box.x} ${box.y}) rotate(${element.rotation} ${element.w / 2} ${element.h / 2})`
      : `translate(${box.x} ${box.y})`;

  return (
    <g transform={transform} opacity={element.opacity} data-element={element.id}>
      {body}
    </g>
  );
}

/** The artboard: background and every element, in z-order. */
export function Artboard({ doc, context }: { doc: FigureDoc; context: RenderContext }) {
  return (
    <>
      <rect x={0} y={0} width={doc.width} height={doc.height} fill={doc.background} />
      {doc.elements.map((element) => (
        <ElementView key={element.id} element={element} context={context} />
      ))}
    </>
  );
}
