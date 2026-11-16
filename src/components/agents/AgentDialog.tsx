/**
 * Edit or create an agent, from the bar.
 *
 * The bar's rows are the agents' own surface, so the menu on a row opens this rather than
 * sending the reader to a page: renaming an agent is a small act and should not cost a
 * navigation. The fields are the ones the create page asks for, so both doors write the same
 * record.
 *
 * A built-in agent is editable for the session and is refreshed from the shipped definition on
 * the next launch, so the dialog says so and offers duplication as the way to keep a change.
 */

import { useEffect, useState } from 'react';

import { Button, Dialog, Input, Label, Switch, TextArea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { AgentOrb } from './AgentOrb';
import { addAgent, agentTeams, patchAgent } from './store';
import { AVATAR_COLORS, type Agent } from './data';

interface Form {
  name: string;
  team: string;
  summary: string;
  instructions: string;
  modelRef: string;
  readOnly: boolean;
  avatarColor: string;
}

function formOf(agent: Agent | null): Form {
  return {
    name: agent?.name ?? '',
    team: agent?.team ?? '',
    summary: agent?.summary ?? '',
    instructions: agent?.instructions ?? '',
    modelRef: agent?.modelRef ?? '',
    readOnly: agent?.readOnly ?? false,
    avatarColor: agent?.avatarColor ?? AVATAR_COLORS[0]!,
  };
}

export function AgentDialog({
  open,
  agent,
  onClose,
}: {
  open: boolean;
  /** The agent to edit, or `null` to create one. */
  agent: Agent | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(agent));
  const teams = agentTeams();

  useEffect(() => {
    if (open) setForm(formOf(agent));
  }, [open, agent]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = () => {
    const name = form.name.trim();
    if (!name) return;
    const patch = {
      name,
      team: form.team.trim(),
      summary: form.summary.trim(),
      instructions: form.instructions.trim(),
      modelRef: form.modelRef.trim(),
      readOnly: form.readOnly,
      avatarColor: form.avatarColor,
    };
    if (agent) {
      patchAgent(agent.id, patch);
    } else {
      addAgent(patch);
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={agent ? `Edit ${agent.name}` : 'New agent'}
      description="An agent is a way to lead the turn: what it is for, what it must do, and which model it runs on."
      width={640}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!form.name.trim()} onPress={save}>
            {agent ? 'Save' : 'Create agent'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {agent?.builtIn && (
          <p className="rounded-xl bg-warning/10 p-3 text-meta text-warning">
            Ships with openlab. Your edits override it; duplicate it for a separate agent.
          </p>
        )}

        <div className="flex items-center gap-4">
          <AgentOrb color={form.avatarColor} size={56} />
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-foreground">Avatar colour</span>
            <div className="flex flex-wrap gap-1.5">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use ${color}`}
                  aria-pressed={form.avatarColor === color}
                  onClick={() => set('avatarColor', color)}
                  className={cn(
                    'size-6 rounded-full transition-transform',
                    form.avatarColor === color ? 'scale-105 ring-2 ring-foreground/40' : 'hover:scale-105',
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="e.g. Literature scout"
            aria-label="Name"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <Label>Team</Label>
          <Input
            value={form.team}
            onChange={(event) => set('team', event.target.value)}
            placeholder="No team"
            aria-label="Team"
          />
          {teams.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-meta text-muted">Existing:</span>
              {teams.map((existing) => (
                <button
                  key={existing}
                  type="button"
                  className="rounded-full bg-surface-secondary px-2 py-0.5 text-meta text-muted transition-colors hover:text-foreground"
                  onClick={() => set('team', existing)}
                >
                  {existing}
                </button>
              ))}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <Label>What it is for</Label>
          <Input
            value={form.summary}
            onChange={(event) => set('summary', event.target.value)}
            placeholder="One line the switcher shows under the name"
            aria-label="What it is for"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <Label>Instructions</Label>
          <TextArea
            rows={5}
            value={form.instructions}
            onChange={(event) => set('instructions', event.target.value)}
            placeholder="What this agent must always do."
            aria-label="Instructions"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <Label>Model</Label>
          <Input
            value={form.modelRef}
            onChange={(event) => set('modelRef', event.target.value)}
            placeholder="provider/model-id"
            aria-label="Model"
          />
          <span className="text-meta text-muted">Empty uses the session&apos;s own model.</span>
        </label>

        <div className="flex items-center gap-2">
          <Switch
            isSelected={form.readOnly}
            onChange={(next) => set('readOnly', next)}
            aria-label="Read-only agent"
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          <span className="text-body text-foreground">Read-only</span>
          <span className="text-meta text-muted">No writes, execution or network.</span>
        </div>
      </div>
    </Dialog>
  );
}
