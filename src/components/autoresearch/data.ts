/**
 * The research topics the workbench runs on its own.
 *
 * A topic is a question, the databases to search for it, and the agents assigned to read the
 * answers. Running one retrieves records from the databases, asks the assigned agent's model to
 * write findings from them, and keeps the findings on the topic — a small, checkable record of
 * what was looked at and what it said.
 */

/** One topic and what came of it. */
export interface ResearchTopic {
  id: string;
  question: string;
  /** Catalogue database ids to search. */
  databaseIds: string[];
  /** Agent ids assigned to the topic. */
  agentIds: string[];
  status: 'idle' | 'running' | 'done' | 'error';
  /** The findings the model wrote, or the reason a run failed. */
  findings: string;
  /** How many records the last run read. */
  recordCount: number;
  updatedAt: number;
}

/** A new topic from the fields the create form collects. */
export function newTopic(input: {
  question: string;
  databaseIds?: string[];
  agentIds?: string[];
}): ResearchTopic {
  return {
    id: `topic-${crypto.randomUUID().slice(0, 8)}`,
    question: input.question.trim(),
    databaseIds: input.databaseIds ?? [],
    agentIds: input.agentIds ?? [],
    status: 'idle',
    findings: '',
    recordCount: 0,
    updatedAt: Date.now(),
  };
}
