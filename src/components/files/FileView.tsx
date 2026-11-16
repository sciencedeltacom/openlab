/**
 * A single file's contents.
 *
 * Shared by the workspace files panel and the dynamic island, so a file reads the same
 * wherever it is opened. What "reads" means depends on the file: markdown is rendered,
 * notebooks and other text are shown as themselves, images are drawn, an archive is listed,
 * and anything with no preview offers to open in its own application.
 */

import { useEffect, useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';

import { Button, Spinner } from '@/components/ui';
import { useApp } from '@/store/app';
import { Markdown } from '@/components/chat/Markdown';
import { invokeCommand, isDesktop } from '@/lib/ipc';
import type { IslandDemo } from '@/store/types';
import { extensionOf } from './editors';
import { NotebookView } from './NotebookView';
import { PdfView } from './PdfView';
import { ZipTable, ZipView } from './ZipView';

/** Extensions the reader will show as text. Anything else has its own renderer or none. */
const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'md',
  'markdown',
  'mdx',
  'rst',
  'org',
  'tex',
  'bib',
  'log',
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'properties',
  'env',
  'csv',
  'tsv',
  'xml',
  'html',
  'htm',
  'svg',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'astro',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'sql',
  'r',
  'jl',
  'm',
  'lua',
  'pl',
  'vim',
  'graphql',
  'gql',
  'proto',
  'gradle',
  'diff',
  'patch',
  'rmd',
  'qmd',
]);

/** Raster image types the reader draws. SVG stays text — it is a document, not a bitmap. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
  tif: 'image/tiff',
};

/** Whether the reader should open this file as text. Extensionless names usually are. */
function isTextLike(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return true;
  }
  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Markdown gets rendered; every other text file is shown verbatim. */
function isMarkdown(name: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(name);
}

/** How a file is shown, decided once from its name. */
type Kind = 'markdown' | 'notebook' | 'image' | 'pdf' | 'zip' | 'text' | 'binary';

function kindOf(name: string): Kind {
  const ext = extensionOf(name);
  if (isMarkdown(name)) {
    return 'markdown';
  }
  if (ext in IMAGE_MIME) {
    return 'image';
  }
  if (ext === 'ipynb') {
    return 'notebook';
  }
  if (ext === 'pdf') {
    return 'pdf';
  }
  if (ext === 'zip') {
    return 'zip';
  }
  return isTextLike(name) ? 'text' : 'binary';
}

/** Open a file with the operating system's default application. */
export async function openExternally(path: string): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(path).catch(() => undefined);
}

/** A plain centred spinner, for the moment before content arrives. */
function Loading() {
  return (
    <div className="grid place-items-center py-8">
      <Spinner />
    </div>
  );
}

/** A short message with a way out to the OS, for a file the reader cannot show. */
function Notice({ path, message }: { path: string; message: string }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-3.5">
      <p className="text-body text-muted">{message}</p>
      <button
        type="button"
        onClick={() => void openExternally(path)}
        className="inline-flex items-center gap-1.5 text-body text-link underline underline-offset-2"
      >
        Open in its own application
        <ExternalLink className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Text, markdown or a notebook: everything the reader shows from a UTF-8 string. */
function TextBody({
  path,
  name,
  root,
  kind,
}: {
  path: string;
  name: string;
  root: string | null;
  kind: Kind;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) {
      setContent(null);
      setError('No folder is open.');
      return;
    }
    let alive = true;
    setContent(null);
    setError(null);
    void invokeCommand<string>('read_file', { path, root }).then((result) => {
      if (!alive) {
        return;
      }
      if (result.ok) {
        setContent(result.value);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      alive = false;
    };
  }, [path, root]);

  if (error) {
    return <Notice path={path} message={error} />;
  }
  if (content === null) {
    return <Loading />;
  }
  if (kind === 'markdown') {
    return (
      <div className="px-4 py-3.5">
        <Markdown>{content}</Markdown>
      </div>
    );
  }
  if (kind === 'notebook') {
    return <NotebookView source={content} />;
  }
  return (
    <pre className="whitespace-pre-wrap break-words px-4 py-3.5 font-mono text-meta leading-relaxed text-foreground/90">
      {content}
    </pre>
  );
}

/** An image, drawn from the bytes the Rust side hands back. */
function ImageBody({ path, name, root }: { path: string; name: string; root: string | null }) {
  const { newSession, dispatch } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) {
      setUrl(null);
      setError('No folder is open.');
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    void invokeCommand<ArrayBuffer>('read_file_binary', { path, root }).then((result) => {
      if (!alive) {
        return;
      }
      if (result.ok) {
        objectUrl = URL.createObjectURL(
          new Blob([result.value], { type: IMAGE_MIME[extensionOf(name)] ?? 'application/octet-stream' }),
        );
        setUrl(objectUrl);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      alive = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path, name, root]);

  if (error) {
    return <Notice path={path} message={error} />;
  }
  if (url === null) {
    return <Loading />;
  }
  return (
    <div className="flex flex-col items-center gap-5 px-4 py-6">
      {/* Nine tenths of the column, height from the file's own ratio: a figure is read, not
          stretched to fill whatever space is left. */}
      <img src={url} alt={name} className="h-auto w-[90%] rounded-xl object-contain" />
      <Button
        variant="secondary"
        className="gap-1.5"
        onPress={() => {
          // The image rides into the new session as an attachment, so the first thing the
          // reader can say is about the thing they are looking at.
          dispatch({ type: 'attachment/add', path });
          newSession();
        }}
      >
        <Plus className="size-3.5" />
        New session with image
      </Button>
    </div>
  );
}

/** Inline content, for a demo file with no path on disk. */
function DemoBody({ demo, name }: { demo: IslandDemo; name: string }) {
  switch (demo.kind) {
    case 'image':
      return (
        <div className="grid place-items-center p-4">
          <img src={demo.src} alt={name} className="h-auto w-[90%] rounded-xl object-contain" />
        </div>
      );
    case 'notebook':
      return <NotebookView source={demo.text} />;
    case 'zip':
      return <ZipTable name={name} entries={demo.entries} />;
    case 'markdown':
      return (
        <div className="px-4 py-3.5">
          <Markdown>{demo.text}</Markdown>
        </div>
      );
    case 'text':
      return (
        <pre className="whitespace-pre-wrap break-words px-4 py-3.5 font-mono text-meta leading-relaxed text-foreground/90">
          {demo.text}
        </pre>
      );
  }
}

/** The file's body, chosen by what the file is. */
export function FileView({
  path,
  name,
  root,
  demo,
}: {
  path: string;
  name: string;
  root: string | null;
  demo?: IslandDemo;
}) {
  if (demo) {
    return <DemoBody demo={demo} name={name} />;
  }
  const kind = kindOf(name);
  switch (kind) {
    case 'image':
      return <ImageBody path={path} name={name} root={root} />;
    case 'pdf':
      return <PdfView path={path} name={name} root={root} />;
    case 'zip':
      return <ZipView path={path} name={name} root={root} />;
    case 'binary':
      return <Notice path={path} message="No preview for this file type." />;
    default:
      return <TextBody path={path} name={name} root={root} kind={kind} />;
  }
}
