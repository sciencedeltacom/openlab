/**
 * How a file kind presents itself.
 *
 * Both the browser and a file's page need the same icon and tint for a kind; keeping the
 * map here means the row and the record can never disagree about what a notebook looks
 * like. Tone classes only — no stroke, so a kind reads as a colour, not a box.
 */

import {
  Archive,
  Boxes,
  Code2,
  Database,
  FileText,
  FileType,
  Image,
  NotebookText,
  type LucideIcon,
} from 'lucide-react';

import type { FileKind } from './data';

/** The icon and tint a kind wears in a row, a group header and a facet. */
export const KIND_META: Record<FileKind, { icon: LucideIcon; tone: string; mark: string }> = {
  dataset: { icon: Database, tone: 'text-accent', mark: 'bg-accent/15' },
  notebook: { icon: NotebookText, tone: 'text-warning', mark: 'bg-warning/15' },
  figure: { icon: Image, tone: 'text-success', mark: 'bg-success/15' },
  document: { icon: FileText, tone: 'text-muted', mark: 'bg-default' },
  pdf: { icon: FileType, tone: 'text-danger', mark: 'bg-danger/15' },
  code: { icon: Code2, tone: 'text-accent-secondary', mark: 'bg-accent-secondary/15' },
  archive: { icon: Archive, tone: 'text-muted', mark: 'bg-default' },
  model: { icon: Boxes, tone: 'text-danger', mark: 'bg-danger/15' },
};
