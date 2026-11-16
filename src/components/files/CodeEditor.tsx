/**
 * A text or code file, edited as text.
 *
 * CodeMirror, with the highlighting the app already ships: JavaScript and JSON through their
 * stream modes, Python and shell likewise, and no highlighting at all for the rest — a wrong
 * grammar colours a file into nonsense, and plain text is honest.
 *
 * Completion is the language's keywords, builtins and types (`completions.ts`) beside
 * CodeMirror's completion from the document itself, plus bracket and quote closing. That is
 * what a plain editor can offer without a language server behind it: it completes the names
 * the language and the file already use, not the members of a library it cannot see.
 *
 * The editor is rebuilt when the file changes rather than patched: a different file is a
 * different document, and reusing the view would carry the old one's undo history with it.
 */

import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from '@codemirror/view';
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { tags } from '@lezer/highlight';
import { c, cpp, csharp, java, kotlin, objectiveC } from '@codemirror/legacy-modes/mode/clike';
import { javascript } from '@codemirror/legacy-modes/mode/javascript';
import { octave } from '@codemirror/legacy-modes/mode/octave';
import { python } from '@codemirror/legacy-modes/mode/python';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';

import { completionFor } from './completions';
import { extensionOf } from './editors';

/**
 * The grammars, by extension.
 *
 * Stream modes throughout, from `@codemirror/legacy-modes`, and deliberately not the
 * `@codemirror/lang-*` packages: those pin their own copy of `@codemirror/language`, and two
 * copies of the language facet silently disable highlighting in a bundled app. The transcript's
 * code blocks made the same choice for the same reason.
 */
const GRAMMARS: Record<string, { label: string; mode: Parameters<typeof StreamLanguage.define>[0] }> = {
  js: { label: 'JavaScript', mode: javascript },
  jsx: { label: 'JavaScript', mode: javascript },
  mjs: { label: 'JavaScript', mode: javascript },
  cjs: { label: 'JavaScript', mode: javascript },
  ts: { label: 'JavaScript', mode: javascript },
  tsx: { label: 'JavaScript', mode: javascript },
  json: { label: 'JSON', mode: javascript },
  jsonc: { label: 'JSON', mode: javascript },
  json5: { label: 'JSON', mode: javascript },
  py: { label: 'Python', mode: python },
  sh: { label: 'Shell', mode: shell },
  bash: { label: 'Shell', mode: shell },
  zsh: { label: 'Shell', mode: shell },
  rs: { label: 'Rust', mode: rust },
  sql: { label: 'SQL', mode: standardSQL },
  toml: { label: 'TOML', mode: toml },
  yaml: { label: 'YAML', mode: yaml },
  yml: { label: 'YAML', mode: yaml },
  c: { label: 'C', mode: c },
  h: { label: 'C', mode: c },
  cc: { label: 'C++', mode: cpp },
  cpp: { label: 'C++', mode: cpp },
  hpp: { label: 'C++', mode: cpp },
  cs: { label: 'C#', mode: csharp },
  java: { label: 'Java', mode: java },
  kt: { label: 'Kotlin', mode: kotlin },
  // `.m` is both MATLAB and Objective-C; a research workbench meets MATLAB, so that is the
  // reading it gets, and the completions agree with it.
  m: { label: 'MATLAB', mode: octave },
  mm: { label: 'Objective-C', mode: objectiveC },
};

/** The grammar for a name, when there is one. */
function languageFor(name: string) {
  const grammar = GRAMMARS[extensionOf(name)];
  return grammar ? StreamLanguage.define(grammar.mode) : [];
}

/** The app's tokens, as a CodeMirror theme. */
const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--foreground)', fontSize: '0.8125rem' },
  '.cm-content': {
    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
    padding: '0.75rem 0 0.75rem 0.5rem',
  },
  '.cm-scroller': { lineHeight: '1.6' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  // The gutter is the app's, not CodeMirror's: no fill and no rule of its own — the numbers
  // are a margin, not a column — and just enough room to read them.
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--muted)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.25rem 0 0.5rem', minWidth: '1.75rem' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklch, var(--surface-secondary) 70%, transparent)',
  },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--muted)', padding: '0 0.125rem' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--accent) 22%, transparent)',
    outline: 'none',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--accent) 25%, transparent)',
  },
  '&.cm-focused': { outline: 'none' },
  // The completion list is the app's own surface, not the browser's default white box.
  '.cm-tooltip': {
    border: '1px solid var(--separator)',
    borderRadius: '0.75rem',
    backgroundColor: 'var(--overlay)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '14rem' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--surface-secondary)',
    color: 'var(--foreground)',
  },
  '.cm-completionIcon': { color: 'var(--muted)' },
});

/** The palette the app uses for code, so a file reads the same here as in the transcript. */
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--accent-secondary)' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--accent-secondary)' },
  { tag: tags.heading, color: 'var(--foreground)', fontWeight: '600' },
]);

/** A text editor over `value`, reporting every edit. */
export function CodeEditor({
  value,
  name,
  onChange,
  onSave,
}: {
  value: string;
  name: string;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The handlers are read through refs so a re-render never rebuilds the editor (and with it
  // the reader's cursor and undo history).
  const changeRef = useRef(onChange);
  const saveRef = useRef(onSave);
  changeRef.current = onChange;
  saveRef.current = onSave;

  useEffect(() => {
    const parent = host.current;
    if (!parent) {
      return;
    }
    let view: EditorView;
    try {
      view = new EditorView({
        parent,
        state: EditorState.create({
          doc: value,
          extensions: [
            history(),
            keymap.of([
              {
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  saveRef.current();
                  return true;
                },
              },
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...historyKeymap,
              ...completionKeymap,
              ...foldKeymap,
              indentWithTab,
            ]),
            // The furniture of a code editor: numbered lines, the current one lit, a real
            // selection layer, matching brackets and foldable blocks. Without them a code file
            // reads as a text box, which is what it looked like.
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            drawSelection(),
            dropCursor(),
            rectangularSelection(),
            crosshairCursor(),
            bracketMatching(),
            codeFolding(),
            foldGutter(),
            indentOnInput(),
            closeBrackets(),
            // Both sources feed one list: the language's own words, then CodeMirror's from the
            // document itself — so a name already typed ranks beside a keyword. Sources are
            // declared here rather than as loose extensions because that is the typed way in.
            autocompletion({ override: [...completionFor(name), completeAnyWord] }),
            EditorView.lineWrapping,
            // An empty file with no caret line reads as "nothing opened"; this says otherwise.
            placeholder('This file is empty. Start typing.'),
            theme,
            syntaxHighlighting(highlight),
            languageFor(name),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                changeRef.current(update.state.doc.toString());
              }
            }),
          ],
        }),
      });
      setError(null);
    } catch (cause) {
      // A failure here used to leave an empty box on the page, which reads as "nothing
      // opened" rather than as a failure. Say which it is.
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    return () => view.destroy();
    // A different file is a different document; the value it starts from is the one just read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return (
    <>
      {error && (
        <p className="border-b border-separator px-4 py-2 text-body text-danger">
          The editor could not start: {error}
        </p>
      )}
      <div ref={host} className="openlab-code" />
    </>
  );
}
