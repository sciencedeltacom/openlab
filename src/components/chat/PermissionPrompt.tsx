/**
 * The confirmation a guarded call waits on.
 *
 * It sits directly above the composer rather than in a modal: the question belongs with the
 * input the answer unblocks, and a turn should never hide the conversation it is running in.
 */

import { AnimatePresence, motion } from 'motion/react';
import { Check, ShieldAlert } from 'lucide-react';

import { Button, Tip } from '@/components/ui';
import { useApp } from '@/store/app';
import { MOTION } from '@/theme/tokens';
import { toolPresentation } from './tools';

export function PermissionPrompt() {
  const { state, answerPermission } = useApp();
  const request = state.permission;
  const presentation = request ? toolPresentation(request.tool.id) : null;
  // The one line that says what the call will do: the argument it was given, or the tool's
  // own summary when it carried none — never the bare id twice.
  const detail =
    request && request.detail && request.detail !== request.tool.name
      ? request.detail
      : (request?.tool.summary ?? '');

  return (
    <div className="px-6">
      <div className="mx-auto w-full max-w-[760px]">
        <AnimatePresence>
          {request && presentation && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
              className="mb-2 flex items-center gap-2.5 rounded-2xl border border-warning/30 bg-surface px-3 py-1.5"
            >
              <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
              <span className="shrink-0 text-body text-foreground">{presentation.name}</span>
              {/* The row is one line, so the call's own argument is cut to fit. Hovering it
                  shows the whole thing: a command nobody can read is a command nobody can
                  approve. */}
              <Tip
                placement="top"
                content={
                  <span className="block max-w-[420px] whitespace-pre-wrap break-all font-mono text-meta">
                    {detail}
                  </span>
                }
              >
                <span
                  tabIndex={0}
                  className="min-w-0 flex-1 cursor-help truncate text-meta text-muted"
                  aria-label={detail}
                >
                  {detail}
                </span>
              </Tip>
              <Button size="sm" variant="ghost" onPress={() => answerPermission(request, false)}>
                Deny
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="gap-1.5 bg-warning! text-warning-foreground!"
                onPress={() => answerPermission(request, true)}
              >
                <Check className="size-3.5" aria-hidden />
                Allow
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
