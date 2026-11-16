/**
 * Library screens.
 *
 * The material side of a project: where it comes from, how it is read, and what arrives.
 * Every entry describes something a lab already has or can reach — a folder, an API, a
 * deposit, an instrument — rather than a hypothetical integration.
 */

import { useReducer, useState } from 'react';

import { Button, Dialog, Input, Label, Select, TextArea } from '@/components/ui';
import { useApp } from '@/store/app';
import type { RouteId } from '@/app/routes';
import type { CatalogEntry, CatalogScreenSpec, ScreenSpec } from '@/components/screens/spec';

/** Where material comes from: every way it enters, and what the index knows about it. */
const sources: ScreenSpec = {
  kind: 'catalog',
  facetLabel: 'Kind',
  columns: 3,
  records: { noun: 'Source' },
  actions: (
    <div className="flex items-center gap-2">
      <NewSourceButton />
    </div>
  ),
  entries: [],
};

/** The source kinds the catalogue already knows, for the creation picker. */
const SOURCE_KINDS = Array.from(new Set((sources as CatalogScreenSpec).entries.map((entry) => entry.group)));

/**
 * The "New source" action and its dialog.
 *
 * The catalogue renders `actions` above its grid, so the button belongs to the spec. Adding
 * a source appends to the spec's own entries and nudges the host, which keeps the list local
 * and in-memory rather than a second store.
 */
function NewSourceButton() {
  const [, bump] = useReducer((value: number) => value + 1, 0);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(SOURCE_KINDS[0] ?? '');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [credential, setCredential] = useState('');

  const canSubmit = Boolean(name.trim() && location.trim());

  const submit = () => {
    const spec = sources as CatalogScreenSpec;
    const entry: CatalogEntry = {
      id: `source-${crypto.randomUUID().slice(0, 4)}`,
      name: name.trim(),
      summary: `Added from the sources list; read at ${location.trim()}.`,
      group: kind,
      tags: [kind.toLowerCase()],
      meta: [location.trim()],
      detail: [
        { label: 'Location', value: location.trim() },
        { label: 'Credential', value: credential.trim() || 'No credential required' },
      ],
    };
    spec.entries.push(entry);
    setName('');
    setLocation('');
    setCredential('');
    setOpen(false);
    // The grid reads the spec's own entries; re-render so the new row appears.
    bump();
  };

  return (
    <>
      <Button variant="primary" onPress={() => setOpen(true)}>
        New source
      </Button>
      <Dialog
        open={open}
        title="New source"
        description="Point the project at material wherever it already lives."
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" isDisabled={!canSubmit} onPress={submit}>
              Add source
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">Kind</Label>
          <Select
            label="Kind"
            value={kind}
            options={SOURCE_KINDS.map((value) => ({ value, label: value }))}
            onChange={setKind}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">Name</Label>
          <Input
            variant="secondary"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="How the list names it"
            aria-label="Source name"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">Location or URL</Label>
          <Input
            variant="secondary"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="path, host or https://…"
            aria-label="Location or URL"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">Credential note</Label>
          <TextArea
            variant="secondary"
            rows={2}
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="Which credential the source needs, if any"
            aria-label="Credential note"
          />
        </div>
      </Dialog>
    </>
  );
}

/** Public archives the workbench can query, grouped by what they hold. */
const databases: ScreenSpec = {
  kind: 'catalog',
  facetLabel: 'Family',
  columns: 3,
  records: { noun: 'Database' },
  entries: [],
};

/** Library routes. */
export const libraryScreens: Partial<Record<RouteId, ScreenSpec>> = {
  'library/sources': sources,
  'library/databases': databases,
};
