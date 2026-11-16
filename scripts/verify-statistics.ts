/**
 * Cross-checks the statistics data layer and procedure protocol.
 *
 * Run with: `bun scripts/verify-statistics.ts`
 *
 * The workbench now reads tables and manifests instead of one paste shape, so the two places
 * a mistake would be silent are pinned here: a table that reads differently than it looks
 * (delimiters, quotes, headers, blocks) and a manifest that is accepted for something it does
 * not declare. The last block runs the built-in procedures through a CSV, a paste and a JSON
 * document and asserts they see the same numbers, which is the property the rewrite exists
 * for.
 */

import {
  readDataset,
  sniffDelimiter,
  splitDelimited,
  suggestPlan,
  planReady,
  toParsedData,
  resolveGroupMode,
  columnNumbers,
} from '../src/lib/science/dataset';
import {
  defaultParams,
  parseManifest,
  procedureTemplate,
  readParam,
  readScriptOutput,
  STATISTICS_PROTOCOL,
} from '../src/lib/science/procedures';
import { welchTTest, pairedTTest, chiSquareTest, adjustPValues } from '../src/lib/science/stats';

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

function checkThat(label: string, condition: boolean) {
  check(label, condition, true);
}

/* ---------------------------------------------------------------------------------------------
 * Reading a table
 * ------------------------------------------------------------------------------------------- */

check('a comma table is sniffed as CSV', sniffDelimiter('a,b\n1,2\n3,4'), ',');
check('a tab table is sniffed as TSV', sniffDelimiter('a\tb\n1\t2'), '\t');
check('two numbers on a line are whitespace', sniffDelimiter('1 2\n3 4'), 'whitespace');
check('a quoted comma stays one field', splitDelimited('"a,b",c', ','), ['a,b', 'c']);
check('a doubled quote is one quote', splitDelimited('"say ""hi""",2', ','), ['say "hi"', '2']);

const csv = readDataset(
  '\uFEFFgroup,value\r\ncontrol,9.8\r\ntreated,11.2\r\ncontrol,10.1\r\ntreated,10.9\r\n',
);
check(
  'a BOM and CRLF do not reach the first header',
  csv.columns.map((column) => column.name),
  ['group', 'value'],
);
check(
  'the header names the columns',
  csv.columns.map((column) => column.type),
  ['text', 'number'],
);
check('the rows are kept', csv.rows.length, 4);
check('a CSV has one block', new Set(csv.blockOf).size, 1);

const paste = readDataset('9.8\n10.1\n\n11.2\n10.9');
check('a blank line separates blocks', [...new Set(paste.blockOf)], [1, 2]);
check(
  'a single column is numeric',
  paste.columns.map((column) => column.type),
  ['number'],
);

const headed = readDataset('x y\n1 2\n3 4');
check(
  'a text-only first row is a header',
  headed.columns.map((column) => column.name),
  ['x', 'y'],
);
const unheaded = readDataset('1 2\n3 4');
check(
  'a numeric first row is data',
  unheaded.columns.map((column) => column.name),
  ['V1', 'V2'],
);
check('so all of it is read', unheaded.rows.length, 2);

const forced = readDataset('1 2\n3 4', { header: true });
check(
  'a header can be forced',
  forced.columns.map((column) => column.name),
  ['1', '2'],
);

const missing = readDataset('value\n1\nNA\n3\ntext');
check('NA is missing, text is not a number', missing.columns[0].type, 'text');
check('and a text column reports no numeric gaps', missing.columns[0].missing, 0);

/* ---------------------------------------------------------------------------------------------
 * JSON
 * ------------------------------------------------------------------------------------------- */

const objects = readDataset('[{"group":"a","value":1},{"group":"b","value":2}]');
check(
  'an array of objects is a table',
  objects.columns.map((column) => column.name),
  ['group', 'value'],
);
check('with its values read', columnNumbers(objects, 'value'), [1, 2]);

