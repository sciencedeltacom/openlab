/**
 * Full text over the review's PDFs.
 *
 * The records on this step are metadata; this panel is where their files become searchable.
 * "Scan PDFs" indexes the open-access copy of every record that has a DOI — the worker
 * decides how to read each file — and the search box asks the local index: BM25 and vectors
 * fused, answered with the passage and the page it came from.
 *
 * The index lives in the project's `.openlab` folder so it travels with the workspace; the
 * folder field pins it somewhere else (a shared drive, a global cache).
 */

import { useEffect, useState } from 'react';
import { FileSearch, FolderOpen, LoaderCircle, ScanLine } from 'lucide-react';

import { Button, Chip, Input, SectionLabel } from '@/components/ui';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import { onScanProgress, scanPdf, scanRoot, searchLibrary } from '@/lib/scan/ipc';
import type { ScanProgress, ScanSearchResult } from '@/lib/scan/types';
import type { Paper } from '../data';

export function FullTextPanel({ papers }: { papers: Paper[] }) {
  const { state, dispatch } = useApp();
  const project = activeProject(state);
  const root = scanRoot(project?.path ?? null, state.indexRoot);

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ScanSearchResult | null>(null);
  const [busy, setBusy] = useState<'search' | 'scan' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanned, setScanned] = useState<Record<string, string>>({});

  useEffect(() => {
    let stop: (() => void) | undefined;
    void onScanProgress(setProgress).then((unlisten) => {
      stop = unlisten;
    });
    return () => stop?.();
  }, []);

  const search = async () => {
    if (!query.trim() || !root) {
      return;
    }
    setBusy('search');
    setError(null);
    const response = await searchLibrary(root, query, { docIds: papers.map((paper) => paper.id), limit: 12 });
    setBusy(null);
    if (!response.ok) {
      setError(response.error.message);
      setResult(null);
      return;
    }
    setResult(response.value);
  };

  const scanAll = async () => {
    if (!root) {
      setError('Open a workspace folder first: the index lives in it.');
      return;
    }
    const targets = papers.filter((paper) => paper.doi);
    if (targets.length === 0) {
      setError('No record here has a DOI to look an open-access copy up by.');
      return;
    }
    setBusy('scan');
    setError(null);
    for (const paper of targets) {
      setProgress({ id: paper.id, phase: 'queued', pct: 0 });
      const response = await scanPdf(root, { doi: paper.doi, docId: paper.id, title: paper.title });
      setScanned((current) => ({ ...current, [paper.id]: response.ok ? response.value.status : 'failed' }));
    }
    setBusy(null);
    setProgress(null);
  };

  const indexable = papers.filter((paper) => paper.doi).length;

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>Full text</SectionLabel>
        <Chip size="sm" variant="soft" color="default">
          {indexable} with a DOI
        </Chip>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto gap-1.5"
          isDisabled={busy !== null}
          onPress={() => void scanAll()}
        >
          <ScanLine className="size-3.5" />
          {busy === 'scan' ? 'Scanning…' : 'Scan PDFs'}
        </Button>
      </div>

      <p className="max-w-[80ch] text-meta text-muted">
        Indexes the open-access copy of each record, then searches the text, with BM25 and vectors fused.
      </p>

      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the full text…"
          aria-label="Full-text query"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void search();
            }
          }}
        />
        <Button
          size="sm"
          variant="primary"
          className="shrink-0 gap-1.5"
          isDisabled={busy !== null || !query.trim()}
          onPress={() => void search()}
        >
          {busy === 'search' ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <FileSearch className="size-3.5" />
          )}
          Search
        </Button>
      </div>

      <label className="flex flex-wrap items-center gap-2 text-meta text-muted">
        <FolderOpen className="size-3.5 shrink-0" aria-hidden />
        Index folder
        <Input
          value={state.indexRoot}
          onChange={(event) => dispatch({ type: 'setting/indexRoot', value: event.target.value })}
          placeholder="empty: the project's .openlab"
          aria-label="Index folder"
          className="h-7 max-w-[340px]"
        />
      </label>

      {progress && (
        <p className="text-meta tabular-nums text-muted">
          {progress.phase} · {progress.pct}%
        </p>
      )}
      {error && <p className="rounded-2xl bg-danger-soft p-3 text-body text-danger">{error}</p>}

      {Object.keys(scanned).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(scanned).map(([id, status]) => (
            <Chip
              key={id}
              size="sm"
              color={status === 'indexed' ? 'success' : status === 'paywalled' ? 'default' : 'danger'}
            >
              {status}
            </Chip>
          ))}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-1.5">
          <span className="text-meta text-muted">
            {result.hits.length} hits · {result.mode}
          </span>
          {result.hits.map((hit) => (
            <div key={hit.chunkId} className="flex flex-col gap-0.5 rounded-2xl bg-surface-secondary p-3">
              <span className="text-meta text-muted">
                {[hit.title ?? hit.doi ?? hit.docId, `page ${hit.page}`].join(' · ')}
              </span>
              <span className="text-body text-foreground">{hit.snippet}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
