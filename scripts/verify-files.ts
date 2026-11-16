/**
 * Checks which editor a file opens in.
 *
 * Run with: `bun scripts/verify-files.ts`
 *
 * This is a small decision with a large consequence: the editor chosen for a Markdown file
 * writes the file back, so a format routed to the wrong editor is a format that gets
 * re-serialized — a `.tex` file's blank lines, a `.csv`'s rows. The rule is pinned here so it
 * cannot drift into "everything textual is a document".
 */

import { editorFor, extensionOf } from '../src/components/files/editors';
import { completionFor } from '../src/components/files/completions';
import { fileNameOf, kindOfName } from '../src/components/files/data';
import type { CompletionContext } from '@codemirror/autocomplete';

/** A completion request, the way CodeMirror would make one after typing `impo`. */
const request = {
  matchBefore: () => ({ from: 0, to: 4, text: 'impo' }),
  explicit: false,
} as unknown as CompletionContext;

/** The words a language offers, or an empty list when it offers none. */
function labelsFor(name: string): string[] {
  const sources = completionFor(name);
  if (sources.length === 0) {
    return [];
  }
  const result = sources[0]!(request) as { options?: { label: string }[] } | null;
  return (result?.options ?? []).map((option) => option.label);
}

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
}

console.log('\n— extensions —');
{
  check('the extension is lowercased', extensionOf('Notes.MD'), 'md');
  check('a dotless name has none', extensionOf('Makefile'), '');
  check('a leading dot is not an extension', extensionOf('.gitignore'), '');
  check('the last dot wins', extensionOf('figure.v2.svg'), 'svg');
}

console.log('\n— what a PDF is —');
{
  // A paper is not a picture: it has its own kind, its own mark and its own viewer.
  check('a pdf is its own kind', kindOfName('paper.pdf'), 'pdf');
  check('and not a figure', kindOfName('paper.pdf') === 'figure', false);
  check('a png is still a figure', kindOfName('plot.png'), 'figure');
  check('a pdf is not edited as text', editorFor('paper.pdf'), 'other');
}

console.log('\n— which editor opens —');
{
  check('a markdown document is a document', editorFor('README.md'), 'prose');
  check('and so is mdx', editorFor('page.mdx'), 'prose');

  // Everything else textual is text: a document editor would rewrite its shape.
  check('python is code', editorFor('baseline.py'), 'code');
  check('latex is code, not prose', editorFor('paper.tex'), 'code');
  check('a bibliography is code', editorFor('refs.bib'), 'code');
  check('plain text is code', editorFor('notes.txt'), 'code');
  // A notebook is a document with cells and outputs: the code editor would show it as JSON,
  // with every figure behind a base64 string. It opens in the notebook editor instead.
  check('a notebook opens in its own editor', editorFor('analysis.ipynb'), 'notebook');
  check('data is code', editorFor('cohorts.csv'), 'code');
  check('yaml is code', editorFor('config.yaml'), 'code');

  check('an image is shown, not edited', editorFor('figure.png'), 'image');
  check('an svg too', editorFor('diagram.svg'), 'image');
  check('and a jpeg', editorFor('gel.jpeg'), 'image');

  check('a binary with no editor is neither', editorFor('model.h5'), 'other');
  check('an archive is neither', editorFor('data.zip'), 'other');
  check('an unknown extension is neither', editorFor('thing.xyz'), 'other');
}

console.log('\n— what each language offers —');
{
  check('python offers its keywords', labelsFor('baseline.py').includes('import'), true);
  check('and its builtins', labelsFor('baseline.py').includes('enumerate'), true);
  check('and its exceptions', labelsFor('baseline.py').includes('ValueError'), true);
  check('r offers its functions', labelsFor('cohorts.r').includes('lapply'), true);
  check('julia offers its functions', labelsFor('model.jl').includes('eltype'), true);
  check('matlab offers its functions', labelsFor('figure.m').includes('linspace'), true);
  check('typescript offers its types', labelsFor('app.ts').includes('readonly'), true);
  check('javascript too', labelsFor('app.js').includes('await'), true);
  check('sql offers its clauses', labelsFor('query.sql').includes('SELECT'), true);
  check('shell offers its commands', labelsFor('run.sh').includes('grep'), true);
  check('rust offers its traits', labelsFor('lib.rs').includes('Iterator'), true);
  check('c offers its types', labelsFor('main.c').includes('size_t'), true);
  check('java offers its collections', labelsFor('Main.java').includes('ArrayList'), true);

  // A data format has no keywords, and inventing some would be a lie: the word completion the
  // editor already has is the honest answer.
  check('a notebook has no keyword list', completionFor('analysis.ipynb').length, 0);
  check('json has none either', completionFor('config.json').length, 0);
  check('nor yaml', completionFor('config.yaml').length, 0);
  check('nor a binary', completionFor('model.h5').length, 0);
}

console.log('\n— naming a file —');
{
  check('the name is the last segment', fileNameOf('prepared/1abc.pdb'), '1abc.pdb');
  check('a bare name is itself', fileNameOf('README.md'), 'README.md');
  check('and a windows path still ends at the file', fileNameOf('analysis\\baseline.py'), 'baseline.py');
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: a document is edited as a document, text as text, and an image not at all');
