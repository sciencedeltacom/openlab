/**
 * The scan pipeline, as the interface sees it.
 *
 * `scan_pdf` indexes a record's PDF (or a local file), `search_library` asks the index a
 * question, and `scan_health` says which engines are attached on this machine. The heavy
 * work happens in the bundled Python worker behind the Rust commands; these types are the
 * contract with that boundary.
 */

/** What a document's index row says. */
export interface ScanDocument {
  id: string;
  doi?: string | null;
  recordId?: string | null;
  title?: string | null;
  pdfPath?: string | null;
  url?: string | null;
  sha256?: string | null;
  bytes?: number | null;
  pages?: number;
  chunks?: number;
  embed?: string;
  status: 'indexed' | 'paywalled' | 'failed' | string;
  error?: string;
  indexedAt?: number;
  updatedAt?: number;
  /** True when the worker answered from the index instead of scanning again. */
  cached?: boolean;
}

/** One search hit: a chunk, with the page it came from. */
export interface ScanHit {
  chunkId: string;
  docId: string;
  doi?: string | null;
  title?: string | null;
  page: number;
  label?: string;
  score: number;
  snippet: string;
}

/** What a search answered, and how. */
export interface ScanSearchResult {
  hits: ScanHit[];
  mode: 'hybrid' | 'bm25' | 'empty';
  searched?: number;
}

/** Which engines the worker found on this machine. */
export interface ScanHealth {
  root: string;
  embed: 'llama.cpp' | 'fallback';
  embed_url: string;
  extract: 'surya' | 'pdftotext' | 'pymupdf' | 'text-only';
  store: 'jsonl';
  hot_path: 'mojo' | 'python';
  /** Added by the Rust side: the vector index is LanceDB, in the app. */
  vectors?: 'lancedb';
  surya: boolean;
  llama_server: boolean;
  python: string;
}

/** A progress event forwarded from the worker. */
export interface ScanProgress {
  id: string;
  phase: string;
  pct: number;
  [key: string]: unknown;
}

/** What to scan: a record to resolve, a direct PDF URL, or a local file. */
export interface ScanRequest {
  doi?: string;
  recordId?: string;
  url?: string;
  path?: string;
  docId?: string;
  title?: string;
  force?: boolean;
}
