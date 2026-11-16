/**
 * The frame every step of a review shares.
 *
 * A review is one workflow with six stops, so the six names and their order live in one place.
 * A step supplies its own toolbar, body and optional configuration panel; this file supplies
 * the chrome and the layout that puts the panel on the right.
 *
 * Nothing here reads a route: the workspace owns which step is open and passes it down.
 */

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ClipboardCheck,
  Database,
  FileText,
  FlaskConical,
  ListChecks,
  Table2,
  type LucideIcon,
} from 'lucide-react';

import { ScrollShadow, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { MOTION } from '@/theme/tokens';
import type { Review } from '../data';

/** The six stops of a systematic review, in the order the work happens. */
export type ReviewStepId =
  'sources' | 'screening-pilot' | 'screening' | 'extraction-pilot' | 'extraction' | 'report';

/** One stop: its name, its mark, and the one line that says what the stop is for. */
export interface ReviewStep {
  id: ReviewStepId;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

/** The workflow, in order. The indicator and the picker both read this. */
export const REVIEW_STEPS: ReviewStep[] = [
  { id: 'sources', label: 'Sources', icon: Database, blurb: 'The records gathered for the question' },
  {
    id: 'screening-pilot',
    label: 'Screening pilot',
    icon: FlaskConical,
    blurb: 'Try the criteria on a few records',
  },
  { id: 'screening', label: 'Screening', icon: ListChecks, blurb: 'Judge every record against the criteria' },
  {
    id: 'extraction-pilot',
    label: 'Extraction pilot',
    icon: ClipboardCheck,
    blurb: 'Try the extraction columns',
  },
  { id: 'extraction', label: 'Extraction', icon: Table2, blurb: 'Pull the values from the included records' },
  { id: 'report', label: 'Report', icon: FileText, blurb: 'The review, written from the work' },
];

/* ================================================================================================
 * The chrome and the frame
 * ============================================================================================== */

/**
 * The review's heading.
 *
 * The step is chosen from the top bar — it is global chrome, and the row of marks that used to
 * sit here was a second control for the thing the top bar already controls, above the data it
 * was describing. What is left is the question, as the page's title.
 */
export function ReviewChrome({ review }: { review: Review }) {
  return (
    <header className="flex flex-col gap-2 px-7 pt-5 pb-1">
      <h1 className="max-w-[80ch] text-[1.5rem] leading-snug font-semibold text-foreground">
        {review.question}
      </h1>
    </header>
  );
}

/**
 * The narrowest a table may be before it scrolls.
 *
 * Derived from the tracks the table declares rather than written beside them: two numbers that
 * have to agree, maintained by hand, do not stay in agreement. `ScreeningStep` declared a
 * template eighty rems wide and a minimum of eighty-six, which is six rems of nothing at the
 * end of every scroll.
 */
export function tableMinWidth(template: string): string {
  const rems = template
    .split(' ')
    .filter(Boolean)
    .reduce((total, track) => {
      // A `minmax(min, …)` track is worth its minimum; a fixed track its own length.
      const minmax = /^minmax\(\s*(\d+(?:\.\d+)?)(px|rem|em)/.exec(track);
      const fixed = /^(\d+(?:\.\d+)?)(px|rem|em)$/.exec(track);
      const length = minmax ?? fixed;
      if (length) {
        return total + (length[2] === 'px' ? Number(length[1]) / 16 : Number(length[1]));
      }
      // A flexible track is worth about a column; anything else is worth a default.
      return total + 8;
    }, 0);
  return `${rems}rem`;
}

/**
 * One step's layout: an optional toolbar, the step body, and an optional configuration panel.
 *
 * The panel is a rail, not a drawer: it holds the controls that shape the step beside the data
 * they shape, and it sticks while the body scrolls.
 */
export function StepFrame({
  toolbar,
  aside,
  children,
}: {
  toolbar?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollShadow className="min-h-0 flex-1">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
        className="flex w-full flex-col gap-4 px-7 pt-4 pb-9"
      >
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        <div
          className={cn(
            'gap-6',
            aside ? 'grid grid-cols-1 items-start xl:grid-cols-[minmax(0,1fr)_280px]' : 'flex flex-col',
          )}
        >
          <main className="flex min-w-0 flex-col gap-4">{children}</main>
          {aside && <aside className="flex flex-col gap-4 xl:sticky xl:top-4">{aside}</aside>}
        </div>
      </motion.div>
    </ScrollShadow>
  );
}

/** One titled card in a step's configuration panel. Layout only; the caller fills it. */
export function StepPanel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
      {title && <SectionLabel>{title}</SectionLabel>}
      {children}
    </section>
  );
}

/** A labelled field in a step, used for the review question and the filter row. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="block text-meta text-muted">{children}</span>;
}
