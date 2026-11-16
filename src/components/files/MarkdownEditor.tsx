/**
 * A Markdown document, edited as a document.
 *
 * Tiptap with the Markdown package: the file is parsed into a document on the way in and
 * serialized back to Markdown on the way out, so headings, lists, tables, task lists and
 * images survive the round trip. The editor is headless, so the styling is the app's own
 * (`.openlab-editor` in `styles.css`) and a rendered document and an edited one read alike.
 *
 * The two menus are the editing surface, because a document editor with no way to make
 * something a heading is a text box: the **bubble** appears on a selection (bold, italic,
 * code, heading, list, quote, link) and the **floating** menu on an empty line (what this
 * line could become). Both are the app's own markup — Tiptap only positions them.
 *
 * Tables, task lists and images are extensions rather than StarterKit's defaults. They are
 * the constructs a research README actually contains, and a document editor that silently
 * drops a table on save is worse than no editor at all.
 */

import { useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table as TableIcon,
} from 'lucide-react';

import { Input, Tip } from '@/components/ui';
import { cn } from '@/lib/cn';

/** One button in a menu. Keeps the selection: a press that moves focus would clear it. */
function MenuButton({
  label,
  active,
  onPress,
  children,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Tip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={Boolean(active)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPress}
        className={cn(
          'grid size-7 place-items-center rounded-lg transition-colors',
          active
            ? 'bg-surface-tertiary text-foreground'
            : 'text-muted hover:bg-surface-secondary hover:text-foreground',
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

/** The island both menus float in. */
const ISLAND =
  'flex items-center gap-0.5 rounded-xl border border-separator bg-overlay p-1 shadow-[var(--island-shadow)]';

/** A divider between groups of buttons. */
function Split() {
  return <span className="mx-0.5 h-4 w-px bg-separator" aria-hidden />;
}

/** The formatting of a selection. */
function SelectionMenu({ editor }: { editor: Editor }) {
  const [linkAt, setLinkAt] = useState<string | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: live }) => ({
      bold: live.isActive('bold'),
      italic: live.isActive('italic'),
      strike: live.isActive('strike'),
      code: live.isActive('code'),
      h1: live.isActive('heading', { level: 1 }),
      h2: live.isActive('heading', { level: 2 }),
      bullet: live.isActive('bulletList'),
      ordered: live.isActive('orderedList'),
      quote: live.isActive('blockquote'),
      link: live.isActive('link'),
    }),
  });

  const chain = () => editor.chain().focus();

  return (
    <BubbleMenu
      editor={editor}
      // A code block has its own text; formatting it would fight the code.
      shouldShow={({ editor: live, from, to }) => from !== to && !live.isActive('codeBlock')}
      className={cn(ISLAND, 'flex-col items-stretch')}
    >
      {linkAt === null ? (
        <div className="flex items-center gap-0.5">
          <MenuButton label="Bold" active={state?.bold} onPress={() => chain().toggleBold().run()}>
            <Bold className="size-3.5" />
          </MenuButton>
          <MenuButton label="Italic" active={state?.italic} onPress={() => chain().toggleItalic().run()}>
            <Italic className="size-3.5" />
          </MenuButton>
          <MenuButton
            label="Strikethrough"
            active={state?.strike}
            onPress={() => chain().toggleStrike().run()}
          >
            <Strikethrough className="size-3.5" />
          </MenuButton>
          <MenuButton label="Code" active={state?.code} onPress={() => chain().toggleCode().run()}>
            <Code className="size-3.5" />
          </MenuButton>
          <Split />
          <MenuButton
            label="Heading 1"
            active={state?.h1}
            onPress={() => chain().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="size-3.5" />
          </MenuButton>
          <MenuButton
            label="Heading 2"
            active={state?.h2}
            onPress={() => chain().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="size-3.5" />
          </MenuButton>
          <Split />
          <MenuButton
            label="Bullet list"
            active={state?.bullet}
            onPress={() => chain().toggleBulletList().run()}
          >
            <List className="size-3.5" />
          </MenuButton>
          <MenuButton
            label="Numbered list"
            active={state?.ordered}
            onPress={() => chain().toggleOrderedList().run()}
          >
            <ListOrdered className="size-3.5" />
          </MenuButton>
          <MenuButton label="Quote" active={state?.quote} onPress={() => chain().toggleBlockquote().run()}>
            <Quote className="size-3.5" />
          </MenuButton>
          <Split />
          <MenuButton
            label={state?.link ? 'Remove link' : 'Link'}
            active={state?.link}
            onPress={() => {
              if (state?.link) {
                chain().unsetLink().run();
                return;
              }
              setLinkAt(String(editor.getAttributes('link').href ?? 'https://'));
            }}
          >
            <Link2 className="size-3.5" />
          </MenuButton>
        </div>
      ) : (
        // A URL needs typing, and a webview has no `prompt` — so the field is in the menu.
        <div className="flex items-center gap-1 p-0.5">
          <Input
            autoFocus
            variant="secondary"
            value={linkAt}
            aria-label="Link address"
            placeholder="https://"
            className="h-7 w-64"
            onChange={(event) => setLinkAt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const href = linkAt.trim();
                if (href) {
                  chain().extendMarkRange('link').setLink({ href }).run();
                }
                setLinkAt(null);
              }
              if (event.key === 'Escape') {
                setLinkAt(null);
              }
            }}
          />
          <MenuButton
            label="Apply link"
            onPress={() => {
              const href = linkAt.trim();
              if (href) {
                chain().extendMarkRange('link').setLink({ href }).run();
              }
              setLinkAt(null);
            }}
          >
            <Link2 className="size-3.5" />
          </MenuButton>
        </div>
      )}
    </BubbleMenu>
  );
}

