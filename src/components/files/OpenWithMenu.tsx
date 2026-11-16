/**
 * Where a file could open instead.
 *
 * Lives on the file's own tab rather than on the page, because the page is the editor: a
 * header above a document that only holds a name and two buttons is a header that costs a
 * row of the document. The tab already names the file, so it is where the file's own actions
 * belong.
 */

import { ArrowUp, Copy, ExternalLink, FolderOpen } from 'lucide-react';

import { IconButton, Menu, MenuItem, Tip } from '@/components/ui';
import { isDesktop } from '@/lib/ipc';
import { useCopy } from '@/hooks/useCopy';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';

/** The path as the operating system wants it: a relative one is resolved against the root. */
function absolutePath(root: string | null, path: string): string {
  if (!root || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
    return path;
  }
  return `${root.replace(/[\\/]+$/, '')}/${path}`;
}

/** The file's own application, its folder, or its path on the clipboard. */
export function OpenWithMenu({ path }: { path: string }) {
  const { state } = useApp();
  const copy = useCopy();
  const root = activeProject(state)?.path ?? null;
  const full = absolutePath(root, path);

  const reveal = async () => {
    if (!isDesktop()) {
      return;
    }
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(full).catch(() => undefined);
  };

  const open = async () => {
    if (!isDesktop()) {
      return;
    }
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(full).catch(() => undefined);
  };

  return (
    <Menu
      label="Open with"
      placement="bottom end"
      trigger={
        <Tip content="Open with">
          <IconButton aria-label="Open with">
            <ArrowUp className="size-3.5" />
          </IconButton>
        </Tip>
      }
      onAction={(key) => {
        if (key === 'system') void open();
        if (key === 'reveal') void reveal();
        if (key === 'copy') copy(path, 'path');
      }}
    >
      <MenuItem id="system" icon={<ExternalLink className="size-4 shrink-0" />}>
        Its own application
      </MenuItem>
      <MenuItem id="reveal" icon={<FolderOpen className="size-4 shrink-0" />}>
        Show in folder
      </MenuItem>
      <MenuItem id="copy" icon={<Copy className="size-4 shrink-0" />}>
        Copy path
      </MenuItem>
    </Menu>
  );
}
