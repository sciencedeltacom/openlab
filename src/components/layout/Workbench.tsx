/**
 * The workbench.
 *
 * The transcript fills what is left of the row, the agent column sits on the right, and the
 * session's panels open between them — an island in the row, the way the agent column is, so
 * the session's numbers sit beside the work rather than over it.
 */

import { ChatPane } from '@/components/chat/ChatPane';
import { SessionIsland } from '@/components/chat/SessionIsland';
import { AgentBar } from '@/components/agents/AgentBar';

/** Root layout: the transcript, the session's panel, and the agent column. */
export function Workbench() {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      <ChatPane />
      <SessionIsland />
      <AgentBar />
    </div>
  );
}
