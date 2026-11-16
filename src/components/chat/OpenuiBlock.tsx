/**
 * An interactive interface the model produced, drawn live.
 *
 * The model writes an OpenUI Lang program inside a ```openui-lang fence; the markdown reader
 * hands the program here instead of printing it. `<Renderer />` parses it against the same
 * library the prompt was built from and draws each component as its line arrives, so the
 * interface grows while the turn is still streaming.
 *
 * A program that never resolves to a root — the model hallucinated a component, or the fence
 * was cut off — falls back to showing its source, because a blank space where an answer
 * should be is the one failure a reader cannot see.
 *
 * Drawing a generated interface is the heaviest thing in a turn, so it is kept off the
 * critical path: the program is deferred while the model is still writing (React settles the
 * markdown first and redraws the interface on its own schedule), the block is memoised, and it
 * reads the store's actions rather than its state so typing does not redraw every interface
 * on the page.
 */

import { memo, useDeferredValue, useRef, useState } from 'react';
import { BuiltinActionType, Renderer, type ActionEvent, type ParseResult } from '@openuidev/react-lang';

import { openuiLibrary } from '@/lib/openui';
import { useAppActions } from '@/store/app';
import { CodeBlock } from './CodeBlock';

export interface OpenuiBlockProps {
  /** The OpenUI Lang program, fence content only. */
  code: string;
  /** True while the turn is still writing, so form controls stay disabled. */
  isStreaming?: boolean;
}

function OpenuiBlockView({ code, isStreaming = false }: OpenuiBlockProps) {
  const { send } = useAppActions();
  // `null` until the parser has run; then whether it produced anything drawable. Held in a
  // ref as well, so a repeated parse result does not re-render the interface.
  const [drawable, setDrawable] = useState<boolean | null>(null);
  const drawableRef = useRef<boolean | null>(null);
  const response = useDeferredValue(code);

  /**
   * A click inside the interface becomes the next user turn. The form's values travel with
   * the label so the model sees what the user actually chose, not just that they clicked.
   */
  const onAction = (event: ActionEvent) => {
    if (event.type === BuiltinActionType.ContinueConversation) {
      const lines = [event.humanFriendlyMessage];
      if (event.formState && Object.keys(event.formState).length > 0) {
        lines.push(`Values: ${JSON.stringify(event.formState)}`);
      }
      void send(lines.join('\n'));
      return;
    }
    if (event.type === BuiltinActionType.OpenUrl) {
      const url = event.params?.url;
      if (typeof url === 'string') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  // Settled with nothing to draw: show the source rather than an empty card.
  if (!isStreaming && drawable === false) {
    return <CodeBlock code={code} language="openui-lang" />;
  }

  return (
    // OpenUI has its own tokens; `openlab-openui` (see theme/openui.css) points them at the
    // app's, so the generated interface reads as part of the workbench in both themes.
    <div className="openlab-openui my-3 rounded-2xl bg-surface p-3">
      <Renderer
        response={response}
        library={openuiLibrary}
        isStreaming={isStreaming}
        onAction={onAction}
        onParseResult={(result: ParseResult | null) => {
          const next = Boolean(result?.root);
          if (drawableRef.current !== next) {
            drawableRef.current = next;
            setDrawable(next);
          }
        }}
        publishObservability={false}
      />
    </div>
  );
}

export const OpenuiBlock = memo(OpenuiBlockView);
