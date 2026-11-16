/**
 * Define an agent.
 *
 * A page, not a modal: an agent carries a name, a team, what it is for, the instructions appended
 * to the system prompt, the model it prefers and its avatar colour. Creating one also chooses it,
 * because the whole point is to answer "who leads the next turn".
 */

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Play } from 'lucide-react';

import { Button, Input, ScrollShadow, SectionLabel, Switch, TextArea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import { AgentOrb } from './AgentOrb';
import { addAgent, agentTeams } from './store';
import { AVATAR_COLORS } from './data';

/** A labelled field. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-foreground">{label}</span>
      {children}
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </label>
  );
}

export function AgentCreate() {
  const { dispatch } = useApp();
  const teams = agentTeams();
  const leave = () => dispatch({ type: 'route/go', route: 'assistant' });

  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [summary, setSummary] = useState('');
  const [instructions, setInstructions] = useState('');
  const [modelRef, setModelRef] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]!);

  const create = () => {
    if (!name.trim()) {
      return;
    }
    addAgent({ name, team, summary, instructions, modelRef, readOnly, avatarColor });
    leave();
  };

  return (
    <ScrollShadow className="h-full">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-7 py-7">
        <header className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="w-fit gap-1.5" onPress={leave}>
            <ArrowLeft className="size-3.5" />
            AI
          </Button>
          <h1 className="text-[1.5rem] font-semibold text-foreground">New agent</h1>
          <p className="max-w-[70ch] text-body text-muted">
            How the turn is led: what the agent is for, what it must do, and which model it runs on.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>Identity</SectionLabel>
          <div className="flex items-center gap-4">
            <AgentOrb color={avatarColor} size={64} />
            <div className="flex flex-col gap-1.5">
              <span className="text-label text-foreground">Avatar colour</span>
              <div className="flex flex-wrap gap-1.5">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Use ${color}`}
                    aria-pressed={avatarColor === color}
                    onClick={() => setAvatarColor(color)}
                    className={cn(
                      'size-6 rounded-full transition-transform',
                      avatarColor === color ? 'scale-105 ring-2 ring-foreground/40' : 'hover:scale-105',
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>

          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Literature scout"
            />
          </Field>

          <Field label="Team" hint="Leave empty for a solo agent. A team is just a shared label.">
            <Input value={team} onChange={(event) => setTeam(event.target.value)} placeholder="No team" />
          </Field>
          {teams.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-meta text-muted">Existing:</span>
              {teams.map((existing) => (
                <button
                  key={existing}
                  type="button"
                  className="rounded-full bg-surface-secondary px-2 py-0.5 text-meta text-muted transition-colors hover:text-foreground"
                  onClick={() => setTeam(existing)}
                >
                  {existing}
                </button>
              ))}
            </span>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>How it leads</SectionLabel>
          <Field label="What it is for">
            <Input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="One line the switcher shows under the name"
            />
          </Field>
          <Field label="Instructions" hint="Appended to the system prompt when this agent leads.">
            <TextArea
              rows={5}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="What this agent must always do."
            />
          </Field>
          <Field label="Model" hint="Empty uses the session's own model.">
            <Input
              value={modelRef}
              onChange={(event) => setModelRef(event.target.value)}
              placeholder="provider/model-id"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Switch isSelected={readOnly} onChange={setReadOnly} aria-label="Read-only agent">
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            <span className="text-body text-foreground">Read-only</span>
            <span className="text-meta text-muted">No writes, execution or network.</span>
          </div>
        </section>

        <footer className="flex items-center justify-end gap-2">
          <Button variant="ghost" onPress={leave}>
            Cancel
          </Button>
          <Button variant="primary" className="gap-1.5" isDisabled={!name.trim()} onPress={create}>
            <Play className="size-3.5" />
            Create agent
          </Button>
        </footer>
      </div>
    </ScrollShadow>
  );
}
