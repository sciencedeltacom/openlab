/**
 * A code block, highlighted by CodeMirror.
 *
 * The shape is a card on a card: a grey wrapper holds a header — the language on the left,
 * copy on the right, and Run when it is a shell command — and a white inner card holds the
 * code. CodeMirror is the editor, used read-only; one small theme speaks the app's tokens,
 * and the editor is created once per language, updated in place as text streams, and
 * destroyed on unmount.
 */

import { useEffect, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/legacy-modes/mode/python';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { tags as t } from '@lezer/highlight';
import { Copy, Play } from 'lucide-react';

import { Button, IconButton, Spinner, Tip } from '@/components/ui';
import { useCopy } from '@/hooks/useCopy';
import { invokeCommand } from '@/lib/ipc';
import { executionPayload } from '@/lib/execution';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';

/** Syntax colours pulled from the theme, so a block follows light and dark alike. */
const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: 'var(--syntax-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syntax-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syntax-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syntax-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--syntax-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syntax-property)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--syntax-operator)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--syntax-variable)' },
]);

/** The editor chrome, made to disappear into the card. Shared by the read-only and editable
 * surfaces, so a notebook cell looks the same whether it can be typed in or not. */
const BASE_THEME = {
  '&': { backgroundColor: 'transparent', color: 'var(--foreground)', fontSize: '12px' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--accent) 24%, transparent)',
  },
  '.cm-gutters': { display: 'none' },
};

/** A record: no caret, because nothing can be typed into it. */
const theme = EditorView.theme({
  ...BASE_THEME,
  '.cm-content': { padding: '0', caretColor: 'transparent' },
  '.cm-cursor, .cm-dropCursor': { display: 'none' },
});

/** A field: a caret, because it can. */
const editTheme = EditorView.theme({
  ...BASE_THEME,
  '.cm-content': { padding: '0', caretColor: 'var(--foreground)' },
  '.cm-cursor, .cm-dropCursor': { display: 'block' },
});

/** Human names for the languages we light up. */
const LANGUAGE_LABELS: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  json: 'JSON',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  shell: 'Shell',
  console: 'Shell',
  shellsession: 'Shell',
};

/** Languages whose code is a command you can run. */
const RUNNABLE = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'shellsession']);

/** The languages a lab notebook tends to hold. */
function languageFor(name: string): Extension | null {
  switch (name.toLowerCase()) {
    case 'js':
    case 'javascript':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: true });
    case 'ts':
    case 'typescript':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'json':
      return json();
    case 'python':
    case 'py':
      // A stream mode rather than `@codemirror/lang-python`: that package pins an older
      // `@codemirror/language`, and two copies of the language facet silently disable
      // highlighting in a bundled app.
      return StreamLanguage.define(python);
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
    case 'console':
    case 'shellsession':
      return StreamLanguage.define(shell);
    default:
      return null;
  }
}

/**
 * Read-only highlighted code, with no card around it.
 *
 * The block below is one use of this; a notebook cell is another, where the prompt and the
 * output are the frame and a second header would only repeat the language. The view is
 * created once per language and updated in place, so a streamed or edited document does not
 * rebuild its extensions on every change.
 */
export function CodeReadOnly({
  code,
  language,
  className,
}: {
  code: string;
  language: string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // One view per language: rebuilding it for every `code` change would destroy and recreate
  // the editor on each streamed token.
  useEffect(() => {
    const parent = host.current;
    if (!parent) {
      return;
    }
    const support = languageFor(language);
    const next = new EditorView({
      parent,
      state: EditorState.create({
        doc: code,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          syntaxHighlighting(highlight),
          theme,
          ...(support ? [support] : []),
        ],
      }),
    });
    view.current = next;
    return () => {
      next.destroy();
      if (view.current === next) {
        view.current = null;
      }
    };
    // `code` is applied below; this effect is about the language, not the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Streamed tokens replace the document in place, so the view and its extensions survive.
  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === code) {
      return;
    }
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: code } });
  }, [code]);

  return <div ref={host} className={className} />;
}

/**
 * Editable highlighted code, with no card around it.
 *
 * The same surface as `CodeReadOnly` with a caret and a change listener. The listener is held
 * in a ref so a parent that re-renders on every keystroke does not rebuild the view — which
 * would reset the selection under the reader's fingers.
 */
export function CodeEditable({
  value,
  onChange,
  language,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  language: string;
  className?: string;
  ariaLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  // One view per language; the value is applied below, and an edit flows out through the ref.
  useEffect(() => {
    const parent = host.current;
    if (!parent) {
      return;
    }
    const support = languageFor(language);
    const next = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorView.lineWrapping,
          syntaxHighlighting(highlight),
          editTheme,
          ...(support ? [support] : []),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'Cell source' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latest.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = next;
    return () => {
      next.destroy();
      if (view.current === next) {
        view.current = null;
      }
    };
    // `value` is applied by the effect below; this one is about the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // A change from outside (a reload, the kernel picker rewriting metadata) is applied in
  // place, so the view and its undo history survive.
  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === value) {
      return;
    }
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className={className} />;
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const { state } = useApp();
  const copy = useCopy();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ output: string; exitCode: number } | null>(null);

  const key = language.toLowerCase();
  const runnable = RUNNABLE.has(key);
  const workspacePath = activeProject(state)?.path ?? null;

  const run = async () => {
    if (!workspacePath || busy) {
      return;
    }
    setBusy(true);
    setResult(null);
    const outcome = await invokeCommand<{ output: string; exitCode: number }>('run_command', {
      command: code,
      cwd: null,
      root: workspacePath,
      execution: executionPayload(state.execution),
    });
    setResult(outcome.ok ? outcome.value : { output: outcome.error.message, exitCode: -1 });
    setBusy(false);
  };

  return (
    <div className="my-3 rounded-2xl bg-code-wrapper p-1.5">
      <div className="flex items-center gap-2 px-1.5 pb-1.5">
        <span className="text-meta text-muted">{LANGUAGE_LABELS[key] ?? 'Text'}</span>
        <div className="ml-auto flex items-center gap-1">
          <Tip content="Copy">
            <IconButton aria-label="Copy code" onPress={() => copy(code, 'code')}>
              <Copy className="size-3.5" />
            </IconButton>
          </Tip>
          {runnable && (
            <Tip content="Run in the workspace">
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                isDisabled={busy || !workspacePath}
                onPress={() => void run()}
                aria-label="Run command"
              >
                {busy ? <Spinner /> : <Play className="size-3" />}
                Run
              </Button>
            </Tip>
          )}
        </div>
      </div>

      <div className="code-card rounded-xl bg-code-card p-3">
        <CodeReadOnly code={code} language={language} />
      </div>

      {result && (
        <div className="mt-1.5 rounded-xl bg-black/85 p-2.5">
          {result.output && (
            <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap font-mono text-meta leading-relaxed text-emerald-50/90">
              {result.output}
            </pre>
          )}
          <div
            className={`font-mono text-meta ${result.exitCode === 0 ? 'text-emerald-50/50' : 'text-red-300'}`}
          >
            {result.exitCode}
          </div>
        </div>
      )}
    </div>
  );
}