const nested = readDataset('{"columns":["a","b"],"rows":[[1,2],[3,4]]}');
check('columns and rows is a table', nested.rows.length, 2);
check(
  'and the header is the names given',
  nested.columns.map((column) => column.name),
  ['a', 'b'],
);

const arrayRows = readDataset('[[1,2],[3,4]]');
check('an array of arrays keeps its first row as data', arrayRows.rows.length, 2);

const broken = readDataset('{ not json');
checkThat('invalid JSON is reported, not thrown', broken.problems.length === 1);

/* ---------------------------------------------------------------------------------------------
 * Plans
 * ------------------------------------------------------------------------------------------- */

const blocks = readDataset('9.8\n10.1\n\n11.2\n10.9');
const blockPlan = suggestPlan(blocks, 'groups');
check('a paste with blank lines groups by block', resolveGroupMode(blocks, blockPlan), 'blocks');

const longTable = readDataset('group,value\ncontrol,9.8\ntreated,11.2\ncontrol,10.1\ntreated,10.9');
const columnPlan = suggestPlan(longTable, 'groups');
check('a text column groups by column', resolveGroupMode(longTable, columnPlan), 'column');
check('and the plan is ready', planReady(longTable, columnPlan), true);

const wide = readDataset('a,b,c\n1,2,3\n4,5,6');
const widePlan = suggestPlan(wide, 'groups');
check('a wide table groups one column per group', resolveGroupMode(wide, widePlan), 'per-column');
check('with three groups', toParsedData(wide, widePlan).blocks.length, 3);

const withoutGroup = readDataset('a,b\n1,2\n3,4');
check(
  'a table with no group column and no blocks is not ready for groups',
  planReady(withoutGroup, { shape: 'groups', groupMode: 'column', roles: {} }),
  false,
);

/* ---------------------------------------------------------------------------------------------
 * The same numbers, whatever the format
 * ------------------------------------------------------------------------------------------- */

const numbersA = [9.8, 10.4, 9.5, 10.1, 9.9, 10.6];
const numbersB = [11.2, 10.8, 11.6, 11.0, 11.9, 11.4];

const fromPaste = toParsedData(
  readDataset(`${numbersA.join('\n')}\n\n${numbersB.join('\n')}`),
  suggestPlan(readDataset(`${numbersA.join('\n')}\n\n${numbersB.join('\n')}`), 'groups'),
);
const fromCsvText = `group,value\n${numbersA.map((v) => `a,${v}`).join('\n')}\n${numbersB
  .map((v) => `b,${v}`)
  .join('\n')}`;
const csvData = readDataset(fromCsvText);
const fromCsv = toParsedData(csvData, suggestPlan(csvData, 'groups'));
const jsonData = readDataset(
  JSON.stringify([
    ...numbersA.map((value) => ({ group: 'a', value })),
    ...numbersB.map((value) => ({ group: 'b', value })),
  ]),
);
const fromJson = toParsedData(jsonData, suggestPlan(jsonData, 'groups'));

check('a paste keeps the two groups', fromPaste.blocks, [numbersA, numbersB]);
check('a CSV keeps the same two groups', fromCsv.blocks, [numbersA, numbersB]);
check('a JSON document keeps the same two groups', fromJson.blocks, [numbersA, numbersB]);
check(
  'and Welch sees the same t',
  welchTTest(fromPaste.blocks[0], fromPaste.blocks[1]).values.t,
  welchTTest(fromCsv.blocks[0], fromCsv.blocks[1]).values.t,
);

const pairedText = readDataset('before after\n9.4 8.1\n9.8 8.4\n10.2 8.9\n9.1 7.9');
const pairedPlan = suggestPlan(pairedText, 'pairs');
const paired = toParsedData(pairedText, pairedPlan);
check(
  'a paired table splits into two columns',
  [paired.blocks[0], paired.pairs[0]],
  [
    [9.4, 9.8, 10.2, 9.1],
    [8.1, 8.4, 8.9, 7.9],
  ],
);
check(
  'and the paired test reads the same difference',
  pairedTTest(paired.blocks[0], paired.pairs[0]).values.df,
  3,
);

