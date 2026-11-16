/**
 * What each language offers to type.
 *
 * A code editor without completion makes the reader remember every name; with it, the
 * language is at hand. This is the honest ceiling for a client-side editor: each language's
 * **keywords, builtins and common types**, matched as you type, on top of CodeMirror's own
 * completion from the words already in the document. Completing the *members of a library* —
 * `pd.read_` offering `read_csv`, a typed object's fields — needs a language server per
 * language, which is a different product decision than a file editor.
 *
 * The lists are curated per language and deliberately small enough to read: a completion
 * list is a suggestion, and a suggestion that buries the right name under two hundred
 * guesses is worse than none. `.ipynb`, JSON, YAML and the rest get the word completion
 * they already had, because a keyword list for a data format would be a lie.
 */

import { completeFromList, type Completion, type CompletionSource } from '@codemirror/autocomplete';

import { extensionOf } from './editors';

/** What a name is, which decides its icon in the list. */
type Kind = 'keyword' | 'function' | 'class' | 'constant' | 'variable';

/** The words of one kind, as completion entries. Keywords rank above the document's own words. */
function of(kind: Kind) {
  return (text: string): Completion[] =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((label) => ({ label, type: kind, boost: kind === 'keyword' ? 2 : 1 }));
}

const kw = of('keyword');
const fn = of('function');
const cls = of('class');
const cnst = of('constant');
const va = of('variable');

/** Python: the language, then the builtins every script uses. */
const PYTHON: Completion[] = [
  ...kw(
    'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case',
  ),
  ...cnst('None True False Ellipsis NotImplemented __name__ __file__ __doc__'),
  ...fn(
    'abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip',
  ),
  ...cls(
    'Exception ValueError TypeError KeyError IndexError RuntimeError StopIteration FileNotFoundError ZeroDivisionError AttributeError ImportError OSError ArithmeticError OverflowError NotImplementedError AssertionError',
  ),
];

/** R: the language, then the base-package functions a script actually calls. */
const R: Completion[] = [
  ...kw(
    'if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_character_ library require source return',
  ),
  ...fn(
    'print cat paste paste0 sprintf format c list data.frame matrix array vector factor seq seq_len seq_along rep length names colnames rownames head tail str summary mean median sd var min max sum prod cumsum abs sqrt exp log log2 log10 round floor ceiling sign which which.min which.max lapply sapply vapply tapply apply mapply Reduce do.call rbind cbind merge subset aggregate table prop.table unique sort order rank match is.na complete.cases set.seed runif rnorm rbinom rpois sample read.csv read.table read.delim write.csv write.table lm glm aov t.test chisq.test cor plot hist boxplot barplot lines points abline legend axis par',
  ),
];

/** Julia: the language, then Base's everyday functions and types. */
const JULIA: Completion[] = [
  ...kw(
    'abstract baremodule begin break catch const continue do else elseif end export finally for function global if import let local macro module mutable quote return struct try using while where',
  ),
  ...cnst('true false nothing missing Inf NaN'),
  ...fn(
    'println print show display length size sizeof typeof eltype collect map filter reduce foldl foldr sum prod cumsum mean std var minimum maximum extrema sort sortperm unique push! pop! append! empty! deleteat! insert! keys values haskey get get! merge copy deepcopy zeros ones fill rand randn randperm range reshape vec transpose hcat vcat det inv abs sqrt exp log log2 log10 sin cos tan floor ceil round trunc string parse float Int Bool Symbol include',
  ),
  ...cls(
    'Vector Matrix Array Dict Set Tuple NamedTuple Pair Int Int64 Int32 Float64 Float32 String Char Bool Any Union Nothing Missing',
  ),
];

/** MATLAB and Octave (`.m`): the language, then the base functions. */
const MATLAB: Completion[] = [
  ...kw(
    'function end if elseif else for while switch case otherwise break continue return try catch global persistent classdef properties methods events parfor spmd',
  ),
  ...cnst('true false Inf NaN pi eps i j'),
  ...fn(
    'disp fprintf sprintf error warning size length numel ndims zeros ones eye rand randn randi linspace logspace reshape repmat cat horzcat vertcat sum prod cumsum mean median std var min max abs sqrt exp log log10 sin cos tan find isempty isnan isinf ismember strcmp strcmpi strrep strsplit num2str str2num str2double num2cell cellfun arrayfun struct fieldnames plot hold xlabel ylabel title legend axis grid figure close subplot imagesc surf mesh contour histogram bar scatter save load clear clc tic toc',
  ),
];

