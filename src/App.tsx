/**
 * Application root.
 *
 * There is no in-memory mode: the shell shows the workspace when a folder is open and the
 * way to open one when it is not. The account is app-level, not a precondition.
 */

import { useEffect } from 'react';

import { Toast } from '@/components/ui';
import { StorageNotice } from '@/components/shell/StorageNotice';
import { ErrorBoundary } from '@/components/shell/ErrorBoundary';
import { AppShell } from '@/components/shell/AppShell';
import { UpdateNotice } from '@/components/shell/UpdateNotice';
import { AppProvider, useApp } from '@/store/app';
import { logError } from '@/lib/log';
import { notify } from '@/lib/toast';
import { crashReportEnabled } from '@/lib/settings';

/**
 * The last resort for a failure no boundary caught.
 *
 * A local line is always written; the crash report file is opt-in, and when it was written
 * the reader is told where. Nothing is sent anywhere.
 */
function Diagnostics() {
  const { state } = useApp();
  const report = crashReportEnabled(state.preferences);

  useEffect(() => {
    const save = (scope: string, error: unknown, fields: Record<string, unknown>) => {
      void logError(scope, error, fields, report).then((path) => {
        if (path) {
          notify('A crash report was saved', { description: path, tone: 'warning' });
        }
      });
    };
    const onError = (event: ErrorEvent) =>
      save('window', event.error ?? event.message, {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    const onRejection = (event: PromiseRejectionEvent) => save('promise', event.reason, {});
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [report]);

  return null;
}

/** Root component. */
export function App() {
  return (
    <AppProvider>
      <Diagnostics />
      <UpdateNotice />
      <StorageNotice />
      {/* The shell itself can fail too (a bad persisted tab, a broken provider). A boundary
          here keeps the failure inside the window, with a reload as the way out. */}
      <ErrorBoundary label="The workbench could not be drawn">
        <AppShell />
      </ErrorBoundary>
      {/*
        The viewport, mounted once. A sibling of the shell rather than its wrapper:
        HeroUI's region only renders its children while a toast is visible, so wrapping
        the app would blank it whenever the queue is empty. Anchored bottom-right so the
        stack never covers the top bar; narrower than the default because a toast is a
        sentence, not a panel.
      */}
      <Toast.Provider placement="bottom end" width={380} />
    </AppProvider>
  );
}
