/**
 * Commands.
 *
 * The slash menu's settings: what ships, what this project keeps in `.openlab/commands/`, and
 * what was written here. A command is a body with `$1` placeholders and the tools it may use —
 * the same file the composer expands, which is why creating one here changes what typing `/`
 * offers.
 */

import { useCallback, useEffect, useState } from 'react';
import { FileCode2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

import {
  Button,
  Chip,
  Dialog,
  IconButton,
  Input,
  ScrollShadow,
  SectionLabel,
  Select,
  Table,
  TextArea,
} from '@/components/ui';
import { SettingsPage } from '@/components/screens/archetypes';
import { MENTION_KINDS } from '@/lib/chat/references';
import { notify } from '@/lib/toast';
import { activeProject } from '@/store/types';
import { useApp } from '@/store/app';
import {
  COMMAND_DIR,
  allCommands,
  clearCommands,
  expandCommand,
  loadProjectCommands,
  removeCommand,
  saveCommand,
  setMissingBehaviour,
  useCommands,
  useMissingBehaviour,
  type MissingBehaviour,
  type SlashCommand,
} from '@/lib/commands/commands';

/** The frontmatter a project command file carries, as the page shows it. */
const FILE_EXAMPLE = `---
description: Prepare a structure for docking
argument-hint: <pdb-id> [ph]
allowed-tools: fetch_url, run_command, write_file
---
Download $1 from RCSB, strip crystallographic waters, set protonation at pH \${2:-7.4},
and write the prepared structure to prepared/$1.pdb. Log every decision, including
waters that were kept, in prepared/$1.log.`;

/** A labelled field. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-foreground">{label}</span>
      {children}
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </label>
  );
}

/** Create or edit one command. */
function CommandDialog({
  open,
  command,
  onClose,
}: {
  open: boolean;
  /** The command being edited, or null for a new one. */
  command: SlashCommand | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hint, setHint] = useState('');
  const [tools, setTools] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(command?.name ?? '');
    setDescription(command?.description ?? '');
    setHint(command?.argumentHint ?? '');
    setTools((command?.allowedTools ?? []).join(', '));
    setBody(command?.body ?? '');
  }, [open, command]);

  const canSave = name.trim().length > 0 && body.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={command ? `Edit /${command.name}` : 'New command'}
      description="The body is the prompt. $1 is the first argument, ${2:-7.4} supplies a default."
      width={640}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isDisabled={!canSave}
            onPress={() => {
              const saved = saveCommand({
                id: command?.id,
                name,
                description,
                argumentHint: hint,
                allowedTools: tools
                  .split(',')
                  .map((tool) => tool.trim())
                  .filter(Boolean),
                body,
              });
              notify(command ? `Updated /${saved.name}` : `Created /${saved.name}`, { tone: 'success' });
              onClose();
            }}
          >
            {command ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" hint="Typed after the slash.">
            <Input
              fullWidth
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="prep"
              aria-label="Name"
            />
          </Field>
          <Field label="Arguments" hint="Shown beside the name in the menu.">
            <Input
              fullWidth
              value={hint}
              onChange={(event) => setHint(event.target.value)}
              placeholder="<pdb-id> [ph]"
              aria-label="Arguments"
            />
          </Field>
        </div>
        <Field label="What it does">
          <Input
            fullWidth
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Prepare a structure for docking"
            aria-label="Description"
          />
        </Field>
        <Field label="Allowed tools" hint="Comma separated. Empty means the session's own tools.">
          <Input
            fullWidth
            value={tools}
            onChange={(event) => setTools(event.target.value)}
            placeholder="fetch_url, run_command"
            aria-label="Allowed tools"
          />
        </Field>
        <Field label="Body" hint="What the agent is asked to do, with its placeholders.">
          <TextArea
            fullWidth
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="font-mono text-meta"
            aria-label="Body"
          />
        </Field>
      </div>
    </Dialog>
  );
}

