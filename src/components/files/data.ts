/** The shape of a file the browser shows, and the kind it wears.
 *
 * `useWorkspaceFiles` builds these from the real folder; the kind and scope vocabulary lives
 * here so the list, its facets and a file's record all read from one place. Sizes are bytes
 * so the header can sum them and show a real total.
 */

import { Cloud, FolderSync, HardDrive, Layers, type LucideIcon } from 'lucide-react';

/** The last segment of a path: what a reader calls the file. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Where a file lives: the machine, or storage the lab connects to. */
export type FileScope = 'local' | 'cloud';

/** What a file is, by its extension. */
export type FileKind = 'dataset' | 'notebook' | 'figure' | 'document' | 'pdf' | 'code' | 'archive' | 'model';

/** A file the workspace can see. */
export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  scope: FileScope;
  /** The connected source it belongs to, e.g. `S3` or `Lab folder`. */
  source: string;
  kind: FileKind;
  bytes: number;
  /** Epoch milliseconds, so the age filters can bucket it. */
  modified: number;
  status?: 'ok' | 'failed' | 'syncing';
}

/** The scopes the browser can show. `all` and `sync` are views, not sources. */
export const FILE_SCOPES: { id: FileScope | 'all' | 'sync'; label: string; icon: LucideIcon }[] = [
  { id: 'local', label: 'Local', icon: HardDrive },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'sync', label: 'Sync', icon: FolderSync },
  { id: 'all', label: 'All', icon: Layers },
];

/** The kinds, in the order the group headers and facets show them. */
export const FILE_KINDS: { id: FileKind; label: string }[] = [
  { id: 'dataset', label: 'Dataset' },
  { id: 'notebook', label: 'Notebook' },
  { id: 'figure', label: 'Figure' },
  { id: 'document', label: 'Document' },
  { id: 'pdf', label: 'PDF' },
  { id: 'code', label: 'Code' },
  { id: 'archive', label: 'Archive' },
  { id: 'model', label: 'Model' },
];

/** The kind a file wears, by its extension. Anything unlisted reads as a document. */
const KIND_BY_EXTENSION: Record<string, FileKind> = {
  csv: 'dataset',
  tsv: 'dataset',
  parquet: 'dataset',
  arrow: 'dataset',
  feather: 'dataset',
  h5: 'dataset',
  h5ad: 'dataset',
  hdf5: 'dataset',
  npy: 'dataset',
  npz: 'dataset',
  bed: 'dataset',
  bam: 'dataset',
  sam: 'dataset',
  vcf: 'dataset',
  fastq: 'dataset',
  fq: 'dataset',
  fasta: 'dataset',
  fa: 'dataset',
  xlsx: 'dataset',
  xls: 'dataset',
  sqlite: 'dataset',
  db: 'dataset',
  rds: 'dataset',
  ipynb: 'notebook',
  rmd: 'notebook',
  qmd: 'notebook',
  png: 'figure',
  jpg: 'figure',
  jpeg: 'figure',
  gif: 'figure',
  webp: 'figure',
  bmp: 'figure',
  svg: 'figure',
  tif: 'figure',
  tiff: 'figure',
  avif: 'figure',
  ico: 'figure',
  pdf: 'pdf',
  md: 'document',
  markdown: 'document',
  mdx: 'document',
  rst: 'document',
  org: 'document',
  txt: 'document',
  text: 'document',
  tex: 'document',
  bib: 'document',
  doc: 'document',
  docx: 'document',
  rtf: 'document',
  log: 'document',
  py: 'code',
  r: 'code',
  jl: 'code',
  m: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  ts: 'code',
  tsx: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  kt: 'code',
  swift: 'code',
  c: 'code',
  h: 'code',
  cc: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  php: 'code',
  rb: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  fish: 'code',
  ps1: 'code',
  sql: 'code',
  lua: 'code',
  pl: 'code',
  vim: 'code',
  graphql: 'code',
  gql: 'code',
  proto: 'code',
  gradle: 'code',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  pt: 'model',
  pth: 'model',
  ckpt: 'model',
  safetensors: 'model',
  onnx: 'model',
  pkl: 'model',
  pickle: 'model',
  joblib: 'model',
  gguf: 'model',
  bin: 'model',
};

/** The kind a file is, from its name. Extensionless names read as documents. */
export function kindOfName(name: string): FileKind {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return 'document';
  }
  return KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'document';
}

/** A file by id, or undefined when the link is stale. */
