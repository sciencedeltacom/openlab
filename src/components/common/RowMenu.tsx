/**
 * The per-row editing affordances shared by every list.
 *
 * A list row is a place you can act, not only read. `RowMenu` is the trailing menu that
 * carries those actions; `RenameModal` is the one dialog a rename uses. Both are built on
 * the wrapped HeroUI primitives, so a menu opened from a task row and one opened from a
 * source card are the same control.
 *
 * The menu must sit *beside* a pressable row, never inside it: React Aria rejects a button
 * nested in a button. Callers with a whole-row button put the menu next to the button in a
 * `group` wrapper and let `group-hover` reveal it; callers with a card that has an
 * invisible overlay give the menu `relative z-10`.
 */

import { useEffect, useState } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

import { Button, DateInput, Dialog, IconButton, Input, Label, Menu, MenuItem, Select } from '@/components/ui';
import { cn } from '@/lib/cn';

/** One entry in a {@link RowMenu}. */
export interface RowAction {
  id: string;
  label: string;
  /** Leading icon, drawn and tinted by the menu. */
  icon?: LucideIcon;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * The trailing menu for one row.
 *
 * Hidden until the row is hovered or something inside it is focused, so a column of menus
 * does not compete with the row's own content. It stays in the tab order while hidden,
 * which is what lets a keyboard user reach it.
 */
export function RowMenu({
  label,
  actions,
  always,
  className,
}: {
  /** Accessible name, e.g. "Actions for CRS-142". */
  label: string;
  actions: RowAction[];
  /** Show the trigger without waiting for hover, for a menu that is the row's only control. */
  always?: boolean;
  className?: string;
}) {
  if (actions.length === 0) return null;
  const byId = new Map(actions.map((action) => [action.id, action]));

  return (
    <span
      className={cn(
        'transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100',
        always ? 'opacity-100' : 'opacity-0',
        className,
      )}
    >
      <Menu
        label={label}
        popoverClassName="min-w-[200px]"
        trigger={
          <IconButton aria-label={label} title={label}>
            <MoreHorizontal className="size-4" />
          </IconButton>
        }
        onAction={(id) => byId.get(id)?.onSelect()}
      >
        {actions.map((action) => (
          <MenuItem
            key={action.id}
            id={action.id}
            danger={action.danger}
            icon={action.icon ? <action.icon className="size-4 shrink-0 text-muted" /> : undefined}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}

/** One choice from a fixed list, in the same dialog shape as a rename. */
export function ChoiceModal<T extends string>({
  open,
  title,
  label,
  value,
  options,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onClose: () => void;
  onSubmit: (value: T) => void;
}) {
  const [choice, setChoice] = useState<T>(value);

  useEffect(() => {
    if (open) setChoice(value);
  }, [open, value]);

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => {
              onSubmit(choice);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label className="text-label">{label}</Label>
        <Select label={label} value={choice} options={options} onChange={setChoice} />
      </div>
    </Dialog>
  );
}

/**
 * The one rename dialog.
 *
 * Built on the shared {@link Dialog} so a rename and every other overlay in the app cannot
 * look like two different products. The caller owns where the new name goes.
 */
export function RenameModal({
  open,
  title,
  label = 'Name',
  value,
  submitLabel = 'Save',
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label?: string;
  value: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Re-seed each time the dialog opens, so it never shows the previous record's name.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const canSubmit = draft.trim().length > 0;

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isDisabled={!canSubmit}
            onPress={() => {
              if (!canSubmit) return;
              onSubmit(draft.trim());
              onClose();
            }}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label className="text-label">{label}</Label>
        <Input
          variant="secondary"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={label}
          autoFocus
        />
      </div>
    </Dialog>
  );
}

/**
 * The one date dialog.
 *
 * A rename's shape with a calendar instead of a text box, so every date in the app is edited
 * the same way. The caller owns where the date goes; the domain still stores a string.
 */
export function DateModal({
  open,
  title,
  label = 'Date',
  value,
  clearable = true,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label?: string;
  value: string | null;
  /** Offer a Clear action. Off for a date the domain cannot leave empty. */
  clearable?: boolean;
  onClose: () => void;
  onSubmit: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(value);

  // Re-seed each time the dialog opens, so it never shows the previous record's date.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => {
              onSubmit(draft);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <DateInput label={label} value={draft} onChange={setDraft} clearable={clearable} />
    </Dialog>
  );
}
