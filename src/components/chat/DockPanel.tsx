/**
 * A panel that docks above the composer.
 *
 * Two of them exist — the plan and the sessions a turn delegated to — and both are furniture
 * rather than content: worth a glance while the turn runs, worth folding away while it is
 * read. The shape is shared here so the two fold the same way: one shared-layout element that
 * shrinks into a pill at the prompt's top-right and grows back out of it.
 */

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react';

import { IconButton, SectionLabel } from '@/components/ui';
import { MOTION } from '@/theme/tokens';

export function DockPanel({
  layoutId,
  icon: Icon,
  label,
  meta,
  open,
  onToggle,
  status,
  mark,
  pill,
  children,
}: {
  /** One id per panel, so motion folds this element into its own pill. */
  layoutId: string;
  icon: LucideIcon;
  /** The panel's name, in the header and in the pill's aria label. */
  label: string;
  /** The header's right-hand fact: `2/5`, `2 · 1 working`. */
  meta: ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** The pill's leading mark, when an icon does not say it: a spinner, a row of avatars. */
  status?: ReactNode;
  /** The header's leading mark, when an icon does not say it. */
  mark?: ReactNode;
  /** The pill's words. */
  pill: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shrink-0 px-6 pb-2">
      <div className="mx-auto w-full max-w-[760px]">
        {open ? (
          <motion.section
            layoutId={layoutId}
            transition={MOTION.spring}
            aria-label={label}
            className="overflow-hidden rounded-2xl bg-surface px-1.5 py-1.5"
          >
            {/* The content arrives after the box has grown: shown any earlier, its icons sit
                inside a box still the size of the pill and read as oversized. */}
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, delay: 0.12 }}
            >
              <header className="flex items-center gap-1.5 px-1.5 py-0.5">
                {mark ?? <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />}
                <SectionLabel>{label}</SectionLabel>
                <span className="min-w-0 flex-1 truncate text-meta tabular-nums text-muted">{meta}</span>
                <IconButton
                  aria-label={`Collapse the ${label.toLowerCase()}`}
                  title="Collapse"
                  onPress={() => onToggle(false)}
                >
                  <ChevronDown className="size-3" />
                </IconButton>
              </header>
              {children}
            </motion.div>
          </motion.section>
        ) : (
          <div className="flex justify-end">
            <motion.button
              type="button"
              layoutId={layoutId}
              transition={MOTION.spring}
              onClick={() => onToggle(true)}
              aria-label={`Open the ${label.toLowerCase()}`}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-2.5 py-1 text-meta text-muted shadow-sm transition-colors hover:text-foreground"
            >
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.16, delay: 0.08 }}
                className="flex items-center gap-1.5"
              >
                <span className="flex shrink-0 items-center justify-center">
                  {status ?? <Icon className="size-3" aria-hidden />}
                </span>
                <span>{pill}</span>
                <ChevronUp className="size-3 shrink-0" aria-hidden />
              </motion.span>
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}
