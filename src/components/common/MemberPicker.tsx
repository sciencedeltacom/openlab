/**
 * A searchable picker for one person.
 *
 * Assignment names a person, not an id: the trigger and each row carry the member's avatar
 * so two people with the same first name are told apart, and the work address sits under the
 * name so the distinction is legible without leaving the field. Unassigning is an action
 * too, so it is the first row rather than an empty state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, UserPlus } from 'lucide-react';

import { Button, Popover, Row, RowList, ScrollShadow, SearchField } from '@/components/ui';
import { newMember, memberById } from '@/store/research';
import { useApp } from '@/store/app';
import { MemberAvatar } from '@/components/research/shared';

/** Key for the "No one" row. Domain ids are `m1`-style, so a reserved key cannot collide. */
const NONE = '__none__';

/**
 * Pick a lab member by search.
 *
 * A popover rather than a Select because the list has to show an avatar and an email per
 * person, and because "No one" is a choice. The search matches name, role and email, and
 * the caller owns the value: choosing closes the popover and hands back the id.
 */
export function MemberPicker({
  value,
  onChange,
  placeholder = 'Unassigned',
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const current = memberById(state.members, value);
  const needle = query.trim().toLowerCase();

  const matches = useMemo(
    () =>
      state.members.filter(
        (member) => !needle || `${member.name} ${member.role} ${member.email}`.toLowerCase().includes(needle),
      ),
    [state.members, needle],
  );

  // The field leads, so a reader can type a surname without reaching for the mouse.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  /** Create the typed name and select it, so a first assignment does not need another screen. */
  const addTyped = () => {
    const name = query.trim();
    if (!name) {
      return;
    }
    const member = newMember(name);
    dispatch({ type: 'member/create', member });
    choose(member.id);
  };

  return (
    <Popover
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery('');
      }}
      placement="bottom start"
      className="w-[280px]"
      trigger={
        <Button
          fullWidth
          shape="field"
          size="sm"
          variant="secondary"
          className="gap-1.5"
          aria-label="Assign to a person"
        >
          <MemberAvatar id={value} size="xs" />
          <span className="min-w-0 truncate">{current?.name ?? placeholder}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
        </Button>
      }
    >
      <div className="flex flex-col gap-2 p-2">
        <SearchField aria-label="Search people" variant="secondary" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input ref={inputRef} placeholder="Search people" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <ScrollShadow className="max-h-[280px]">
          <RowList label="People" onAction={(key) => choose(key === NONE ? null : key)}>
            <Row id={NONE} textValue="No one">
              <span className="min-w-0 flex-1 truncate text-body text-foreground">No one</span>
              {value === null && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
            </Row>
            {matches.map((member) => (
              <Row key={member.id} id={member.id} textValue={`${member.name} ${member.email}`}>
                <MemberAvatar id={member.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-foreground">{member.name}</span>
                  <span className="block truncate text-meta text-muted">{member.email}</span>
                </span>
                {member.id === value && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
              </Row>
            ))}
          </RowList>
        </ScrollShadow>
        {matches.length === 0 && (
          <p className="px-2 text-body text-muted">
            {needle ? `No one matches “${query.trim()}”.` : 'No people yet.'}
          </p>
        )}
        {needle.length > 0 && !matches.some((member) => member.name.toLowerCase() === needle) && (
          <Button size="sm" variant="secondary" className="mx-2 mb-2 gap-1.5" onPress={addTyped}>
            <UserPlus className="size-3.5" />
            Add “{query.trim()}”
          </Button>
        )}
      </div>
    </Popover>
  );
}
