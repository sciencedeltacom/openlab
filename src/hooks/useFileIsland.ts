/**
 * Show a file in the dynamic island.
 *
 * Any page can hand a file to the island and get the same view the transcript gets: the
 * island is mounted once by the shell, so opening a file from a task, a study or anywhere
 * else looks and behaves the same. `openFile` takes the path the file was named against —
 * relative to the active workspace — and an optional display name.
 */

import { useCallback } from 'react';

import { useApp } from '@/store/app';
import type { IslandDemo } from '@/store/types';

export function useFileIsland() {
  const { state, dispatch } = useApp();

  const openFile = useCallback(
    (path: string, name?: string, demo?: IslandDemo) =>
      dispatch({
        type: 'file/islandOpen',
        file: { path, name: name ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path, demo },
      }),
    [dispatch],
  );

  const close = useCallback(() => dispatch({ type: 'file/islandClose' }), [dispatch]);

  return { file: state.fileIsland, openFile, close };
}
