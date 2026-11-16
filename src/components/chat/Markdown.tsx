/**
 * Markdown rendering for assistant output.
 *
 * `react-markdown` builds an element tree rather than setting `innerHTML`, so model
 * output cannot inject HTML into the workbench. Every element is mapped to a brand
 * style here, which is why the app does not need the Tailwind typography plugin.
 */

import { useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookOpen } from 'lucide-react';

import { Chip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { OPENUI_FENCE } from '@/lib/openui';
import { remarkMentions } from '@/lib/chat/mentions';
import { tagColor } from '@/lib/chat/tags';
import { useApp } from '@/store/app';
import { CodeBlock } from './CodeBlock';
import { MarkdownTable } from './MarkdownTable';
import { OpenuiBlock } from './OpenuiBlock';

/** Plugin lists are hoisted: a fresh array each render makes react-markdown rebuild its processor. */
const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkMentions];
const REHYPE_PLUGINS = [rehypeKatex];

/** A hast node, narrowed to what a code block needs. */
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Pull the source and language out of a fenced block's `<pre><code>`. */
function readCodeBlock(node: HastNode | undefined): { code: string; language: string } {
  const codeElement = node?.children?.[0];
  const textChild = codeElement?.children?.[0];
  const code = textChild?.value ?? '';
  const className = codeElement?.properties?.className;
  const names = Array.isArray(className) ? className.map(String) : [];
  const language = names.find((name) => name.startsWith('language-'))?.slice('language-'.length) ?? '';
  return { code, language };
}

export interface MarkdownProps {
  children: string;
  className?: string;
  /** True while this text is still being written, so a generated interface can stream. */
  isStreaming?: boolean;
  /**
   * Intercept a link before it opens. Return `true` when it was handled in-app — a wiki
   * page read inside the explorer — so the anchor does not try to navigate the webview.
   */
  onNavigate?: (href: string) => boolean;
  /**
   * Resolve a `record:` key to something to open — a review record and its island. When it
   * returns nothing the chip falls back to the app's stored agent records.
   */
  resolveRecord?: (key: string) => { title: string; onOpen: () => void } | undefined;
}

/**
 * A bracketed status token — `[canonical]` — as a HeroUI chip.
 *
 * The colour comes from the tag's own name, so the same tag is the same colour wherever it
 * appears and whatever order the tags arrived in.
 */
function TagChip(props: { children?: ReactNode; 'data-tag'?: string }) {
  const tag = props['data-tag'] ?? String(props.children ?? '');
  return (
    <Chip variant="soft" color={tagColor(tag)} className="mx-0.5 align-middle text-body">
      {tag}
    </Chip>
  );
}

/**
 * A citation — `record:<id>` — as a chip that opens the source's island.
 *
 * The chip names the source when it is known, and the bare id when it is not, so a citation
 * the workspace never saw is still visible rather than silently dropped.
 */
function RecordChip(props: {
  children?: ReactNode;
  'data-record'?: string;
  resolveRecord?: (key: string) => { title: string; onOpen: () => void } | undefined;
}) {
  const { state, dispatch } = useApp();
  const id = props['data-record'] ?? String(props.children ?? '');
  const resolved = props.resolveRecord?.(id);
  const record = state.records.find((candidate) => candidate.id === id);
  const title = resolved?.title ?? record?.title ?? id;
  const label = title.length > 48 ? `${title.slice(0, 47)}…` : title;
  return (
    <button
      type="button"
      onClick={() => (resolved ? resolved.onOpen() : dispatch({ type: 'citation/open', id }))}
      title={title}
      className="mx-0.5 inline-flex align-middle"
    >
      <Chip variant="soft" color="accent" className="text-body">
        <BookOpen className="size-3.5" aria-hidden />
        {label}
      </Chip>
    </button>
  );
}

/** Prose styles for model output: paper surfaces, restrained headings, mono code. */
export function Markdown({ children, className, isStreaming, onNavigate, resolveRecord }: MarkdownProps) {
  // The element map is memoised: react-markdown renders `components.pre` as the element's own
  // type, so a fresh function each render makes React unmount and remount that subtree. During
  // a stream that would tear down and rebuild a generated interface (and every code editor)
  // on every token. `isStreaming` only flips twice a turn, so the identity holds while it
  // matters.
  const components: Components = useMemo(() => {
    const map: Components = {
      h1: ({ children }) => <h1 className="mt-4 mb-2 text-lg font-semibold first:mt-0">{children}</h1>,
      h2: ({ children }) => <h2 className="mt-4 mb-2 text-title font-semibold first:mt-0">{children}</h2>,
      h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-body font-semibold first:mt-0">{children}</h3>,
      p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => {
            if (href && onNavigate?.(href)) {
              event.preventDefault();
            }
          }}
          className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
        >
          {children}
        </a>
      ),
      ul: ({ children }) => <ul className="my-2 flex list-disc flex-col gap-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="my-2 flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
      li: ({ children }) => <li className="pl-0.5">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="my-3 border-l-2 border-accent/40 pl-3 text-foreground/80">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-4 border-separator" />,
      code: ({ children }) => (
        <code className="rounded-md bg-surface px-1.5 py-0.5 text-[0.9em] text-foreground">{children}</code>
      ),
      pre: ({ node }) => {
        const { code, language } = readCodeBlock(node as unknown as HastNode | undefined);
        // A generated interface is drawn, not printed: the fence is a program, not code to read.
        if (language === OPENUI_FENCE) {
          return <OpenuiBlock code={code} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={code} language={language} />;
      },
      table: ({ node }) => <MarkdownTable node={node as unknown as HastNode} />,
    };
    // The remark plugin emits a `md-tag` element; react-markdown looks components up by tag
    // name, and the type does not know custom elements, so the entry is added after typing.
    (map as Record<string, unknown>)['md-tag'] = TagChip;
    (map as Record<string, unknown>)['md-record'] = (props: Record<string, unknown>) => (
      <RecordChip
        {...(props as { 'data-record'?: string; children?: ReactNode })}
        resolveRecord={resolveRecord}
      />
    );
    return map;
  }, [isStreaming, onNavigate, resolveRecord]);

  return (
    <div className={cn('text-body leading-[1.65] text-foreground', className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
