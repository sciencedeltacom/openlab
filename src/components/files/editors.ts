/**
 * Which editor a file opens in.
 *
 * Three answers, and the line between them is data integrity rather than taste. A Markdown
 * document is edited as a document — headings, lists and tables stay what they are, and the
 * file is written back as Markdown. Everything else textual is edited as text, in a code
 * editor, because a rich-text editor would re-serialize it: a `.tex` file's blank lines, a
 * `.csv`'s rows and a `.py`'s indentation are the file, not formatting to be normalised.
 * An image is shown and not edited at all.
 *
 * The sets are here, in one place, because a wrong answer silently rewrites somebody's file.
 */

/** What opens a file. */
export type EditorKind = 'prose' | 'code' | 'notebook' | 'image' | 'other';

/** The extension of a name, lowercased, without the dot. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Formats a browser draws rather than edits. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);

/** Documents: prose with structure, and the only formats a rich-text editor writes back. */
const PROSE_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

/** Everything else a code editor can hold, which is any text file. */
const CODE_EXTENSIONS = new Set([
  'txt',
  'text',
  'rst',
  'org',
  'tex',
  'bib',
  'log',
  'csv',
  'tsv',
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'properties',
  'env',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'r',
  'jl',
  'm',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'php',
  'swift',
  'sql',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'dockerfile',
  'makefile',
  'gitignore',
]);

/**
 * The editor a file opens in, by its name.
 *
 * A notebook is absent from the code list on purpose: it is a document with cells, outputs
 * and a kernel, and the code editor would show it as JSON — every cell's prose and every
 * figure behind a base64 string. It opens in the notebook editor, where the cells are the
 * thing being edited and the outputs stay as they were.
 */
export function editorFor(name: string): EditorKind {
  const extension = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  if (PROSE_EXTENSIONS.has(extension)) {
    return 'prose';
  }
  if (extension === 'ipynb') {
    return 'notebook';
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return 'code';
  }
  return 'other';
}
