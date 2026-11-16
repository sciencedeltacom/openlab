/**
 * A PDF, drawn page by page.
 *
 * The app is a webview, and a webview that is not a browser cannot be trusted to embed a PDF:
 * on macOS WebKit will not paint one inside an iframe. So the pages are rendered here with
 * pdf.js onto canvases — the same result on every platform, and nothing to install to read a
 * paper the reader just downloaded.
 *
 * Pages are drawn in order, at the container's width, until a sane cap: a 300-page book would
 * cost more memory than a preview is worth, and the tail is a click away in its own app.
 */

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

import { Spinner } from '@/components/ui';
import { invokeCommand } from '@/lib/ipc';

/**
 * pdf.js is loaded with the viewer, not with the app: a reader who never opens a PDF pays
 * nothing for it, and the worker arrives in the same breath as the first document.
 */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** How many pages the preview draws before it stops. */
const MAX_PAGES = 40;

export function PdfView({ path, name, root }: { path: string; name: string; root: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loading: PDFDocumentLoadingTask | null = null;
    const container = host.current;

    const run = async () => {
      if (!root || !container) {
        setError('No folder is open.');
        return;
      }
      setError(null);
      setPages(null);
      container.replaceChildren();

      const result = await invokeCommand<ArrayBuffer>('read_file_binary', { path, root });
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      try {
        const pdfjs = await loadPdfjs();
        loading = pdfjs.getDocument({ data: new Uint8Array(result.value) });
        const pdf = await loading.promise;
        if (cancelled) {
          return;
        }
        setPages(pdf.numPages);
        const width = container.clientWidth || 720;
        for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number += 1) {
          if (cancelled) {
            return;
          }
          const page = await pdf.getPage(number);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2.4, Math.max(0.6, (width - 24) / base.width));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'h-auto w-full rounded-lg bg-white shadow-sm';
          const holder = document.createElement('div');
          holder.className = 'relative';
          holder.dataset.page = String(number);
          holder.appendChild(canvas);
          container.appendChild(holder);
          await page.render({ canvas, viewport }).promise;
        }
      } catch (failure) {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      container?.replaceChildren();
      void loading?.destroy();
    };
  }, [path, root]);

  if (error) {
    return <p className="px-4 py-3.5 text-body text-danger">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <div ref={host} className="flex flex-col gap-4" aria-label={name} />
      {pages === null && (
        <div className="grid place-items-center py-8">
          <Spinner />
        </div>
      )}
      {pages !== null && pages > MAX_PAGES && (
        <p className="px-1 text-meta text-muted">
          Showing the first {MAX_PAGES} of {pages} pages.
        </p>
      )}
    </div>
  );
}
