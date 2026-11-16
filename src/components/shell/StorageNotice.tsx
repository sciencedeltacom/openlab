/**
 * A persistent notice when the workbench cannot save.
 *
 * A toast would disappear before a reader noticed it, and losing the notice is the same as
 * losing the work. This sits above the shell until the failure clears, and a database that
 * never opened can be retried in place.
 */

import { useState, useSyncExternalStore } from 'react';
import { CircleAlert } from 'lucide-react';

import { Button } from '@/components/ui';
import { bootStorage } from '@/lib/db/boot';
import { storageIssue, subscribeStorage } from '@/lib/db/health';

/** The bar itself, or nothing when storage is healthy. */
export function StorageNotice() {
  const issue = useSyncExternalStore(subscribeStorage, storageIssue);
  const [retrying, setRetrying] = useState(false);

  if (!issue) return null;

  const open = issue.kind === 'open';
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 bg-danger-soft px-4 py-2 text-meta text-danger-soft-foreground"
      style={{ paddingTop: 'calc(var(--titlebar-h) + 0.5rem)' }}
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span className="font-medium">
        {open
          ? 'The workbench could not open its database.'
          : 'The workbench could not save your last change.'}
      </span>
      <span className="min-w-0 flex-1 truncate text-danger" title={issue.message}>
        {open
          ? 'This session is running in memory. Changes will be lost when the window closes.'
          : 'It will keep trying as you work; export anything important if this continues.'}
      </span>
      {open && (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={retrying}
          onPress={() => {
            setRetrying(true);
            void bootStorage().finally(() => setRetrying(false));
          }}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      )}
    </div>
  );
}
