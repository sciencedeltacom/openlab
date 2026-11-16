/**
 * The data editor.
 *
 * A chart's numbers, a table's cells and a gene's features are all a grid, and a textarea is
 * not a grid: it cannot say what a column is, it cannot delete a row, and a typo in it is a
 * silent hole in the figure. This is the dialog that edits one properly — labelled columns,
 * one field per cell, a row you can drop, and a paste that takes a spreadsheet column.
 *
 * Edits are live, like every other field in the inspector, so the canvas and the preview in
 * the dialog both follow what is being typed and ⌘Z still undoes it.
 */

import { useState, type ReactNode } from 'react';
import { ClipboardPaste, Plus, Trash2 } from 'lucide-react';

import { Button, Dialog, IconButton, Input, ScrollShadow, SectionLabel } from '@/components/ui';
import { notify } from '@/lib/toast';

export interface DataColumn {
  label: string;
  /** A short note under the header, e.g. the unit. */
  hint?: string;
}

export interface DataDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  columns: DataColumn[];
  rows: string[][];
  onChange: (rows: string[][]) => void;
  /** What the data makes, drawn from the current values. */
  preview?: ReactNode;
  /** One line about the shape of the data, under the grid. */
  footnote?: string;
  addLabel?: string;
  /** Offer a paste from the clipboard, one row per line. */
  paste?: boolean;
  width?: number;
}

export function DataDialog({
  open,
  onClose,
  title,
  description,
  columns,
  rows,
  onChange,
  preview,
  footnote,
  addLabel = 'Add row',
  paste = true,
  width = 640,
}: DataDialogProps) {
  const [busy, setBusy] = useState(false);
  const template = `repeat(${columns.length}, minmax(0, 1fr)) auto`;

  const setCell = (rowIndex: number, columnIndex: number, value: string) => {
    onChange(
      rows.map((row, index) =>
        index === rowIndex
          ? columns.map((_, cell) => (cell === columnIndex ? value : (row[cell] ?? '')))
          : row,
      ),
    );
  };

  const addRow = () => onChange([...rows, columns.map(() => '')]);

  const removeRow = (rowIndex: number) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, index) => index !== rowIndex));
  };

  /** Take a block from the clipboard: one row per line, cells split on comma or tab. */
  const pasteBlock = () => {
    setBusy(true);
    navigator.clipboard
      .readText()
      .then((text) => {
        const parsed = text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.split(/\t|,|;/).map((cell) => cell.trim()));
        if (parsed.length === 0) {
          notify('Nothing to paste', { tone: 'warning' });
          return;
        }
        onChange(parsed.map((cells) => columns.map((_, index) => cells[index] ?? '')));
        notify(`Pasted ${parsed.length} ${parsed.length === 1 ? 'row' : 'rows'}`, { tone: 'success' });
      })
      .catch(() => notify('Could not read the clipboard', { tone: 'danger' }))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={width}
      footer={
        <div className="flex items-center justify-end gap-2">
          {paste && (
            <Button variant="secondary" size="sm" className="gap-1.5" isDisabled={busy} onPress={pasteBlock}>
              <ClipboardPaste className="size-3.5" />
              Paste from clipboard
            </Button>
          )}
          <Button variant="primary" size="sm" onPress={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {preview}

        <ScrollShadow className="max-h-[46vh]">
          <div className="flex flex-col gap-1.5 pr-0.5">
            <div className="grid items-end gap-1.5" style={{ gridTemplateColumns: template }}>
              {columns.map((column) => (
                <span key={column.label} className="flex flex-col gap-0.5">
                  <SectionLabel>{column.label}</SectionLabel>
                  {column.hint && <span className="text-[11px] text-muted">{column.hint}</span>}
                </span>
              ))}
              <span className="w-8" aria-hidden />
            </div>

            {rows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="grid items-center gap-1.5"
                style={{ gridTemplateColumns: template }}
              >
                {columns.map((column, columnIndex) => (
                  <Input
                    key={column.label}
                    fullWidth
                    value={row[columnIndex] ?? ''}
                    onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)}
                    aria-label={`${column.label} ${rowIndex + 1}`}
                  />
                ))}
                <IconButton
                  aria-label={`Remove row ${rowIndex + 1}`}
                  isDisabled={rows.length <= 1}
                  onPress={() => removeRow(rowIndex)}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        </ScrollShadow>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5" onPress={addRow}>
            <Plus className="size-3.5" />
            {addLabel}
          </Button>
          {footnote && <span className="text-[11px] text-muted">{footnote}</span>}
        </div>
      </div>
    </Dialog>
  );
}
