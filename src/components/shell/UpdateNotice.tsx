/**
 * The update check.
 *
 * One request to the release manifest on launch, in a production build only. A build with no
 * update channel, or a machine that is offline, logs the reason and says nothing: an app that
 * nags about an unreachable server is worse than one that waits.
 *
 * Nothing is installed silently. The reader is told the version and chooses; the new binary is
 * signed, and the updater verifies the signature against the key compiled into the app before
 * it runs anything.
 */

import { useEffect } from 'react';

import { isDesktop } from '@/lib/ipc';
import { logError } from '@/lib/log';
import { notify } from '@/lib/toast';

export function UpdateNotice() {
  useEffect(() => {
    if (!isDesktop() || !import.meta.env.PROD) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!update || cancelled) {
          return;
        }
        notify(`openlab ${update.version} is available`, {
          description: 'Install it now? openlab will need a restart.',
          action: {
            label: 'Install',
            onClick: () => {
              void (async () => {
                try {
                  await update.downloadAndInstall();
                  notify('The update is installed', {
                    description: 'Restart openlab to finish.',
                    tone: 'success',
                  });
                } catch (error) {
                  void logError('updater', error);
                  notify('The update could not be installed', {
                    description: error instanceof Error ? error.message : String(error),
                    tone: 'danger',
                  });
                }
              })();
            },
          },
        });
      } catch (error) {
        // No configured channel or no network: a local line is enough.
        void logError('updater', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
