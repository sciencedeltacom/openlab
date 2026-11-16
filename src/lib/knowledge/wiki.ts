/**
 * The workspace's OpenWiki, read as a graph.
 *
 * OpenWiki (https://github.com/langchain-ai/openwiki) writes a linked Markdown wiki under
 * `openwiki/` in a repository. This reads those pages through the same Rust file commands
 * the agent uses — nothing here reaches the network — and turns the relative links between
 * them into a graph the explorer can draw.
 */

import { invokeCommand } from '@/lib/ipc';

/** One wiki page. */
export interface WikiPage {
  /** Path within `openwiki/`, e.g. `architecture/server.md`. */
  id: string;
  title: string;
  summary: string;
  /** The page body, front matter stripped. */
  content: string;
  /** Resolved ids of the pages this one links to. */
  links: string[];
}

/** The wiki as nodes and edges. */
export interface WikiGraph {
  pages: WikiPage[];
  edges: { source: string; target: string }[];
}

/** Most pages to read, so a giant wiki cannot stall the explorer. */
const MAX_PAGES = 200;

/**
 * Where the pages are read from.
 *
 * The explorer reads them through the Rust commands; the agent's `knowledge` tool reads them
 * through its host. Both funnel into {@link loadWikiFrom}, so the parsing and the graph are
 * built in exactly one place.
 */
export interface WikiSource {
  glob(pattern: string, path?: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

/** Read the workspace's OpenWiki, or `null` when it has none. */
export async function loadWiki(root: string): Promise<WikiGraph | null> {
  return loadWikiFrom({
    glob: async (pattern, path) => {
      const listed = await invokeCommand<string[]>('glob_files', { pattern, root, path: path ?? null });
      if (!listed.ok) {
        throw new Error(listed.error.message);
      }
      return listed.value;
    },
    read: async (path) => {
      const result = await invokeCommand<string>('read_file', { path, root });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
  });
}

/** Build the graph from any page source, or `null` when there are no pages. */
export async function loadWikiFrom(source: WikiSource): Promise<WikiGraph | null> {
  const files = (await source.glob('openwiki/**/*.md'))
    .filter((path) => !path.includes('/.'))
    .slice(0, MAX_PAGES);
  if (files.length === 0) {
    return null;
  }

  const reads = await Promise.all(
    files.map(async (path) => {
      try {
        return parsePage(path, await source.read(path));
      } catch {
        return null;
      }
    }),
  );
  const pages = reads.filter((page): page is WikiPage => page !== null);

  const ids = new Set(pages.map((page) => page.id));
  const edges: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const link of page.links) {
      const key = `${page.id}\u0000${link}`;
      if (link === page.id || !ids.has(link) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({ source: page.id, target: link });
    }
  }

  return { pages, edges };
}

/** Find a page however the model names it — by id (`architecture`), path or title. */
export function findWikiPage(graph: WikiGraph, ref: string): WikiPage | undefined {
  const want = ref
    .trim()
    .replace(/^\.\//, '')
    .replace(/^openwiki\//, '')
    .toLowerCase();
  if (!want) {
    return undefined;
  }
  const withExt = /\.md$/i.test(want) ? want : `${want}.md`;
  return graph.pages.find((page) => {
    const id = page.id.toLowerCase();
    return (
      id === want ||
      id === withExt ||
      page.title.toLowerCase() === want ||
      basename(id) === want.replace(/\.md$/i, '')
    );
  });
}

/** Pages matching a query in their id, title, summary or body, best first. */
export function searchWikiPages(graph: WikiGraph, query: string, limit = 10): WikiPage[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return graph.pages
    .map((page) => {
      const id = page.id.toLowerCase();
      const title = page.title.toLowerCase();
      let score = 0;
      if (id.includes(needle) || title.includes(needle)) score += 3;
      if (page.summary.toLowerCase().includes(needle)) score += 2;
      if (page.content.toLowerCase().includes(needle)) score += 1;
      return { page, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.page.id.localeCompare(b.page.id))
    .slice(0, limit)
    .map((entry) => entry.page);
}

/** Parse one page: its title, its summary and where it links. */
function parsePage(path: string, raw: string): WikiPage {
  const id = path.replace(/^openwiki\//, '').replace(/^\.\//, '');
  const { front, body } = splitFrontMatter(raw);
  return {
    id,
    title: front.title || firstHeading(body) || basename(id),
    summary: front.summary || front.description || firstParagraph(body),
    content: body.trim(),
    links: extractLinks(body, id),
  };
}

/** Split optional YAML front matter from the body. */
function splitFrontMatter(raw: string): { front: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) {
    return { front: {}, body: raw };
  }
  const close = raw.indexOf('\n---', 3);
  if (close === -1) {
    return { front: {}, body: raw };
  }
  const front: Record<string, string> = {};
  for (const line of raw.slice(3, close).split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (match) {
      front[match[1]!] = match[2]!.replace(/^["']|["']$/g, '').trim();
    }
  }
  const start = raw.indexOf('\n', close + 1);
  return { front, body: start === -1 ? '' : raw.slice(start + 1) };
}

/** The first `# ` heading. */
function firstHeading(body: string): string {
  return /^#\s+(.+?)\s*$/m.exec(body)?.[1]?.trim() ?? '';
}

/** The first line of prose — the summary when front matter does not carry one. */
function firstParagraph(body: string): string {
  for (const line of body.split('\n')) {
    const text = line.trim();
    if (!text || /^(#|[-*+>|`]|<!--|\d+\.)/.test(text)) {
      continue;
    }
    return stripInline(text).slice(0, 180);
  }
  return '';
}

/** Remove markdown emphasis and links so a summary reads as plain text. */
function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

/** Every page this one links to, resolved to a wiki-relative id. */
function extractLinks(body: string, fromId: string): string[] {
  const out = new Set<string>();
  const add = (target: string) => {
    const resolved = resolveWikiLink(fromId, target);
    if (resolved) {
      out.add(resolved);
    }
  };

  const markdown = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdown.exec(body)) !== null) {
    try {
      add(decodeURIComponent(match[1]!));
    } catch {
      add(match[1]!);
    }
  }

  const wiki = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  while ((match = wiki.exec(body)) !== null) {
    add(match[1]!.trim());
  }

  return [...out];
}

/**
 * Resolve a link found in one page to a wiki-relative `.md` id.
 *
 * Exported so a reader can turn an in-page link back into a node, the same way the loader
 * builds the edges in the first place.
 */
export function resolveWikiLink(fromId: string, target: string): string | null {
  let path = target.split('#')[0]!.trim().replace(/^\.\//, '');
  if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return null;
  }
  if (!/\.md$/i.test(path)) {
    if (/\.[a-z0-9]+$/i.test(path)) {
      return null;
    }
    path = `${path}.md`;
  }

  const base = fromId.includes('/') ? fromId.slice(0, fromId.lastIndexOf('/')) : '';
  const parts: string[] = [];
  for (const segment of `${base}/${path}`.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.length > 0 ? parts.join('/') : null;
}

/** The page name without its directory or extension. */
function basename(id: string): string {
  const name = id.split('/').pop() ?? id;
  return name.replace(/\.md$/i, '');
}
