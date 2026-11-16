/**
 * The scan engine.
 *
 * The PDF pipeline runs in a Python worker, and the heavy half of it — Surya, which drags torch,
 * transformers and OpenCV — is not in the installer. It is fetched here, on request, into the app's
 * data directory, the same way the embedding model is: a reader who never scans a paper should not
 * download a gigabyte, and a reader who does should not have to install Python by hand.
 *
 * The page tells the truth about both halves: whether the engine is installed, and which engines the
 * pipeline actually attached. When Surya is absent the worker still extracts with `pdftotext` or
 * PyMuPDF, embeds with a token hash, and ranks with the Python BM25 twin — so nothing here is a
 * precondition.
 */

import { useCallback, useEffect, useState } from 'react';

import { Button, Chip, MonoPill, SectionLabel } from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import {
  onScanEngineProgress,
  scanEngineInstall,
  scanEngineStatus,
  scanHealth,
  scanRoot,
  type EngineStatus,
} from '@/lib/scan/ipc';
import type { ScanHealth } from '@/lib/scan/types';
import { isDesktop, invokeCommand } from '@/lib/ipc';

/** How the extractor reads, in one line each. */
const EXTRACT_HINT: Record<string, string> = {
  surya: 'Surya decides per page between a text layer and OCR.',
  pdftotext: 'Poppler reads the text layer; scanned pages come back empty.',
  pymupdf: 'PyMuPDF reads the text layer; scanned pages come back empty.',
  'text-only': 'Only plain text files can be read; a PDF will not extract.',
};

const EMBED_HINT: Record<string, string> = {
  'llama.cpp': 'EmbeddingGemma over a local llama-server.',
  fallback: 'A token-hash stand-in: search still works, ranking is weaker.',
};

/** One row of the pipeline report. */
function EngineRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-separator/60 py-2 last:border-b-0">
      <span className="w-[92px] shrink-0 text-meta text-muted">{label}</span>
      <MonoPill>{value}</MonoPill>
      {hint && <span className="min-w-0 flex-1 truncate text-meta text-muted">{hint}</span>}
    </div>
  );
}

export function ScanEngineScreen() {
  const { state } = useApp();
  const workspacePath = activeProject(state)?.path ?? null;
  const root = scanRoot(workspacePath, state.indexRoot);

  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [health, setHealth] = useState<ScanHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const reported = await scanEngineStatus();
    setStatus(reported.ok ? reported.value : null);
    if (!root) {
      setHealth(null);
      return;
    }
    const probed = await scanHealth(root);
    if (probed.ok) {
      setHealth(probed.value);
      setHealthError(null);
    } else {
      setHealth(null);
      setHealthError(probed.error.message);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = useCallback(async () => {
    setBusy(true);
    setError(null);
    setLines([]);
    setPct(null);
    setPhase('download');
    // Subscribe before the call: the download reports its first percentage immediately.
    const unsubscribe = await onScanEngineProgress((progress) => {
      setPhase(progress.phase);
      if (progress.pct !== null) setPct(progress.pct);
      if (progress.line) setLines((current) => [...current, progress.line!].slice(-8));
    });
    const result = await scanEngineInstall();
    unsubscribe();
    setBusy(false);
    setPhase(null);
    setPct(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setStatus(result.value);
    // The worker caches the interpreter it spawned with. Releasing the services here means the
    // next scan starts a fresh worker on the engine that was just installed, rather than
    // waiting for the idle watchdog to put the old one down.
    await invokeCommand('services_idle', {});
    await refresh();
  }, [refresh]);

  return (
    <SettingsPage>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SectionLabel>Scan engine</SectionLabel>
            {status?.installed ? (
              <Chip size="sm" color="success" variant="soft">
                installed
              </Chip>
            ) : (
              <Chip size="sm" color="warning" variant="soft">
                not installed
              </Chip>
            )}
          </div>
          <h1 className="text-title text-foreground">Reading papers</h1>
          <p className="text-body text-muted">Turns a PDF into indexed, searchable text.</p>
        </header>

        <section className="flex flex-col gap-3">
          <header className="flex items-baseline gap-2">
            <SectionLabel>Interpreter</SectionLabel>
            <span className="ml-auto text-meta text-muted">
              {status?.packages.length ? status.packages.join(' · ') : 'surya-ocr · pymupdf'}
            </span>
          </header>
          <div className="flex flex-col gap-1">
            <MonoPill className="max-w-full truncate">
              {status?.python ?? status?.path ?? 'no engine installed yet'}
            </MonoPill>
            {status?.installed && (
              <span className="text-meta text-muted">Installed. The next scan starts the worker on it.</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              isDisabled={busy || status?.installed === true}
              onPress={() => void install()}
            >
              {busy ? 'Installing…' : status?.installed ? 'Already installed' : 'Install the scan engine'}
            </Button>
            {busy && phase === 'install' && (
              <span className="text-meta text-muted">
                pip is resolving packages; this takes a few minutes
              </span>
            )}
          </div>

          {busy && pct !== null && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {lines.length > 0 && (
            <pre className="max-h-40 overflow-auto rounded-2xl bg-surface px-3 py-2 text-meta text-muted">
              {lines.join('\n')}
            </pre>
          )}

          {error && <p className="rounded-2xl bg-danger/10 px-3 py-2 text-meta text-danger">{error}</p>}

          {!isDesktop() && <p className="text-meta text-muted">Nothing to install in the browser preview.</p>}
        </section>

        <section className="flex flex-col gap-2">
          <header className="flex items-baseline gap-2">
            <SectionLabel>What the pipeline attached</SectionLabel>
            {health && <span className="ml-auto text-meta text-muted">{root}</span>}
          </header>
          {health ? (
            <div className="flex flex-col">
              <EngineRow label="Extract" value={health.extract} hint={EXTRACT_HINT[health.extract]} />
              <EngineRow label="Embed" value={health.embed} hint={EMBED_HINT[health.embed]} />
              <EngineRow label="Rank" value={health.hot_path} />
              <EngineRow label="Index" value={health.vectors ?? 'jsonl'} />
              <EngineRow label="Python" value={health.python} />
            </div>
          ) : (
            <p className="rounded-2xl bg-surface px-4 py-5 text-body text-muted">
              {healthError ??
                (root
                  ? 'The worker did not report. It starts on the first request.'
                  : 'Open a workspace to probe the pipeline; there is no index root yet.')}
            </p>
          )}
        </section>

        <p className="text-meta text-muted">
          A pinned CPython, not this machine's own. Point <code>OPENLAB_PYTHON</code> or{' '}
          <code>OPENLAB_ENGINE_URL</code> at your own to override.
        </p>
      </div>
    </SettingsPage>
  );
}
