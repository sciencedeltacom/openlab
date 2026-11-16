/**
 * A minimal stand-in for the Tauri IPC surface, for the workbench smoke test.
 *
 * Why it is needed: the built app is served by `vite preview` in a plain browser, where
 * `window.__TAURI_INTERNALS__` does not exist. Two consequences follow, both verified against
 * the source:
 *
 *  1. `bootStorage` does nothing (`lib/db/boot.ts`), so nothing is persisted and there is no
 *     workspace: the app opens on the Welcome screen.
 *  2. The create-workspace flow cannot finish in a browser. `pickWorkspaceFolder` falls back to
 *     a preview path, but `writeLabConfig` (`lib/workspace-config.ts`) throws when its
 *     `write_file` call has no runtime, so `project/open` is never dispatched and the workbench
 *     shell — tab strip, composer, agent bar — is unreachable.
 *
 * So the shell cannot be reached in a browser with no stub at all. This shim implements only
 * the commands boot and the create flow call, at the OS boundary. Nothing in the UI is faked:
 * the real reducer, the real router, the real composer and the real scripted engine all run,
 * and the assertions are made against the application. Commands the smoke test does not need
 * answer with a benign empty list, which is what the UI treats as "nothing there".
 *
 * `plugin:dialog|open` answers with the app's own browser-preview path
 * (`PREVIEW_WORKSPACE` in `lib/workspace.ts`), so no native dialog is involved.
 */
export function installTauriShim(): void {
  /** Mirrors `PREVIEW_WORKSPACE`; kept literal because an init script cannot close over. */
  const PREVIEW_WORKSPACE = '/Users/you/research/egfr-inhibitors';

  const internals = {
    invoke(cmd: string, args?: { method?: string }): Promise<unknown> {
      switch (cmd) {
        // The folder picker: the app's own browser fallback path.
        case 'plugin:dialog|open':
          return Promise.resolve(PREVIEW_WORKSPACE);
        // Drizzle's proxy driver: `get` wants the row or null, everything else a row list.
        case 'db_execute':
          return Promise.resolve(args?.method === 'get' ? null : []);
        // An empty folder, so the create flow takes its standard-structure path; every write
        // it makes is discarded, which is what makes the flow reach `project/open`.
        case 'list_dir':
          return Promise.resolve([]);
        case 'path_exists':
          return Promise.resolve(false);
        // Writes and backups are accepted and discarded: there is no disk here.
        case 'write_file':
        case 'db_backup':
        case 'db_backup_if_due':
          return Promise.resolve(null);
        // The log takes the line and reports no crash-report path, which is what a build with
        // no configured report returns.
        case 'log_write':
          return Promise.resolve(null);
        // Anything else is a command the browser genuinely cannot answer. It rejects, the way
        // Tauri rejects a command error, so the app takes its no-runtime path instead of
        // treating an empty list as data.
        default:
          return Promise.reject(new Error(`the browser preview has no runtime for \`${cmd}\``));
      }
    },
  };

  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals;
}
