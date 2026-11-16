/**
 * A small force-directed graph.
 *
 * Self-contained on purpose: the wiki explorer needs one graph, not a rendering framework.
 * Nodes repel, edges pull, everything drifts toward the centre and cools, and a node can be
 * dragged and released. The simulation idles once it settles, so it costs nothing at rest.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

/** A node the graph draws. */
export interface GraphNode {
  id: string;
  label: string;
}

/** An edge between two node ids. */
export interface GraphEdge {
  source: string;
  target: string;
}

interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

/** Clamp a coordinate inside the padded frame. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Distance below which a node would rather not sit. */
const REST = 88;

export function ForceGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
  className,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const points = useRef<Map<string, Point>>(new Map());
  const alpha = useRef(1);
  const raf = useRef(0);
  const wake = useRef<() => void>(() => {});
  const drag = useRef<string | null>(null);
  const [size, setSize] = useState({ w: 720, h: 520 });
  const [, bump] = useState(0);

  const idsKey = useMemo(() => nodes.map((node) => node.id).join('\u0000'), [nodes]);

  // Track the frame.
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) {
      return;
    }
    const measure = () =>
      setSize({ w: Math.max(240, element.clientWidth), h: Math.max(240, element.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Seed positions on the circle, drop the nodes that left.
  useEffect(() => {
    const map = points.current;
    const radius = Math.min(size.w, size.h) * 0.36;
    nodes.forEach((node, index) => {
      if (!map.has(node.id)) {
        const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
        map.set(node.id, {
          x: size.w / 2 + Math.cos(angle) * radius,
          y: size.h / 2 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
          fixed: false,
        });
      }
    });
    const keep = new Set(nodes.map((node) => node.id));
    for (const key of [...map.keys()]) {
      if (!keep.has(key)) {
        map.delete(key);
      }
    }
    alpha.current = 1;
  }, [idsKey, size.w, size.h]);

  // The simulation. Recreated when the graph changes; idle once cold.
  useEffect(() => {
    let running = true;

    const step = () => {
      const map = points.current;
      const { w, h } = size;
      const list = nodes
        .map((node) => map.get(node.id))
        .filter((point): point is Point => point !== undefined);
      const circulating = alpha.current;

      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]!;
          const b = list[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy || 0.01;
          const d = Math.sqrt(d2);
          const force = 4200 / d2;
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      for (const edge of edges) {
        const a = map.get(edge.source);
        const b = map.get(edge.target);
        if (!a || !b) {
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (d - REST) * 0.02;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      for (const point of list) {
        point.vx += (w / 2 - point.x) * 0.0025;
        point.vy += (h / 2 - point.y) * 0.0025;
        point.vx *= 0.85;
        point.vy *= 0.85;
        if (!point.fixed) {
          point.x = clamp(point.x + point.vx * circulating, 26, w - 26);
          point.y = clamp(point.y + point.vy * circulating, 26, h - 26);
        }
      }

      alpha.current = Math.max(0, circulating - 0.01);
    };

    const frame = () => {
      if (!running) {
        return;
      }
      // Cold: the graph has settled, so stop the loop rather than poll forever — and skip the
      // O(n^2) pass.
      if (alpha.current <= 0.02) {
        raf.current = 0;
        return;
      }
      step();
      bump((value) => value + 1);
      raf.current = requestAnimationFrame(frame);
    };
    // A drag warms alpha again, so it has to restart an idle loop.
    wake.current = () => {
      if (!running || raf.current) {
        return;
      }
      raf.current = requestAnimationFrame(frame);
    };
    wake.current();
    return () => {
      running = false;
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      wake.current = () => {};
    };
  }, [nodes, edges, size]);

  const moveTo = (event: React.PointerEvent) => {
    const id = drag.current;
    const element = wrapRef.current;
    if (!id || !element) {
      return;
    }
    const point = points.current.get(id);
    if (!point) {
      return;
    }
    const rect = element.getBoundingClientRect();
    point.x = clamp(event.clientX - rect.left, 26, size.w - 26);
    point.y = clamp(event.clientY - rect.top, 26, size.h - 26);
    point.vx = 0;
    point.vy = 0;
    alpha.current = Math.max(alpha.current, 0.5);
    bump((value) => value + 1);
    wake.current();
  };

  const release = () => {
    if (drag.current) {
      const point = points.current.get(drag.current);
      if (point) {
        point.fixed = false;
      }
    }
    drag.current = null;
  };

  const showLabels = nodes.length <= 60;

  return (
    <div
      ref={wrapRef}
      className={className}
      onPointerMove={moveTo}
      onPointerUp={release}
      onPointerLeave={release}
    >
      <svg width={size.w} height={size.h} className="touch-none select-none">
        <g>
          {edges.map((edge, index) => {
            const a = points.current.get(edge.source);
            const b = points.current.get(edge.target);
            if (!a || !b) {
              return null;
            }
            return (
              <line
                key={`${edge.source}>${edge.target}-${index}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--separator)"
                strokeWidth={1}
              />
            );
          })}
        </g>
        <g>
          {nodes.map((node) => {
            const point = points.current.get(node.id);
            if (!point) {
              return null;
            }
            const active = node.id === selectedId;
            return (
              <g
                key={node.id}
                transform={`translate(${point.x} ${point.y})`}
                className="cursor-pointer"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const current = points.current.get(node.id);
                  if (current) {
                    current.fixed = true;
                  }
                  drag.current = node.id;
                  alpha.current = Math.max(alpha.current, 0.5);
                  wake.current();
                }}
                onClick={() => onSelect(node.id)}
              >
                <circle
                  r={active ? 10 : 6.5}
                  fill={active ? 'var(--accent)' : 'var(--surface)'}
                  stroke={active ? 'var(--accent)' : 'var(--field-border, var(--border))'}
                  strokeWidth={1.5}
                />
                {(showLabels || active) && (
                  <text
                    y={active ? 24 : 20}
                    textAnchor="middle"
                    className="pointer-events-none"
                    fill={active ? 'var(--foreground)' : 'var(--muted)'}
                    style={{ fontSize: 11 }}
                  >
                    {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
