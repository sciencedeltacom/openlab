/**
 * Exports.
 *
 * The SVG is produced from the same renderers the canvas uses — through `renderToStaticMarkup`
 * rather than the DOM — so what is downloaded is what was on screen, and a figure is never
 * exported through a second, subtly different drawing path.
 *
 * A PNG is that SVG rasterised through an `<img>`: one drawing, two formats. KaTeX's
 * stylesheet is inlined so an exported equation keeps its layout outside the app.
 */

import type { MermaidDrawing } from './mermaid';
import { Artboard } from './render';
import { figureSlug, type Figure, type FigureDoc } from './types';

const FONT_STACK = 'ui-sans-serif, system-ui, "Inter", "Helvetica Neue", Arial, sans-serif';

/** The document as a standalone SVG string. */
export async function toSvgString(doc: FigureDoc, mermaid: Record<string, MermaidDrawing>): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: katexCss } = await import('katex/dist/katex.min.css?raw');

  const body = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${doc.width} ${doc.height}`}
      width={doc.width}
      height={doc.height}
    >
      <style>{`.figure-root{font-family:${FONT_STACK};}${katexCss}`}</style>
      <Artboard doc={doc} context={{ mermaid }} />
    </svg>,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportSvg(figure: Figure, mermaid: Record<string, MermaidDrawing>): Promise<void> {
  const svg = await toSvgString(figure.doc, mermaid);
  download(`${figureSlug(figure)}.svg`, new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
}

export async function exportJson(figure: Figure): Promise<void> {
  download(
    `${figureSlug(figure)}.json`,
    new Blob([JSON.stringify(figure, null, 2)], { type: 'application/json' }),
  );
}

/** Rasterise the SVG at `scale` device pixels per artboard unit. */
export async function exportPng(
  figure: Figure,
  mermaid: Record<string, MermaidDrawing>,
  scale = 2,
): Promise<void> {
  const svg = await toSvgString(figure.doc, mermaid);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = new Image();
  image.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('the SVG could not be loaded as an image'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(figure.doc.width * scale);
  canvas.height = Math.round(figure.doc.height * scale);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('this webview has no 2D canvas context');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('the canvas produced no image');
  }
  download(`${figureSlug(figure)}@${scale}x.png`, blob);
}
