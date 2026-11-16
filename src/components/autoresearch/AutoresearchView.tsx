/**
 * Autoresearch.
 *
 * A topic is a question, the databases to search for it and the agents assigned to read the
 * answers. Running one happens in the background — the run keeps going when the page is left,
 * and its findings land on the topic. This is the page that adds and starts them.
 */

import { useState } from 'react';
import { Play, Plus, Sparkles, Trash2 } from 'lucide-react';

import { Button, Chip, Dialog, ScrollShadow, SectionLabel, TextArea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { allDatabases } from '@/components/databases/store';
import { allAgents } from '@/components/agents/store';
import { useApp } from '@/store/app';
import { addTopic, removeTopic, useTopics } from './store';
import { startTopic } from '@/lib/autoresearch/runner';
import type { ResearchTopic } from './data';

/** A toggling chip, the vocabulary the review create page uses for a set of choices. */
function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPress}
      className={cn(
        'rounded-full px-3 py-1 text-body transition-colors',
        on ? 'bg-accent text-accent-foreground' : 'bg-surface-secondary text-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

/** The create form: a question, the databases to search and the agents to assign. */
function NewTopicDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const databases = allDatabases();
  const agents = allAgents();
  const [question, setQuestion] = useState('');
  const [databaseIds, setDatabaseIds] = useState<Set<string>>(new Set());
  const [agentIds, setAgentIds] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, value: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  const submit = () => {
    if (!question.trim()) {
      return;
    }
    addTopic({ question, databaseIds: [...databaseIds], agentIds: [...agentIds] });
    setQuestion('');
    setDatabaseIds(new Set());
    setAgentIds(new Set());
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="New research topic"
      description="A question, the databases to search for it, and the agents assigned to read the answers."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!question.trim()} onPress={submit}>
            Add topic
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <SectionLabel>The question</SectionLabel>
        <TextArea
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Does chromatin accessibility improve off-target prediction?"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Databases</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {databases.map((database) => (
            <Choice
              key={database.id}
              label={database.name}
              on={databaseIds.has(database.id)}
              onPress={() =>
                setDatabaseIds((current) => toggle(current, database.id, !current.has(database.id)))
              }
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Agents</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <Choice
              key={agent.id}
              label={agent.name}
              on={agentIds.has(agent.id)}
              onPress={() => setAgentIds((current) => toggle(current, agent.id, !current.has(agent.id)))}
            />
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** One topic: its question, what it searches with, its state and its findings. */
function TopicCard({ topic }: { topic: ResearchTopic }) {
  const { state } = useApp();
  const databaseNames = topic.databaseIds.map((id) => allDatabases().find((d) => d.id === id)?.name ?? id);
  const agentNames = topic.agentIds.map((id) => allAgents().find((a) => a.id === id)?.name ?? id);
  const tone =
    topic.status === 'error'
      ? 'danger'
      : topic.status === 'done'
        ? 'success'
        : topic.status === 'running'
          ? 'accent'
          : 'default';

  return (
    <div className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <p className="min-w-0 flex-1 text-body text-foreground">{topic.question}</p>
        <Chip size="sm" color={tone}>
          {topic.status}
        </Chip>
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          aria-label="Remove topic"
          onPress={() => removeTopic(topic.id)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
        {databaseNames.length > 0 ? (
          <span>{databaseNames.join(' · ')}</span>
        ) : (
          <span>No databases chosen.</span>
        )}
        {agentNames.length > 0 && <span>· {agentNames.join(', ')}</span>}
        {topic.recordCount > 0 && <span>· {topic.recordCount} records read</span>}
      </div>

      {topic.findings && (
        <div className="rounded-2xl bg-surface-secondary p-3">
          <pre className="whitespace-pre-wrap text-body text-foreground">{topic.findings}</pre>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="gap-1.5"
          isDisabled={topic.status === 'running' || topic.databaseIds.length === 0}
          onPress={() => startTopic(state, topic.id)}
        >
          <Play className="size-3.5" />
          {topic.status === 'running' ? 'Running…' : topic.findings ? 'Run again' : 'Run'}
        </Button>
      </div>
    </div>
  );
}

/** The autoresearch page. */
export function AutoresearchView() {
  const topics = useTopics();
  const [creating, setCreating] = useState(false);

  return (
    <ScrollShadow className="h-full min-h-0">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-7 py-7">
        <header className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-title text-foreground">Autoresearch</h1>
            <p className="max-w-[80ch] text-body text-muted">
              Add a question, point it at databases, assign agents, and run. The run writes its findings in
              the background.
            </p>
          </div>
          <Button variant="primary" className="gap-1.5" onPress={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New topic
          </Button>
        </header>

        <div className="flex flex-col gap-3">
          {topics.map((topic) => (
            <TopicCard key={topic.id} topic={topic} />
          ))}
        </div>

        {topics.length === 0 && (
          <p className="text-body text-muted">No topics yet. Add one above and press Run.</p>
        )}
      </div>

      <NewTopicDialog open={creating} onClose={() => setCreating(false)} />
    </ScrollShadow>
  );
}
