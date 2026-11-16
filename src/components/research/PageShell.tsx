/**
 * The frame every research record page shares.
 *
 * A panel and a page answer different questions: a panel is read beside the list it came
 * from, a page is somewhere you can land, link to and reload. What pages still share is
 * the furniture — a heading, an optional facts rail, and one scroll container that fills
 * the window. The way back is the arrow in the top bar, not a second one here.
 *
 * Kept out of `shared.tsx` because that file is the task-mark vocabulary; this is layout.
 */

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { SearchX, type LucideIcon } from 'lucide-react';

import { Button, ScrollShadow, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import { MOTION } from '@/theme/tokens';

/** What every record page hands to {@link RecordPage}. */
export interface RecordPageProps {
  /** The row above the title: the record's noun and id, nothing that is status. */
  eyebrow?: ReactNode;
  /** The page heading. */
  title: ReactNode;
  /** The record's own state, beside the title where it belongs. */
  status?: ReactNode;
  /** A lede below the title, for records whose subject is a question. */
  lede?: ReactNode;
  /** The facts rail. Pages without one get a single column. */
  aside?: ReactNode;
  children: ReactNode;
}

/** The shared frame for a record page: heading, body, optional facts rail. */
export function RecordPage({ eyebrow, title, status, lede, aside, children }: RecordPageProps) {
  return (
    <ScrollShadow className="h-full min-h-0 px-7 pb-9">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
        className="flex w-full flex-col gap-5 pt-4"
      >
        <header className="flex flex-col gap-2">
          {eyebrow && <div className="flex flex-wrap items-center gap-2">{eyebrow}</div>}
          {/*
            The title is the page's anchor. The shared scale tops out at 15px, which reads as
            a section heading, so it is set a step above the scale here and nowhere else.
          */}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="max-w-[70ch] text-[1.5rem] leading-tight font-semibold text-foreground">
              {title}
            </h1>
            {status && <div className="flex flex-wrap items-center gap-2">{status}</div>}
          </div>
          {lede}
        </header>

        <div
          className={cn(
            'gap-6',
            aside ? 'grid grid-cols-1 items-start xl:grid-cols-[minmax(0,1fr)_280px]' : 'flex flex-col',
          )}
        >
          <main className="flex min-w-0 flex-col gap-6">{children}</main>
          {aside && <aside className="flex flex-col gap-4 xl:sticky xl:top-4">{aside}</aside>}
        </div>
      </motion.div>
    </ScrollShadow>
  );
}

/**
 * A link to another record page.
 *
 * A button rather than an anchor: navigation is a store dispatch, and the URL is
 * derived from the route tree rather than owned by the click. The caller's classes are
 * appended verbatim so the caller keeps control of type and colour.
 */
export function RecordLink({
  route,
  className,
  children,
}: {
  route: string;
  className?: string;
  children: ReactNode;
}) {
  const { dispatch } = useApp();
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'route/go', route })}
      className={className ? `text-left ${className}` : 'text-left'}
    >
      {children}
    </button>
  );
}

/**
 * One label-over-value row in a facts rail.
 *
 * A rail is reference material, so the label stays muted and the value is the only
 * thing at foreground weight. `icon` names the fact's meaning; a fact whose meaning
 * cannot be named honestly is left without one rather than given a wrong one.
 */
export function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex w-[96px] shrink-0 items-start gap-1.5 pt-0.5 text-meta text-muted">
        {Icon && <Icon className="mt-px size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0">{label}</span>
      </span>
      <span className="min-w-0 flex-1 text-body text-foreground">{children}</span>
    </div>
  );
}

/**
 * One island of facts: the rail's card shape.
 *
 * The rail needs no heading — its contents are labelled one by one — so a title is
 * reserved for the rare card that genuinely carries more than one kind of fact.
 */
export function FactGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
      {title && <SectionLabel>{title}</SectionLabel>}
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

/**
 * The one not-found state.
 *
 * An unknown id is a link that went stale, not a crash, so it gets a sentence, the
 * record's name, and a way back rather than a blank page.
 */
export function RecordMissing({ what, back, backLabel }: { what: string; back: string; backLabel: string }) {
  const { dispatch } = useApp();
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <SearchX className="size-5 text-muted" aria-hidden />
        <SectionLabel>Not found</SectionLabel>
        <p className="text-body text-muted">
          No {what} with that id is in the tracker. It may have been removed, or the link may be out of date.
        </p>
        <Button variant="secondary" onPress={() => dispatch({ type: 'route/go', route: back })}>
          Back to {backLabel}
        </Button>
      </div>
    </div>
  );
}
