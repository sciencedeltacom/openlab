/**
 * Settings → Instructions.
 *
 * The workspace's own words for the system prompt: one global note, a replacement behaviour
 * per mode, and a note for workers. Empty means the built-in text; a filled one wins. The
 * preview is built by the same function the turn uses, so what is shown is what is sent.
 */

import { useMemo } from 'react';

import { SectionLabel, TextArea } from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { buildSystemPrompt } from '@/lib/agent/prompt';
import { useApp, usePageTitle } from '@/store/app';
import type { PromptOverrides } from '@/lib/settings';

/** One editable prompt block. */
function PromptField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-foreground">{label}</span>
      <TextArea
        value={value}
        aria-label={label}
        rows={6}
        placeholder="Empty means the built-in instructions."
        onChange={(event) => onChange((event.target as HTMLTextAreaElement).value)}
      />
      <span className="text-meta text-muted">{hint}</span>
    </label>
  );
}

/** The page. */
export function InstructionsScreen() {
  usePageTitle('Instructions');
  const { state, dispatch } = useApp();
  const prompts = state.prompts;

  const update = (patch: Partial<PromptOverrides>) =>
    dispatch({ type: 'prompt/set', prompts: { ...prompts, ...patch } });

  // The real builder, with the reader's preferences and no tools: this is the frame an agent
  // would receive before any surface narrows it.
  const preview = useMemo(
    () =>
      buildSystemPrompt({
        mode: 'agent',
        workspace: state.projects.find((project) => project.id === state.activeProjectId)?.path ?? '',
        surface: { toolIds: [], mcpIds: [], skillIds: [] },
        preferences: state.preferences,
        prompts,
        interface: false,
      }),
    [state.projects, state.activeProjectId, state.preferences, prompts],
  );

  return (
    <SettingsPage
      aside={[
        {
          title: 'Precedence',
          items: [
            { label: 'Global', value: 'every turn' },
            { label: 'Mode', value: 'replaces the built-in' },
            { label: 'Worker', value: 'appended to the worker' },
            { label: 'Agent', value: 'the agent bar wins last' },
          ],
        },
        {
          title: 'Stored',
          items: [
            { label: 'Where', value: 'SQLite settings' },
            { label: 'Scope', value: 'this workspace' },
            { label: 'Sent', value: 'every turn' },
          ],
        },
      ]}
    >
      <div className="flex w-full flex-col gap-8">
        <p className="text-body text-muted">Conventions the agent should follow without being told again.</p>

        <section className="flex flex-col gap-4">
          <SectionLabel>System prompt</SectionLabel>
          <PromptField
            label="Global instructions"
            hint="Appended to every turn, lead or worker, after the mode's behaviour."
            value={prompts.global}
            onChange={(global) => update({ global })}
          />
          <PromptField
            label="Agent mode"
            hint="Replaces the built-in agent behaviour: do the work, carry it to a result."
            value={prompts.agent}
            onChange={(agent) => update({ agent })}
          />
          <PromptField
            label="Plan mode"
            hint="Replaces the built-in plan behaviour: agree on a method, change nothing."
            value={prompts.plan}
            onChange={(plan) => update({ plan })}
          />
          <PromptField
            label="Ask mode"
            hint="Replaces the built-in ask behaviour: answer the question, change nothing."
            value={prompts.ask}
            onChange={(ask) => update({ ask })}
          />
          <PromptField
            label="Worker instructions"
            hint="Appended to a delegated worker's brief, on top of its remit."
            value={prompts.worker}
            onChange={(worker) => update({ worker })}
          />
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel>Preview</SectionLabel>
          <p className="text-meta text-muted">The prompt as it is built here: this workspace, no tools.</p>
          <pre className="max-h-[420px] overflow-auto rounded-2xl bg-code-background p-4 font-mono text-meta leading-relaxed text-code-foreground">
            {preview}
          </pre>
        </section>
      </div>
    </SettingsPage>
  );
}
