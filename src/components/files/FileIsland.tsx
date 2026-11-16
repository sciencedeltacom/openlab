/**
 * The file the reader is looking at, as a dynamic island.
 *
 * A path handed to {@link useFileIsland} opens here: a panel on the right, below the top bar
 * rather than over it, that arrives on a spring the way a sheet does on Apple platforms and
 * leaves the same way. It is mounted by the shell rather than by a page, so a file opens the
 * same from a task, a study or the transcript.
 */

import { AnimatePresence, motion } from 'motion/react';
import { ExternalLink, FileText, X } from 'lucide-react';

import { IconButton, ScrollShadow } from '@/components/ui';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import { FileView, openExternally } from './FileView';

/**
 * Where the panel starts. The top bar is `--titlebar-h` plus its own 3.5rem, and the panel
 * clears both with a gap, so it never covers the bar's controls.
 */
const TOP = 'calc(var(--titlebar-h) + 4.25rem)';

export function FileIsland() {
  const { state, dispatch } = useApp();
  const file = state.fileIsland;
  const root = activeProject(state)?.path ?? null;

  return (
    <AnimatePresence>
      {file && (
        <motion.aside
          key="file-island"
          initial={{ opacity: 0, x: 96, filter: 'blur(6px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: 96, filter: 'blur(6px)' }}
          transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.9 }}
          style={{ top: TOP }}
          className="fixed bottom-4 end-4 z-50 flex w-[460px] max-w-[92vw] flex-col overflow-hidden rounded-3xl bg-overlay shadow-[var(--island-shadow)]"
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-separator px-4 py-3">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-tertiary"
              aria-hidden
            >
              <FileText className="size-3.5 text-muted" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body text-foreground">{file.name}</span>
              <span className="block truncate font-mono text-meta text-muted">{file.path}</span>
            </span>
            <IconButton
              aria-label="Open in its own application"
              onPress={() => void openExternally(file.path)}
            >
              <ExternalLink className="size-4" />
            </IconButton>
            <IconButton aria-label="Close file" onPress={() => dispatch({ type: 'file/islandClose' })}>
              <X className="size-4" />
            </IconButton>
          </header>
          <ScrollShadow className="min-h-0 flex-1">
            <FileView path={file.path} name={file.name} root={root} demo={file.demo} />
          </ScrollShadow>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