/** What the empty line under the cursor could become. */
function LineMenu({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();

  return (
    <FloatingMenu
      editor={editor}
      // Under the empty line rather than beside it: at the start of a document there is no
      // room to the left, and the menu would sit over the column beside it.
      options={{ placement: 'bottom-start' }}
      // Only on an empty paragraph: a menu that follows the cursor through prose is noise.
      shouldShow={({ editor: live }) => {
        if (!live.isActive('paragraph')) {
          return false;
        }
        const { $from } = live.state.selection;
        return live.state.selection.empty && $from.parent.content.size === 0;
      }}
      className={ISLAND}
    >
      <MenuButton label="Heading 1" onPress={() => chain().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="size-3.5" />
      </MenuButton>
      <MenuButton label="Heading 2" onPress={() => chain().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="size-3.5" />
      </MenuButton>
      <Split />
      <MenuButton label="Bullet list" onPress={() => chain().toggleBulletList().run()}>
        <List className="size-3.5" />
      </MenuButton>
      <MenuButton label="Numbered list" onPress={() => chain().toggleOrderedList().run()}>
        <ListOrdered className="size-3.5" />
      </MenuButton>
      <MenuButton label="Quote" onPress={() => chain().toggleBlockquote().run()}>
        <Quote className="size-3.5" />
      </MenuButton>
      <MenuButton label="Code block" onPress={() => chain().toggleCodeBlock().run()}>
        <SquareCode className="size-3.5" />
      </MenuButton>
      <Split />
      <MenuButton
        label="Table"
        onPress={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <TableIcon className="size-3.5" />
      </MenuButton>
      <MenuButton label="Image" onPress={() => chain().setImage({ src: '' }).run()}>
        <ImageIcon className="size-3.5" />
      </MenuButton>
      <MenuButton label="Divider" onPress={() => chain().setHorizontalRule().run()}>
        <Minus className="size-3.5" />
      </MenuButton>
    </FloatingMenu>
  );
}

/**
 * A Markdown document, in TipTap: the editor, its two menus, and nothing around it.
 *
 * The file page and a notebook's Markdown cell are the same editing surface at different
 * sizes, so the extensions, the menus and the Markdown round-trip live here once. A cell
 * passes `openlab-editor--cell` to drop the page's own padding, since the cell already has
 * its card around it.
 */
export function RichTextEditor({
  value,
  onChange,
  onSave,
  placeholder,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onSave?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra class on the editable element, e.g. a cell's padding modifier. */
  className?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Table,
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem,
      Image,
      Placeholder.configure({ placeholder: placeholder ?? 'This document is empty. Start writing.' }),
    ],
    content: value,
    contentType: 'markdown',
    autofocus: autoFocus,
    editorProps: {
      attributes: { class: cn('openlab-editor', className), spellcheck: 'true' },
      handleKeyDown: (_view, event) => {
        if (onSave && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          onSave();
          return true;
        }
        return false;
      },
    },
    // A transaction that only moves the cursor is not an edit: Tiptap reports one on mount,
    // and serialising there would mark a file dirty just for being opened.
    onUpdate: ({ editor: live, transaction }) => {
      if (transaction.docChanged) {
        onChange(live.getMarkdown());
      }
    },
  });

  if (!editor) {
    return null;
  }

  return (
    <>
      <SelectionMenu editor={editor} />
      <LineMenu editor={editor} />
      <EditorContent editor={editor} />
    </>
  );
}

/** A Markdown editor over `value`, reporting every edit as Markdown. */
export function MarkdownEditor({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onSave: () => void;
}) {
  return <RichTextEditor value={value} onChange={onChange} onSave={onSave} />;
}