export function CommandsScreen() {
  const { state } = useApp();
  const commands = useCommands();
  const behaviour = useMissingBehaviour();
  const [editing, setEditing] = useState<SlashCommand | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const project = activeProject(state);
  const every = allCommands();
  const builtins = every.filter((command) => command.source === 'builtin');
  const own = every.filter((command) => command.source !== 'builtin');

  const reload = useCallback(async () => {
    if (!project) return;
    setBusy(true);
    const report = await loadProjectCommands(project.path);
    setBusy(false);
    notify(
      report.errors.length > 0
        ? `${report.errors.length} command file${report.errors.length === 1 ? '' : 's'} did not load`
        : report.loaded === 0
          ? `No commands in ${COMMAND_DIR}/`
          : `Loaded ${report.loaded} project command${report.loaded === 1 ? '' : 's'}`,
      { tone: report.errors.length > 0 ? 'warning' : 'success' },
    );
  }, [project]);

  // A project's commands are read once, when the page is opened.
  useEffect(() => {
    if (!project) return;
    void loadProjectCommands(project.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.path]);

  return (
    <SettingsPage>
      <div className="flex w-full flex-col gap-8">
        <p className="text-body text-muted">
          A named entry point into a procedure. Type <span className="font-mono">/</span> in a session to see
          this list.
        </p>

        <p className="text-body text-muted">
          Type <span className="font-mono">@</span> to name one of the workbench's own records:{' '}
          <span className="font-mono">{MENTION_KINDS.map((meta) => `@${meta.label}:`).join(', ')}</span>. The
          agent is told which record you meant.
        </p>

        <section className="flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <SectionLabel>Built-in</SectionLabel>
            <span className="text-meta tabular-nums text-muted">{builtins.length}</span>
          </header>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Built-in commands">
                <Table.Header>
                  <Table.Column isRowHeader>Command</Table.Column>
                  <Table.Column>What it does</Table.Column>
                  <Table.Column className="text-end">Arguments</Table.Column>
                </Table.Header>
                <Table.Body>
                  {builtins.map((command) => (
                    <Table.Row key={command.id} id={command.id}>
                      <Table.Cell>
                        <span className="font-mono text-foreground">/{command.name}</span>
                      </Table.Cell>
                      <Table.Cell>{command.description}</Table.Cell>
                      <Table.Cell className="text-end font-mono text-meta text-muted">
                        {command.argumentHint ?? '—'}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </section>

        <section className="flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <SectionLabel>Your commands</SectionLabel>
            <span className="text-meta tabular-nums text-muted">{own.length}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                isDisabled={!project || busy}
                onPress={() => void reload()}
              >
                <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} />
                Reload {COMMAND_DIR}
              </Button>
              <Button size="sm" variant="secondary" className="gap-1.5" onPress={() => setCreating(true)}>
                <Plus className="size-3.5" />
                New command
              </Button>
            </div>
          </header>

          {own.length === 0 ? (
            <p className="rounded-2xl bg-surface p-6 text-center text-body text-muted">
              Nothing yet. Write one here, or put a markdown file in{' '}
              <span className="font-mono">{COMMAND_DIR}/</span> and reload.
            </p>
          ) : (
            <ScrollShadow className="max-h-[420px]">
              <div className="flex flex-col gap-2 pr-0.5">
                {own.map((command) => (
                  <div key={command.id} className="flex items-start gap-2 rounded-2xl bg-surface p-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-body text-foreground">/{command.name}</span>
                        {command.argumentHint && (
                          <span className="font-mono text-meta text-muted">{command.argumentHint}</span>
                        )}
                        <Chip size="sm" variant="soft" color="default">
                          {command.source}
                        </Chip>
                      </span>
                      <span className="mt-0.5 block text-meta text-muted">
                        {command.description || 'No description.'}
                      </span>
                      <span className="mt-1 block whitespace-pre-wrap font-mono text-[11px] text-muted">
                        {expandCommand(command, ['…'], 'literal').prompt}
                      </span>
                    </span>
                    <IconButton aria-label={`Edit /${command.name}`} onPress={() => setEditing(command)}>
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton
                      aria-label={`Remove /${command.name}`}
                      onPress={() => {
                        removeCommand(command.id);
                        notify(`Removed /${command.name}`);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                ))}
              </div>
            </ScrollShadow>
          )}

          {!project && (
            <p className="text-meta text-muted">Open a workspace to read the commands it keeps.</p>
          )}

          {own.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 self-start"
              onPress={() => {
                clearCommands();
                notify('Removed every command written here');
              }}
            >
              <Trash2 className="size-3.5" />
              Clear the ones written here
            </Button>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>When an argument is missing</SectionLabel>
          <Select
            label="Missing arguments"
            value={behaviour}
            options={[
              { value: 'ask', label: 'Ask for the missing value' },
              { value: 'literal', label: 'Send the placeholder literally' },
              { value: 'fail', label: 'Fail the command' },
            ]}
            onChange={(value) => setMissingBehaviour(value as MissingBehaviour)}
          />
          <p className="text-meta text-muted">
            A placeholder with a default, <span className="font-mono">{'${2:-7.4}'}</span>, is never missing.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>The file</SectionLabel>
          <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
            <p className="text-body text-muted">
              <FileCode2 className="me-1.5 inline size-3.5 align-text-bottom" />A markdown file in{' '}
              <span className="font-mono">{COMMAND_DIR}/</span>: the file name is the command, the frontmatter
              describes it, the body is the prompt.
            </p>
            <pre className="overflow-auto rounded-xl bg-surface-secondary p-3 font-mono text-[11px] leading-relaxed text-muted">
              {FILE_EXAMPLE}
            </pre>
          </div>
        </section>
      </div>

      <CommandDialog open={creating} command={null} onClose={() => setCreating(false)} />
      <CommandDialog open={editing !== null} command={editing} onClose={() => setEditing(null)} />
    </SettingsPage>
  );
}