/** TypeScript and JavaScript, which are one list: a `.ts` file may use every JS name. */
const JS: Completion[] = [
  ...kw(
    'abstract any as asserts async await bigint boolean break case catch class const continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield',
  ),
  ...va(
    'console window document process globalThis fetch setTimeout setInterval clearTimeout clearInterval structuredClone require module exports',
  ),
  ...cls(
    'Object Array Map Set WeakMap WeakSet Promise Proxy Reflect JSON Math Date RegExp Error TypeError RangeError SyntaxError String Number Boolean BigInt Symbol ArrayBuffer DataView Int8Array Uint8Array Float32Array Float64Array',
  ),
];

/** SQL: the words a query is made of, then the aggregate and string functions. */
const SQL: Completion[] = [
  ...kw(
    'SELECT FROM WHERE GROUP ORDER BY HAVING JOIN LEFT RIGHT INNER OUTER FULL CROSS ON AS DISTINCT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW INDEX ALTER DROP WITH UNION ALL LIMIT OFFSET CASE WHEN THEN ELSE END AND OR NOT NULL IS IN BETWEEN LIKE EXISTS ASC DESC PRIMARY KEY FOREIGN REFERENCES UNIQUE DEFAULT RETURNING OVER PARTITION',
  ),
  ...fn(
    'COUNT SUM AVG MIN MAX ROUND ABS CEIL FLOOR COALESCE NULLIF CAST LENGTH UPPER LOWER SUBSTR TRIM CONCAT REPLACE NOW DATE EXTRACT DATE_TRUNC ROW_NUMBER RANK DENSE_RANK LAG LEAD',
  ),
  ...cls(
    'INTEGER BIGINT SMALLINT NUMERIC DECIMAL REAL DOUBLE TEXT VARCHAR CHAR BOOLEAN DATE TIMESTAMP INTERVAL JSON JSONB UUID',
  ),
];

/** Shell: the grammar, then the commands a script is mostly made of. */
const SHELL: Completion[] = [
  ...kw(
    'if then else elif fi for while until do done case esac function in return export local source set unset trap exit break continue read',
  ),
  ...fn(
    'echo printf cd pwd ls cp mv rm mkdir rmdir touch cat head tail less more grep egrep sed awk sort uniq wc cut tr xargs find which whereis chmod chown df du ps kill sleep date env test expr seq tee curl wget git python python3 pip conda mamba docker singularity sbatch squeue module export',
  ),
];

/** Rust: the language, the standard types, and the macros one actually writes. */
const RUST: Completion[] = [
  ...kw(
    'fn let mut const static struct enum impl trait for in while loop match if else return use mod pub crate self super as where dyn async await move ref type unsafe union extern',
  ),
  ...cnst('true false None Some Ok Err'),
  ...fn('println! print! format! vec! panic! assert! assert_eq! write! writeln! todo! unreachable! matches!'),
  ...cls(
    'Box Vec String str Option Result HashMap HashSet BTreeMap BTreeSet Rc Arc Cell RefCell Mutex RwLock Path PathBuf File Iterator IntoIterator Into From Clone Copy Debug Default Display Error',
  ),
];

/** C and C++ together, the way a `.h` is shared between them. */
const C: Completion[] = [
  ...kw(
    'int float double char void long short unsigned signed const static struct union enum typedef sizeof return if else for while do switch case break continue goto class public private protected virtual override template typename namespace using new delete nullptr true false extern inline constexpr noexcept try catch throw',
  ),
  ...cls(
    'size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE std string vector map set unordered_map unordered_set array pair tuple shared_ptr unique_ptr',
  ),
  ...fn(
    'printf fprintf sprintf snprintf scanf malloc calloc realloc free memcpy memset strlen strcmp strcpy strcat fopen fclose fread fwrite fseek exit abort assert',
  ),
];

/** Java: the language and the collections anyone reaches for. */
const JAVA: Completion[] = [
  ...kw(
    'public private protected class interface extends implements static final void int double float long boolean char byte short new return if else for while do switch case break continue try catch finally throw throws import package this super null true false abstract synchronized volatile transient instanceof enum record var',
  ),
  ...cls(
    'String Integer Double Float Long Boolean Character Object List ArrayList Map HashMap Set HashSet Optional Stream Math System Exception RuntimeException IllegalArgumentException IOException',
  ),
];

/** By extension. A language with no list here gets CodeMirror's word completion alone. */
const LANGUAGES: Record<string, Completion[]> = {
  py: PYTHON,
  r: R,
  jl: JULIA,
  m: MATLAB,
  js: JS,
  jsx: JS,
  mjs: JS,
  cjs: JS,
  ts: JS,
  tsx: JS,
  sql: SQL,
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  rs: RUST,
  c: C,
  h: C,
  cc: C,
  cpp: C,
  hpp: C,
  java: JAVA,
};

/** The completion sources for a file, when its language has any. */
export function completionFor(name: string): CompletionSource[] {
  const words = LANGUAGES[extensionOf(name)];
  return words ? [completeFromList(words)] : [];
}
