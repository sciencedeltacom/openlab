/**
 * The contents of a zip archive, as a table.
 *
 * The archive is opened on the Rust side and only its table of contents crosses the IPC
 * boundary — nothing is extracted to disk. A real `Table`, like the rest of the app's
 * tabular data, so a folder and a file in an archive read the way a folder and a file read
 * anywhere else. A demo archive skips the read and renders its inline entries through the
 * same table.
 */

import { useEffect, useState } from 'react';
import { FileText, Folder } from 'lucide-react';

import { CellGroup, Spinner, Table } from '@/components/ui';
import { invokeCommand } from '@/lib/ipc';
import { formatBytes } from '@/lib/format';
import type { IslandZipEntry } from '@/store/types';

/** The table itself, shared by the read path and the demo path. */
export function ZipTable({ name, entries }: { name: string; entries: IslandZipEntry[] }) {
  if (entries.length === 0) {
    return <p className="px-4 py-3.5 text-body text-muted">This archive is empty.</p>;
  }

  return (
    <CellGroup className="p-3" footnote={`${entries.length} entries in ${name}`}>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={`Contents of ${name}`}>
            <Table.Header>
              <Table.Column isRowHeader>Name</Table.Column>
              <Table.Column className="text-end">Size</Table.Column>
              <Table.Column className="text-end">Packed</Table.Column>
            </Table.Header>
            <Table.Body>
              {entries.map((entry) => (
                <Table.Row key={entry.name} id={entry.name}>
                  <Table.Cell>
                    <span className="flex min-w-0 items-center gap-2">
                      {entry.isDir ? (
                        <Folder className="size-4 shrink-0 text-muted" aria-hidden />
                      ) : (
                        <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                      )}
                      <span className="min-w-0 truncate">{entry.name}</span>
                    </span>
                  </Table.Cell>
                  <Table.Cell className="text-end tabular-nums">
                    {entry.isDir ? '—' : formatBytes(entry.size)}
                  </Table.Cell>
                  <Table.Cell className="text-end tabular-nums">
                    {entry.isDir ? '—' : formatBytes(entry.compressed)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </CellGroup>
  );
}

export function ZipView({ path, name, root }: { path: string; name: string; root: string | null }) {
  const [entries, setEntries] = useState<IslandZipEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) {
      setEntries(null);
      setError('No folder is open.');
      return;
    }
    let alive = true;
    setEntries(null);
    setError(null);
    void invokeCommand<IslandZipEntry[]>('list_zip', { path, root }).then((result) => {
      if (!alive) {
        return;
      }
      if (result.ok) {
        setEntries(result.value);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      alive = false;
    };
  }, [path, root]);

  if (error) {
    return <p className="px-4 py-3.5 text-body text-muted">{error}</p>;
  }
  if (entries === null) {
    return (
      <div className="grid place-items-center py-8">
        <Spinner />
      </div>
    );
  }
  return <ZipTable name={name} entries={entries} />;
}
