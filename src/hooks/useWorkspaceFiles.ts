/**
 * Every file in the active workspace, one flat list.
 *
 * The Files page is an inventory, not a tree: it groups by kind and filters by size and age,
 * so it needs the whole folder at once. The walk itself is shared with the paired-folder
 * comparison (see `lib/workspace-files`).
 */

import { useCallback, useEffect, useState } from 'react';

import { kindOfName, type WorkspaceFile } from '@/components/files/data';
import { walkWorkspaceFiles } from '@/lib/workspace-files';
import { folderName } from '@/lib/workspace';

/** The active workspace's files, with loading and reload for the toolbar. */
export function useWorkspaceFiles(root: string | null) {
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!root) {
      setFiles([]);
      setError(null);
      return;
    }
    let alive = true;
    setFiles(null);
    setError(null);
    const source = folderName(root);
    void walkWorkspaceFiles(root).then(({ files: walked, error: failure }) => {
      if (!alive) {
        return;
      }
      setFiles(
        walked.map((file) => ({
          id: file.path,
          name: file.name,
          path: file.path,
          scope: 'local',
          source,
          kind: kindOfName(file.name),
          bytes: file.size,
          modified: file.modified,
        })),
      );
      setError(failure);
    });
    return () => {
      alive = false;
    };
  }, [root, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { files, error, reload };
}
