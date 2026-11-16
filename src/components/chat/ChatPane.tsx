/**
 * The centre column: transcript, composer.
 *
 * Only the transcript scrolls, so the composer never moves while a long answer streams
 * in. The column has a minimum width: below it the changes panel hides itself rather
 * than squeezing the transcript into a gutter. The session's own controls — context, stats,
 * settings — live in the right column, under the agents, rather than on a line above the
 * composer.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';

import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { PermissionPrompt } from './PermissionPrompt';
import { SessionPlanPanel } from './SessionPlanPanel';
import { SubagentsPanel } from './SubagentsPanel';
import { Button, ScrollShadow } from '@/components/ui';
import { paths } from '@/app/routes';
import { useApp, usePageTitle } from '@/store/app';
import { activeSession } from '@/store/types';

/** Chat column. */
export function ChatPane() {
  const { state, dispatch } = useApp();
  const session = activeSession(state);
  // The session's name is the tab's or the column's to say; the transcript carries no title.
  usePageTitle(session?.title);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The session the transcript was last positioned for. */
  const opened = useRef<string | null>(null);

  /*
   * A transcript is read from its end. Opening a session should land on the newest message,
   * not on the first one — the follow effect below only keeps a reader who is already at the
   * bottom, which on open is nobody. The jump is before paint, with two more tries for content
   * that measures itself a frame later (code blocks, images, a streaming first answer).
   */
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const id = session?.id ?? null;
    if (!element || opened.current === id) {
      return;
    }
    opened.current = id;
    const jump = () => {
      element.scrollTop = element.scrollHeight;
    };
    jump();
    const frame = requestAnimationFrame(jump);
    const timer = window.setTimeout(jump, 120);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [session?.id]);

  /**
   * Whether the view is pinned to the end.
   *
   * Only the reader's own scrolling unpins it: an answer that arrives in one large chunk, or a
   * turn that is long enough to add a screen at once, must not leave the newest text below the
   * fold. Sending a message pins it again.
   */
  const pinned = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      pinned.current = distance < 80;
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const last = state.messages[state.messages.length - 1];
    // What the reader just sent is theirs to see: a send is always a decision to follow.
    if (last?.role === 'user') {
      pinned.current = true;
    }
    if (!pinned.current) {
      return;
    }
    element.scrollTo({ top: element.scrollHeight, behavior: state.running ? 'auto' : 'smooth' });
  }, [state.messages, state.running]);

  return (
    <main className="flex h-full min-w-[320px] flex-1 flex-col overflow-hidden bg-background">
      {/* The transcript, with the same edge fade as every other scrolling surface. */}
      <ScrollShadow ref={scrollRef} className="min-h-0 flex-1">
        <MessageList messages={state.messages} running={state.running} />
      </ScrollShadow>

      {session?.parentId ? (
        // A worker's session is a record of the work, not a place to hold a conversation: what
        // it produced is already with the lead that asked for it.
        <div className="mx-auto flex w-full max-w-[820px] flex-wrap items-center gap-2 px-6 pb-4">
          <p className="min-w-0 flex-1 text-meta text-muted">
            This session ran as a subagent. The conversation continues in the session that delegated it.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => dispatch({ type: 'route/go', route: paths.session(session.parentId!) })}
          >
            Open the lead
          </Button>
        </div>
      ) : (
        // The plan and the subagents are chrome over the conversation, not rows in it: they
        // float above the composer so opening one never takes a line of transcript away.
        <div className="relative">
          <PermissionPrompt />
          <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 flex flex-col">
            <div className="pointer-events-auto">
              <SessionPlanPanel />
            </div>
            {session && (
              <div className="pointer-events-auto">
                <SubagentsPanel key={session.id} sessionId={session.id} />
              </div>
            )}
          </div>
          <Composer />
        </div>
      )}
    </main>
  );
}
