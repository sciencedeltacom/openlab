/**
 * Copy to the clipboard, once.
 *
 * Several views wrote the same `navigator.clipboard.writeText(...)` and either
 * said nothing or grew their own "Copied" flag. Clipboard access is
 * secure-context only, so a denial is a real failure and is reported as one.
 */

import { useCallback } from 'react';

import { notify } from '@/lib/toast';

/** Copy `text` and say so. `label` names what was copied: "Copied command". */
export function useCopy(): (text: string, label?: string) => void {
  return useCallback((text: string, label?: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => notify(label ? `Copied ${label}` : 'Copied to the clipboard', { tone: 'success' }))
      .catch(() => notify('Could not copy to the clipboard', { tone: 'danger' }));
  }, []);
}
