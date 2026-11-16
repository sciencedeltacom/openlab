/**
 * A file's page.
 *
 * The page **is** the editor: no title row, no toolbar — the tab already names the file and
 * carries the file's own actions (open it elsewhere, rename it), so a header here would cost
 * a row of the document to say the same thing twice. The editor fills the page with a hair
 * of margin and a rounded surface, and the one line under it says which editor opened and
 * whether there is anything to save.
 *
 * The editor is chosen by what the file is — a document in a document editor, text in a code
 * editor, an image shown and not edited (`editors.ts` holds that decision and its reasons).
 * Saving is explicit: Cmd+S, or the button that appears while there is something to save.
 */

import { Save } from 'lucide-react';

import { Button, ScrollShadow, Spinner } from '@/components/ui';
import { useApp, usePageTitle } from '@/store/app';
import { activeProject } from '@/store/types';
import { CodeEditor } from './CodeEditor';
import { FileView } from './FileView';
import { MarkdownEditor } from './MarkdownEditor';
import { NotebookEditor } from './NotebookView';
import { fileNameOf } from './data';
import { editorFor } from './editors';
import { useFileDraft } from './useFileDraft';

/** One file, in full. */
export function FilePreview({ path }: { path: string }) {
  const { state } = useApp();
  const root = activeProject(state)?.path ?? null;
  const name = fileNameOf(path);
  const kind = editorFor(name);
  const editable = kind === 'prose' || kind === 'code' || kind === 'notebook';
  const draft = useFileDraft(editable ? path : '', root);
  usePageTitle(name);

  return (
    // The page is the document: no title row, no status line, a hair of margin and a rounded
    // surface — the tab carries the file's name and its actions.
    <div className="relative flex h-full min-h-0 w-full flex-col p-1">
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-surface">
        {editable ? (
          <ScrollShadow className="h-full">
            {kind === 'prose' && draft.text !== null && (
              <MarkdownEditor
                key={path}
                value={draft.text}
                onChange={draft.setText}
                onSave={() => void draft.save()}
              />
            )}
            {kind === 'code' && draft.text !== null && (
              <CodeEditor
                key={path}
                value={draft.text}
                name={name}
                onChange={draft.setText}
                onSave={() => void draft.save()}
              />
            )}
            {kind === 'notebook' && draft.text !== null && (
              <NotebookEditor
                key={path}
                path={path}
                value={draft.text}
                dirty={draft.dirty}
                onChange={draft.setText}
                onSave={() => draft.save()}
                onRan={draft.reload}
              />
            )}
            {draft.text === null && (
              <div className="grid h-full place-items-center gap-2">
                {draft.error ? (
                  <>
                    <p className="text-body text-muted">{draft.error}</p>
                    <Button variant="secondary" size="sm" onPress={draft.reload}>
                      Read it again
                    </Button>
                  </>
                ) : (
                  <Spinner />
                )}
              </div>
            )}
          </ScrollShadow>
        ) : (
          // An image is drawn, an archive is listed, anything else says so — none of them is
          // edited, so none of them gets an editor.
          <ScrollShadow className="h-full">
            <FileView path={path} name={name} root={root} />
          </ScrollShadow>
        )}
      </div>

      {/* One line, under the document: which editor opened, how big the file is, and how to
          save it. A blank page should never be the whole answer. */}
      {editable && draft.dirty && (
        // No status line on this page: the document is the page. A save that is only reachable
        // by a shortcut is a save nobody finds, so the button floats over the document while
        // there is something to save and leaves when there is not.
        <div className="pointer-events-none absolute bottom-4 end-4 flex items-center gap-2">
          {draft.saveError && (
            <span className="rounded-lg bg-surface px-2 py-1 text-meta text-danger">
              Not saved: {draft.saveError}
            </span>
          )}
          <Button
            variant="primary"
            isDisabled={draft.saving}
            onPress={() => void draft.save()}
            className="pointer-events-auto gap-1.5"
          >
            <Save className="size-3.5" />
            {draft.saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}
