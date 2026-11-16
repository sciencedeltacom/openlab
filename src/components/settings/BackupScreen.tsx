/**
 * Backups.
 *
 * The store is one SQLite file, so a copy is the whole workbench: projects, sessions, the
 * tracker and the evidence attached to it. This page is the only place a desktop reader can
 * take one without a terminal.
 *
 * A restore is staged, never applied underneath a live connection: the chosen copy is checked,
 * written beside the store, and put in place on the next launch. The current store is copied
 * first, so the wrong choice has a way back.
 */

import { useCallback, useEffect, useState } from 'react';
import { Archive, FolderInput, RotateCcw, Upload } from 'lucide-react';

import { Button, Chip, Dialog, SectionLabel, Table } from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { invokeCommand, isDesktop } from '@/lib/ipc';
import { formatBytes } from '@/lib/format';
import { notify } from '@/lib/toast';

interface Backup {
  path: string;
  /** Unix seconds, from the file name. */
  at: number;
  size: number;
}

/** A copy's age, in the words a person uses. */
function when(at: number): string {
  if (!at) return 'unknown';
  const date = new Date(at * 1000);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The store's copies, and the one button that makes another. */
export function BackupScreen() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<Backup | null>(null);

  const load = useCallback(async () => {
    if (!isDesktop()) return;
    const result = await invokeCommand<Backup[]>('db_backups', {});
    if (result.ok) setBackups(result.value);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const backup = async () => {
    setBusy(true);
    const result = await invokeCommand<string | null>('db_backup', {});
    setBusy(false);
    if (!result.ok) {
      notify('The backup failed', { description: result.error.message, tone: 'danger' });
      return;
    }
    if (!result.value) {
      notify('There is no store to copy yet', { tone: 'warning' });
      return;
    }
    notify('Backup written', { description: result.value, tone: 'success' });
    await load();
  };

  /** Write a copy to a path the reader chooses, for a second machine or a shared drive. */
  const exportCopy = async () => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const destination = await save({
      defaultPath: `openlab-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'openlab store', extensions: ['db'] }],
    });
    if (!destination) return;
    setBusy(true);
    const result = await invokeCommand<string>('db_backup_to', { destination });
    setBusy(false);
    if (!result.ok) {
      notify('The copy could not be written', { description: result.error.message, tone: 'danger' });
      return;
    }
    notify('Copy written', { description: result.value, tone: 'success' });
  };

  /** Pick a copy from anywhere and stage it. */
  const importCopy = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'openlab store', extensions: ['db'] }],
    });
    if (!picked || Array.isArray(picked)) return;
    setBusy(true);
    const result = await invokeCommand<string>('db_restore_schedule', { path: picked });
    setBusy(false);
    if (!result.ok) {
      notify('That copy cannot be restored', { description: result.error.message, tone: 'danger' });
      return;
    }
    notify('Restore staged', {
      description: 'Quit and reopen openlab to finish. The current store is copied first.',
      tone: 'success',
    });
  };

  const restore = async () => {
    if (!chosen) return;
    setBusy(true);
    const result = await invokeCommand<string>('db_restore_schedule', { path: chosen.path });
    setBusy(false);
    setChosen(null);
    if (!result.ok) {
      notify('That copy cannot be restored', { description: result.error.message, tone: 'danger' });
      return;
    }
    notify('Restore staged', {
      description: 'Quit and reopen openlab to finish. The current store is copied first.',
      tone: 'success',
    });
  };

  return (
    <SettingsPage>
      <div className="flex w-full flex-col gap-8">
        <p className="text-body text-muted">A copy is the whole store.</p>

        <section className="flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <SectionLabel>Copies</SectionLabel>
            <span className="text-meta text-muted">{backups.length} on this machine</span>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                isDisabled={busy || !isDesktop()}
                onPress={() => void backup()}
              >
                <Archive className="size-3.5" />
                Back up now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                isDisabled={busy || !isDesktop()}
                onPress={() => void exportCopy()}
              >
                <Upload className="size-3.5" />
                Export…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                isDisabled={busy || !isDesktop()}
                onPress={() => void importCopy()}
              >
                <FolderInput className="size-3.5" />
                Restore from a file…
              </Button>
            </div>
          </header>

          {!isDesktop() ? (
            <p className="rounded-2xl bg-surface p-6 text-center text-body text-muted">
              The browser preview has no file to copy.
            </p>
          ) : backups.length === 0 ? (
            <p className="rounded-2xl bg-surface p-6 text-center text-body text-muted">
              No copies yet. One is written on the next launch, or take one now.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-surface">
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="Store backups">
                    <Table.Header>
                      <Table.Column isRowHeader>Taken</Table.Column>
                      <Table.Column className="text-end">Size</Table.Column>
                      <Table.Column>File</Table.Column>
                      <Table.Column> </Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {backups.map((entry) => (
                        <Table.Row key={entry.path} id={entry.path}>
                          <Table.Cell>{when(entry.at)}</Table.Cell>
                          <Table.Cell className="tabular-nums">{formatBytes(entry.size)}</Table.Cell>
                          <Table.Cell className="max-w-[280px] truncate font-mono text-meta text-muted">
                            {entry.path.split(/[\\/]/).pop()}
                          </Table.Cell>
                          <Table.Cell>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1.5"
                              onPress={() => setChosen(entry)}
                            >
                              <RotateCcw className="size-3.5" />
                              Restore
                            </Button>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel>Restoring</SectionLabel>
          <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 text-body text-muted">
            <p>
              The copy is checked, then put in place on the next launch. The store it replaces is copied
              first, so a restore is reversible.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Chip size="sm" variant="soft" color="default">
                local only
              </Chip>
              <span className="text-meta">Nothing leaves the machine.</span>
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={chosen !== null}
        onClose={() => setChosen(null)}
        title="Restore this copy?"
        description={
          chosen
            ? `${when(chosen.at)} · ${formatBytes(chosen.size)}. openlab will stage it and apply it on the next launch. The current store is copied first.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onPress={() => setChosen(null)}>
              Cancel
            </Button>
            <Button variant="primary" isDisabled={busy} onPress={() => void restore()}>
              Stage the restore
            </Button>
          </>
        }
      >
        <p className="text-body text-muted">
          Nothing is replaced while openlab is running; the copy is applied on the next launch.
        </p>
      </Dialog>
    </SettingsPage>
  );
}
