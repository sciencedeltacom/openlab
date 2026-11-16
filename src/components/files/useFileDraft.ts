/**
 * A file's text, as a draft.
 *
 * Reading and writing one file is the same operation whatever the editor above it is, so it
 * lives here rather than in each of them: the bytes are read once, the draft is the reader's
 * until they save it, and `dirty` is what says whether the file on disk still matches what is
 * on screen. Saving is explicit — a keystroke must not rewrite somebody's file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { invokeCommand } from '@/lib/ipc';

/** The draft of one file: its text, what it was when read, and how to write it back. */
export interface FileDraft {
  /** The text on screen, or `null` while it is being read. */
  text: string | null;
  /** Why the file could not be read, when it could not. */
  error: string | null;
  /** True when the draft differs from the file on disk. */
  dirty: boolean;
  saving: boolean;
  /** True for a moment after a save, so the reader sees it land. */
  saved: boolean;
  /** A write failure, so a failed save is not silent. */
  saveError: string | null;
  setText: (text: string) => void;
  save: () => Promise<void>;
  /** Read the file again — for a read that failed, or a file changed underneath. */
  reload: () => void;
}

/** Read, edit and write one file inside the workspace. */
export function useFileDraft(path: string, root: string | null): FileDraft {
  const [state, setState] = useState<{ text: string; saved: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    // No path is the case for a file that has no editor: nothing to read, and no error to
    // report about it.
    if (!path) {
      setState(null);
      setError(null);
      return;
    }
    if (!root) {
      setError('No folder is open.');
      setState(null);
      return;
    }
    let live = true;
    setState(null);
    setError(null);
    void invokeCommand<string>('read_file', { path, root }).then((result) => {
      if (!live) {
        return;
      }
      if (result.ok) {
        setState({ text: result.value, saved: result.value });
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      live = false;
    };
  }, [path, root, attempt]);

  const setText = useCallback((text: string) => {
    setState((current) => (current ? { ...current, text } : current));
  }, []);

  const save = useCallback(async () => {
    if (!root || !state || state.text === state.saved) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await invokeCommand('write_file', { path, contents: state.text, root });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error.message);
      return;
    }
    const written = state.text;
    setState({ text: written, saved: written });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }, [path, root, state]);

  return {
    reload: () => setAttempt((current) => current + 1),
    text: state?.text ?? null,
    error,
    dirty: state ? state.text !== state.saved : false,
    saving,
    saved,
    saveError,
    setText,
    save,
  };
}