const table = readDataset('42 18 8\n30 26 14\n12 24 36');
const tablePlan = suggestPlan(table, 'table');
check('a contingency table is a matrix', toParsedData(table, tablePlan).matrix, [
  [42, 18, 8],
  [30, 26, 14],
  [12, 24, 36],
]);
check(
  'and the chi-square test finds three rows',
  chiSquareTest(toParsedData(table, tablePlan).matrix).values.df,
  4,
);

const pValues = readDataset('Calibration 0.012\nSeed stability 0.084\nTail recall 0.006');
const pPlan = suggestPlan(pValues, 'pvalues');
check('labels and p-values are read', toParsedData(pValues, pPlan).pEntries, [
  { label: 'Calibration', p: 0.012 },
  { label: 'Seed stability', p: 0.084 },
  { label: 'Tail recall', p: 0.006 },
]);
check(
  'and the correction has three tests',
  (adjustPValues(toParsedData(pValues, pPlan).pEntries).values.results ?? []).length,
  3,
);

/* ---------------------------------------------------------------------------------------------
 * Script output
 * ------------------------------------------------------------------------------------------- */

check('the last JSON object is the result', readScriptOutput('warming up\n{"values":{"a":1}}')?.values, {
  a: 1,
});
check('a line after it is ignored', readScriptOutput('{"values":{"a":1}}\nbye')?.values, { a: 1 });
check('an object without values is not a result', readScriptOutput('{"a":1}'), null);
check('invalid JSON is not a result', readScriptOutput('Traceback…'), null);
check(
  'assumption statuses are read, unknown ones dropped',
  readScriptOutput(
    '{"values":{},"assumptions":[{"name":"n","status":"pass","detail":"ok"},{"name":"x","status":"maybe"}]}',
  )?.assumptions,
  [{ name: 'n', status: 'pass', detail: 'ok' }],
);

/* ---------------------------------------------------------------------------------------------
 * Manifests
 * ------------------------------------------------------------------------------------------- */

const template = procedureTemplate();
const valid = parseManifest(template.yaml, {
  dir: '.openlab/statistics/bootstrap-diff',
  python: template.python,
});
checkThat('the template validates', valid.ok);
if (valid.ok) {
  check('with its id', valid.manifest.id, 'bootstrap-diff');
  check('with three parameters', valid.manifest.params.length, 3);
  check('with five outputs', valid.manifest.outputs.length, 5);
  check('and the choice default', valid.manifest.params[1].default, 'mean');
  check('defaults are filled', defaultParams(valid.manifest).resamples, 5000);
  check('a number is clamped to its range', readParam(valid.manifest.params[0], 1), 100);
  check('a choice outside the list falls back', readParam(valid.manifest.params[1], 'mode'), 'mean');
}

const wrongProtocol = parseManifest(template.yaml.replace(STATISTICS_PROTOCOL, 'openlab.statistics/2'));
checkThat('a manifest from another protocol is refused', !wrongProtocol.ok);
checkThat('and says why', !wrongProtocol.ok && wrongProtocol.errors[0].includes('protocol'));

const noOutputs = parseManifest(template.yaml.replace(/outputs:[\s\S]*?chart:/, 'outputs: []\nchart:'));
checkThat('a manifest with no outputs is refused', !noOutputs.ok);

const badParam = parseManifest(template.yaml.replace('name: resamples', 'name: Resamples'));
checkThat('a camel-case parameter name is refused', !badParam.ok);

const noChoices = parseManifest(template.yaml.replace(/choices: \[mean, median\]/, ''));
checkThat('a choice without options is refused', !noChoices.ok);

const noPython = parseManifest(template.yaml, { dir: '.openlab/statistics/bootstrap-diff' });
checkThat('a manifest without its script is refused', !noPython.ok);

const badShape = parseManifest(template.yaml.replace('shape: groups', 'shape: rows'));
checkThat('an unknown data shape is refused', !badShape.ok);

const notYaml = parseManifest('protocol: [unclosed');
checkThat('broken YAML is refused with a reason', !notYaml.ok);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
