/**
 * The knowledge explorer.
 *
 * Reads the workspace's OpenWiki — the linked Markdown a repository keeps under `openwiki/`
 * — and draws it the way OpenWiki's own visualizer does: a node graph on one side, the page
 * you pick on the other. The data is local; the loader only touches the workspace's files.
 *
 * A page rather than the modal it started as: a wiki is a place you read, and a place you
 * come back to, so it gets a destination of its own — in the column, or in a tab beside the
 * work that sent you there.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Network, RefreshCw, Search } from 'lucide-react';

import { Button, IconButton, Input, MonoPill, ScrollShadow, Spinner, Tip } from '@/components/ui';
import { Markdown } from '@/components/chat/Markdown';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import { loadWiki, resolveWikiLink, type WikiGraph, type WikiPage } from '@/lib/knowledge/wiki';
import { ForceGraph } from './ForceGraph';

const OPENWIKI_URL = 'https://github.com/langchain-ai/openwiki';

/** The page to open first: a conventional entry point, or the first page. */
function pickDefault(pages: WikiPage[]): string | null {
  const preferred = ['quickstart.md', 'index.md', 'readme.md', 'overview.md', 'architecture.md'];
  for (const name of preferred) {
    const page = pages.find((candidate) => candidate.id.toLowerCase() === name);
    if (page) {
      return page.id;
    }
  }
  return pages[0]?.id ?? null;
}

export function KnowledgeScreen() {
  const { state } = useApp();
  const workspacePath = activeProject(state)?.path ?? null;
  const workspaceName = activeProject(state)?.name ?? 'No workspace';

  const [phase, setPhase] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!workspacePath) {
      setPhase('empty');
      setGraph(null);
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      const result = await loadWiki(workspacePath);
      if (!result) {
        setPhase('empty');
        setGraph(null);
        return;
      }
      setGraph(result);
      setSelectedId((current) =>
        current && result.pages.some((page) => page.id === current) ? current : pickDefault(result.pages),
      );
      setPhase('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase('error');
    }
  }, [workspacePath]);

  useEffect(() => {
    void load();
  }, [load]);

  const nodes = useMemo(
    () => (graph?.pages ?? []).map((page) => ({ id: page.id, label: page.title })),
    [graph],
  );
  const edges = useMemo(() => graph?.edges ?? [], [graph]);
  const selected = useMemo(
    () => graph?.pages.find((page) => page.id === selectedId) ?? null,
    [graph, selectedId],
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !graph) {
      return [];
    }
    return graph.pages
      .filter((page) => `${page.title} ${page.id}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [graph, query]);

  /** A wiki link inside a page selects that node instead of leaving the app. */
  const onNavigate = useCallback(
    (href: string): boolean => {
      if (href.startsWith('#')) {
        return true;
      }
      if (!selected || !graph) {
        return false;
      }
      const target = resolveWikiLink(selected.id, href);
      if (target && graph.pages.some((page) => page.id === target)) {
        setSelectedId(target);
        return true;
      }
      return false;
    },
    [graph, selected],
  );

  return (
    <div className="flex h-full min-h-0 flex-col px-7 pb-5">
      {/* The page's own header: what it is, which workspace it reads, and how to re-read it. */}
      <header className="flex shrink-0 items-center gap-2 pt-5 pb-2">
        <Network className="size-4 shrink-0 text-accent" aria-hidden />
        <h1 className="text-[1.5rem] leading-tight font-semibold text-foreground">Knowledge</h1>
        <span className="text-meta text-muted">{workspaceName}</span>
        <div className="ms-auto flex items-center gap-1">
          <Tip content="Reload the wiki">
            <IconButton aria-label="Reload" onPress={() => void load()}>
              <RefreshCw />
            </IconButton>
          </Tip>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {phase === 'loading' && (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        )}

        {phase === 'error' && (
          <div className="grid h-full place-items-center px-8 text-center">
            <div className="max-w-md">
              <p className="text-body text-foreground">The wiki could not be read.</p>
              <p className="mt-1 text-body text-muted">{error}</p>
            </div>
          </div>
        )}

        {phase === 'empty' && (
          <div className="grid h-full place-items-center px-8 text-center">
            <div className="flex max-w-md flex-col items-center">
              <Network className="size-6 text-muted" aria-hidden />
              <p className="mt-3 text-body text-foreground">No OpenWiki in this workspace.</p>
              <p className="mt-1 text-body text-muted">
                OpenWiki keeps a linked Markdown wiki under <span className="font-mono">openwiki/</span>.
                Create one with the CLI, then reload.
              </p>
              <MonoPill className="mt-3">openwiki --init</MonoPill>
              <a
                href={OPENWIKI_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex items-center gap-1 text-meta text-link underline underline-offset-2"
              >
                OpenWiki on GitHub
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>
          </div>
        )}

        {phase === 'ready' && graph && (
          <div className="flex h-full min-h-0 gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
                <Input
                  type="search"
                  variant="secondary"
                  value={query}
                  onChange={(event) => setQuery((event.target as HTMLInputElement).value)}
                  placeholder="Search pages"
                  aria-label="Search pages"
                  className="w-full pl-9"
                />
                {query && results.length > 0 && (
                  <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-border bg-surface">
                    {results.map((page) => (
                      <button
                        key={page.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setSelectedId(page.id);
                          setQuery('');
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-surface-secondary"
                      >
                        <span className="min-w-0 flex-1 truncate text-body text-foreground">
                          {page.title}
                        </span>
                        <span className="shrink-0 truncate font-mono text-meta text-muted">{page.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <ForceGraph
                nodes={nodes}
                edges={edges}
                selectedId={selectedId}
                onSelect={setSelectedId}
                className="min-h-[240px] flex-1 overflow-hidden rounded-2xl border border-border bg-surface"
              />
              <p className="text-meta text-muted">
                {graph.pages.length} page{graph.pages.length === 1 ? '' : 's'} · {graph.edges.length} link
                {graph.edges.length === 1 ? '' : 's'} · drag a node, click to read
              </p>
            </div>

            <aside className="flex w-[46%] min-w-[320px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border">
              {selected ? (
                <>
                  <header className="flex items-center gap-2 border-b border-separator px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-title text-foreground">
                      {selected.title}
                    </span>
                    <span className="shrink-0 truncate font-mono text-meta text-muted">{selected.id}</span>
                  </header>
                  <ScrollShadow className="min-h-0 flex-1 px-4 py-3">
                    <Markdown onNavigate={onNavigate}>{selected.content}</Markdown>
                  </ScrollShadow>
                </>
              ) : (
                <div className="grid h-full place-items-center p-8 text-center text-body text-muted">
                  Pick a page.
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
