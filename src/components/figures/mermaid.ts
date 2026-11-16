/**
 * Mermaid, as one element kind.
 *
 * Mermaid owns a global config and renders asynchronously into a detached node, so it cannot
 * be called from a React render. This module is the queue in front of it: one render at a
 * time, results cached by source and tone, and only the inner markup of the produced SVG is
 * kept — the canvas places that markup in its own coordinate space, so the diagram can be
 * moved, scaled and exported like any other element.
 *
 * The diagram is rendered with `htmlLabels: false` wherever mermaid allows it, so labels are
 * SVG `<text>` rather than a `<foreignObject>`: the result is a vector drawing that survives
 * raster export and opens in a vector editor.
 */

import { PALETTE } from './types';

export interface MermaidDrawing {
  /** The root `<svg>`'s id. Mermaid scopes its stylesheet with it, so the wrapper must wear it. */
  id: string;
  /** The `<svg>` element's contents, ready to inline into a `<g>`. */
  markup: string;
  width: number;
  height: number;
}

const cache = new Map<string, MermaidDrawing>();
const pending = new Map<string, Promise<MermaidDrawing>>();

let queue: Promise<unknown> = Promise.resolve();
let initialised = false;

/** The mermaid theme variables that pull a diagram toward the figure's palette. */
function themeVariables(tone: 'neutral' | 'ink') {
  if (tone === 'neutral') {
    return undefined;
  }
  return {
    primaryColor: PALETTE.paper,
    primaryBorderColor: PALETTE.ink,
    primaryTextColor: PALETTE.ink,
    lineColor: PALETTE.ink,
    secondaryColor: '#EEF2F7',
    tertiaryColor: '#F4F6F8',
    fontFamily: 'inherit',
  };
}

function parseDrawing(svg: string): MermaidDrawing {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement as unknown as SVGSVGElement;
  const viewBox = root.getAttribute('viewBox');
  let width = Number(root.getAttribute('width')) || 0;
  let height = Number(root.getAttribute('height')) || 0;
  if (viewBox) {
    const [, , w, h] = viewBox.split(/[\s,]+/).map(Number);
    if (w && h) {
      width = w;
      height = h;
    }
  }
  // A `style="max-width:…"` on the root would fight the element's own box.
  root.removeAttribute('style');
  return {
    id: root.getAttribute('id') ?? '',
    markup: root.innerHTML,
    width: width || 600,
    height: height || 400,
  };
}

/** Run `work` after everything already queued, keeping one mermaid render in flight. */
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/** Render `source` to inline markup, memoised. Rejections are not cached. */
export function renderMermaid(source: string, tone: 'neutral' | 'ink'): Promise<MermaidDrawing> {
  const key = `${tone}::${source}`;
  const cached = cache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const inFlight = pending.get(key);
  if (inFlight) {
    return inFlight;
  }

  const task = enqueue(async () => {
    const mermaid = (await import('mermaid')).default;
    if (!initialised) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      initialised = true;
    }
    // Theme is global, so it is set per render and the whole thing is serialised.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'inherit',
      flowchart: { htmlLabels: false, useMaxWidth: false },
      class: { htmlLabels: false, useMaxWidth: false },
      sequence: { useMaxWidth: false },
      state: { useMaxWidth: false },
      er: { useMaxWidth: false },
      journey: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      themeVariables: themeVariables(tone),
    });
    const id = `ol-mmd-${Math.random().toString(36).slice(2, 10)}`;
    const { svg } = await mermaid.render(id, source);
    const drawing = parseDrawing(svg);
    cache.set(key, drawing);
    return drawing;
  }).finally(() => pending.delete(key));

  pending.set(key, task);
  return task;
}

/** A React hook around {@link renderMermaid}: null while it renders, null if it cannot. */
export { renderMermaid as renderMermaidSource };
