/**
 * Small pieces shared by tool bodies: a monospace block and a listed entry.
 */

import { FileText, Folder } from 'lucide-react';
import type { ReactNode } from 'react';

/** Tool output that reads as text: warns of nothing, wraps, and caps its height. */
export function MonoText({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-meta leading-relaxed text-foreground/90">
      {children}
    </pre>
  );
}

/** One entry in a directory or glob listing. */
export function FileRow({ name, directory }: { name: string; directory?: boolean }) {
  const Icon = directory ? Folder : FileText;
  return (
    <div className="flex items-center gap-2 text-meta">
      <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-foreground/90">{name}</span>
    </div>
  );
}
