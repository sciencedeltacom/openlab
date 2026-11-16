/**
 * The public databases the workbench can query.
 *
 * A database is a **connection with named operations**. Each operation is one request the
 * service understands — `find` for a search, `fetch` for one record — and it carries the API
 * URL, the HTTP method, and every parameter with its name, placement and default. Nothing is
 * guessed at request time: `limit`, `page` and the filters are declared here, so the review
 * can page through results, the request panel can offer the right fields, and the agent can
 * call `Database.find` like a method.
 *
 * Operations are data, not code, because a database the user adds is stored as a row: a URL
 * template with `{placeholders}` and a parameter list survive a round-trip through SQLite.
 *
 * The built-ins were checked against each service's live API; the exact request each one
 * makes is its `find` operation, and `defaultPath` is gone — there is only the operation.
 */

import {
  Atom,
  BarChart3,
  Blocks,
  BookMarked,
  BookOpen,
  Boxes,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Database as DatabaseIcon,
  Dna,
  FileText,
  FlaskConical,
  Network,
  Target,
  type LucideIcon,
} from 'lucide-react';

/** How a database is authorised, and so which control its page shows. */
export type DatabaseAuthorization = 'none' | 'api-key' | 'bearer';

/** How ready a database is to answer a request. */
export type DatabaseState = 'connected' | 'needs-key' | 'download-only' | 'terms';

/** The request methods the workbench offers. */
export type DatabaseMethod = 'GET' | 'POST';

/** The state's label, tint and icon. One vocabulary for the card, the facet and the eyebrow. */
export const DATABASE_STATE: Record<DatabaseState, { label: string; chip: string; icon: LucideIcon }> = {
  connected: { label: 'Connected', chip: 'bg-success/15 text-success', icon: CircleCheck },
  'needs-key': { label: 'Needs a key', chip: 'bg-warning/15 text-warning', icon: CircleAlert },
  'download-only': { label: 'Downloads only', chip: 'bg-surface-tertiary text-muted', icon: CircleDashed },
  terms: { label: 'Terms apply', chip: 'bg-danger/15 text-danger', icon: CircleAlert },
};

/** The authorisation choices the connection panel offers. */
export const AUTHORIZATION_LABEL: Record<DatabaseAuthorization, string> = {
  none: 'None',
  'api-key': 'API key',
  bearer: 'Bearer token',
};

/** A response drawn as a table, which is what most of these APIs return. */
export interface DatabaseTable {
  kind: 'table';
  columns: string[];
  rows: string[][];
}

/** A response that has no natural columns and is shown as text. */
export interface DatabaseText {
  kind: 'text';
  text: string;
}

/** A response, however the page can draw it. */
export type DatabaseResponse = DatabaseTable | DatabaseText;

/** One request header the editor opens with. */
export interface HeaderRow {
  name: string;
  value: string;
}

/**
 * The marks a database can wear. A database carries only the key, so it stays a plain record
 * that can be written to storage; the icon component lives here, mapped at render.
 */
export const DATABASE_MARKS: Record<string, { icon: LucideIcon; tint: string }> = {
  book: { icon: BookOpen, tint: 'bg-accent/15 text-accent' },
  atom: { icon: Atom, tint: 'bg-accent-secondary/15 text-accent-secondary' },
  dna: { icon: Dna, tint: 'bg-success/15 text-success' },
  flask: { icon: FlaskConical, tint: 'bg-warning/15 text-warning' },
  network: { icon: Network, tint: 'bg-accent/15 text-accent' },
  file: { icon: FileText, tint: 'bg-default text-muted' },
  boxes: { icon: Boxes, tint: 'bg-danger/15 text-danger' },
  chart: { icon: BarChart3, tint: 'bg-success/15 text-success' },
  mark: { icon: BookMarked, tint: 'bg-accent/15 text-accent' },
  blocks: { icon: Blocks, tint: 'bg-accent-secondary/15 text-accent-secondary' },
  target: { icon: Target, tint: 'bg-warning/15 text-warning' },
};

/** The mark a database wears, falling back to a neutral one for an unknown key. */
export function databaseMark(key: string): { icon: LucideIcon; tint: string } {
  return DATABASE_MARKS[key] ?? { icon: DatabaseIcon, tint: 'bg-default text-muted' };
}

/* ================================================================================================
 * Operations
 * ============================================================================================== */

/** Where a value goes in the request. */
export type ParameterPlacement = 'query' | 'path' | 'body';

/**
 * How a value is written.
 *
 * `clause` is for APIs whose filters share one query parameter (`filter=type:article,from_…`):
 * every clause parameter with the same `param` is collected and comma-joined. `pipe` joins an
 * array with `|`, which is how those APIs express "or". `offset` turns a page number into the
 * record offset the API wants.
 */
export type ParameterEncoding = 'plain' | 'pipe' | 'clause' | 'offset';

/** One argument an operation accepts, with everything needed to place it. */
export interface OperationParameter {
  /** The name the interface and the agent use: `query`, `limit`, `page`, `id`, … */
  name: string;
  label: string;
  kind: 'text' | 'number' | 'select';
  options?: string[];
  /** Used when the caller does not supply one. */
  default?: string | number;
  required?: boolean;
  in: ParameterPlacement;
  /** The API's own name, when it differs from `name`. */
  param?: string;
  encode?: ParameterEncoding;
  /** The filter key for `clause`, e.g. `type` or `from_publication_date`. */
  key?: string;
  /** Appended to the value — a year becomes `2019-01-01`. */
  suffix?: string;
}

/** One request a database understands. */
export interface Operation {
  /** `find` is the search the review pages through; `fetch` is one record by id. */
  id: string;
  label: string;
  method: DatabaseMethod;
  /** Path template; `{name}` placeholders are filled from path parameters. */
  path: string;
  /** A host this operation uses instead of the database's own, e.g. RCSB's search service. */
  endpoint?: string;
  /** Parameters always sent, e.g. `format=json` or `db=pubmed`. */
  fixed?: Record<string, string>;
  parameters: OperationParameter[];
  /**
   * What the response carries: a list of records, or ids that need the `fetch` operation to
   * become records. PubMed's E-utilities only search to ids.
   */
  records?: 'list' | 'ids';
  /** A JSON body template for POST, with `{name}` placeholders. */
  body?: string;
}

/** The built request for one operation. */
export interface BuiltRequest {
  url: string;
  method: DatabaseMethod;
  body: string | null;
}

/** One public database and the operations it offers. */
export interface Database {
  id: string;
  name: string;
  /** The family the catalogue groups by. */
  family: string;
  /** A key into {@link DATABASE_MARKS}; keeps the record serialisable. */
  mark: string;
  purpose: string;
  /** How many records the catalogue counts, as a reader-facing phrase. */
  recordCount: string;
  /** The access model in words, e.g. "Open" or "API key". */
  access: string;
  state: DatabaseState;
  /** What the connection panel opens the authorisation control on. */
  authorization: DatabaseAuthorization;
  endpoint: string;
  /** Every request the database understands. `find` and `fetch` are the conventions. */
  operations: Operation[];
  defaultHeaders: HeaderRow[];
  /** What the database holds, in one sentence. */
  holds: string;
  updateCadence: string;
  licence: string;
  docsUrl: string;
  /** The response shown until the proxy answers. */
  sample: DatabaseResponse;
}

const JSON_HEADERS: HeaderRow[] = [{ name: 'Accept', value: 'application/json' }];

/** The operation the review and the agent mean by "search". */
export function findOperation(database: Database): Operation | undefined {
  return database.operations.find((operation) => operation.id === 'find') ?? database.operations[0];
}

/** One operation by id. */
export function databaseOperation(database: Database, id: string): Operation | undefined {
  return database.operations.find((operation) => operation.id === id);
}

/** The defaults an operation starts from, so a form opens with something runnable. */
export function operationDefaults(operation: Operation): Record<string, string | number> {
  const args: Record<string, string | number> = {};
  for (const parameter of operation.parameters) {
    if (parameter.default !== undefined) {
      args[parameter.name] = parameter.default;
    }
  }
  return args;
}

/** Escape a value for embedding inside a JSON body template. */
function jsonValue(value: unknown): string {
  return JSON.stringify(String(value)).slice(1, -1);
}

/**
 * Build the request for one operation.
 *
 * Path placeholders are filled and URL-encoded; query parameters are written with their own
 * encoding rules; a POST body template gets its placeholders escaped. A parameter the caller
 * left out falls back to its default, and a missing required one is left in the URL so the
 * service answers with its own error rather than the app inventing one.
 */
export function buildOperation(
  database: Database,
  operation: Operation,
  args: Record<string, unknown>,
): BuiltRequest {
  const query = new URLSearchParams(operation.fixed ?? {});
  const clauses: Record<string, string[]> = {};
  const limitParameter = operation.parameters.find((parameter) => parameter.name === 'limit');
  const limit = Number(args.limit ?? limitParameter?.default ?? 10);
  let path = operation.path;
  let body = operation.body ?? null;

  for (const parameter of operation.parameters) {
    const raw = args[parameter.name];
    if (raw === undefined || raw === null || raw === '') {
      continue;
    }
    const param = parameter.param ?? parameter.name;

    if (parameter.in === 'path') {
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(raw)));
      continue;
    }
    if (parameter.in === 'body') {
      if (body !== null) {
        body = body.replaceAll(`{${parameter.name}}`, jsonValue(raw));
      }
      continue;
    }

    let value: string;
    if (parameter.encode === 'offset') {
      value = String((Number(raw) - 1) * limit);
    } else if (parameter.encode === 'pipe') {
      value = Array.isArray(raw) ? raw.join('|') : String(raw);
    } else if (parameter.encode === 'clause') {
      const joined = Array.isArray(raw) ? raw.join('|') : String(raw);
      (clauses[param] ??= []).push(`${parameter.key ?? parameter.name}:${joined}${parameter.suffix ?? ''}`);
      continue;
    } else {
      value = Array.isArray(raw) ? raw.join(',') : String(raw);
    }
    query.set(param, `${value}${parameter.suffix ?? ''}`);
  }

  for (const [param, list] of Object.entries(clauses)) {
    query.set(param, list.join(','));
  }

  const endpoint = (operation.endpoint ?? database.endpoint).replace(/\/$/, '');
  const search = query.toString();
  const url = `${endpoint}${path.startsWith('/') ? path : `/${path}`}${search ? `?${search}` : ''}`;
  return { url, method: operation.method, body };
}

/* ================================================================================================
 * The built-in databases
 * ============================================================================================== */

/**
 * The built-in databases the workbench ships with.
 *
 * The seven most-used open research services, chosen so the request panel works the moment the
 * app opens: every one is keyless, returns JSON, and its operations were checked against the
 * live API. The store seeds this list into SQLite on first run, after which it is the user's
 * like any other row — editable, and removable.
 */
export const DATABASES: Database[] = [
  {
    id: 'openalex',
    name: 'OpenAlex',
    family: 'Literature',
    mark: 'book',
    purpose: 'Scholarly works, authors and institutions, with citation counts.',
    recordCount: '260M works',
    access: 'Open',
    state: 'connected',
    authorization: 'none',
    endpoint: 'https://api.openalex.org',
    operations: [
      {
        id: 'find',
        label: 'Search works',
        method: 'GET',
        path: '/works',
        // Ask for the fields the screening actually reads — above all the abstract, which
        // OpenAlex withholds from the default response.
        fixed: {
          select:
            'id,title,publication_year,doi,primary_location,authorships,abstract_inverted_index,cited_by_count,open_access,best_oa_location',
        },
        parameters: [
          { name: 'query', label: 'Search', kind: 'text', in: 'query', param: 'search' },
          {
            name: 'types',
            label: 'Document types',
            kind: 'select',
            in: 'query',
            param: 'filter',
            encode: 'clause',
            key: 'type',
            options: ['article', 'review', 'preprint', 'book-chapter', 'dataset', 'report'],
          },
          {
            name: 'yearFrom',
            label: 'From year',
            kind: 'number',
            in: 'query',
            param: 'filter',
            encode: 'clause',
            key: 'from_publication_date',
            suffix: '-01-01',
          },
          {
            name: 'yearTo',
            label: 'To year',
            kind: 'number',
            in: 'query',
            param: 'filter',
            encode: 'clause',
            key: 'to_publication_date',
            suffix: '-12-31',
          },
          { name: 'limit', label: 'Per page', kind: 'number', in: 'query', param: 'per-page', default: 25 },
          { name: 'page', label: 'Page', kind: 'number', in: 'query', param: 'page', default: 1 },
        ],
      },
      {
        id: 'fetch',
        label: 'One work',
        method: 'GET',
        path: '/works/{id}',
        parameters: [{ name: 'id', label: 'DOI or work id', kind: 'text', in: 'path', required: true }],
      },
    ],
    defaultHeaders: JSON_HEADERS,
    holds: 'Works, their authors, venues and the citations between them.',
    updateCadence: 'daily',
    licence: 'CC0 1.0',
    docsUrl: 'https://docs.openalex.org',
    sample: {
      kind: 'table',
      columns: ['id', 'title', 'year', 'cited_by'],
      rows: [
        ['W2741809807', 'Chromatin accessibility improves off-target prediction', '2023', '214'],
        ['W2039014716', 'DNA targeting specificity of RNA-guided Cas9 nucleases', '2013', '3120'],
      ],
    },
  },
  {
    id: 'pubmed',
    name: 'PubMed',
    family: 'Literature',
    mark: 'mark',
    purpose: 'Biomedical and life-sciences citations from MEDLINE.',
    recordCount: '37M citations',
    access: 'Open',
    state: 'connected',
    authorization: 'none',
    endpoint: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
    operations: [
      {
        id: 'find',
        label: 'Search PubMed',
        method: 'GET',
        path: '/esearch.fcgi',
        fixed: { db: 'pubmed', retmode: 'json' },
        // E-utilities search answers with PubMed ids; the `fetch` operation turns them into
        // records (titles, journals, authors) in one more call.
        records: 'ids',
        parameters: [
          { name: 'query', label: 'Search terms', kind: 'text', in: 'query', param: 'term', required: true },
          { name: 'limit', label: 'Records', kind: 'number', in: 'query', param: 'retmax', default: 20 },
          // PubMed pages by record offset, so the page number becomes one.
          {
            name: 'page',
            label: 'Page',
            kind: 'number',
            in: 'query',
            param: 'retstart',
            encode: 'offset',
            default: 1,
          },
          {
            name: 'sort',
            label: 'Sort',
            kind: 'select',
            in: 'query',
            param: 'sort',
            options: ['relevance', 'pub_date'],
          },
        ],
      },
      {
        id: 'fetch',
        label: 'Summarise records',
        method: 'GET',
        path: '/esummary.fcgi',
        fixed: { db: 'pubmed', retmode: 'json' },
        parameters: [
          { name: 'id', label: 'PubMed ids', kind: 'text', in: 'query', param: 'id', required: true },
        ],
      },
    ],
    defaultHeaders: JSON_HEADERS,
    holds: 'Citations and abstracts indexed by MEDLINE; search returns PubMed IDs.',
    updateCadence: 'daily',
    licence: 'NLM terms of use',
    docsUrl: 'https://www.ncbi.nlm.nih.gov/books/NBK25501/',
    sample: {
      kind: 'text',
      text: '{\n  "esearchresult": {\n    "count": "71599",\n    "idlist": ["42855940", "42855835", "42855475"]\n  }\n}',
    },
  },
  {
    id: 'uniprot',
    name: 'UniProt',
    family: 'Proteins',
    mark: 'blocks',
    purpose: 'Protein sequences with their functional annotation.',
    recordCount: '250M entries',
    access: 'Open',
    state: 'connected',
    authorization: 'none',
    endpoint: 'https://rest.uniprot.org/uniprotkb',
    operations: [
      {
        id: 'find',
        label: 'Search proteins',
        method: 'GET',
        path: '/search',
        fixed: { format: 'json' },
        parameters: [
          { name: 'query', label: 'Query', kind: 'text', in: 'query', param: 'query', required: true },
          { name: 'limit', label: 'Results', kind: 'number', in: 'query', param: 'size', default: 25 },
          { name: 'fields', label: 'Fields', kind: 'text', in: 'query', param: 'fields' },
        ],
      },
      {
        id: 'fetch',
        label: 'One entry',
        method: 'GET',
        path: '/{id}.json',
        parameters: [{ name: 'id', label: 'Accession', kind: 'text', in: 'path', required: true }],
      },
    ],
    defaultHeaders: JSON_HEADERS,
    holds: 'Sequences, names, domains, cross-references and disease links.',
    updateCadence: 'every 8 weeks',
    licence: 'CC BY 4.0',
    docsUrl: 'https://www.uniprot.org/help/api',
    sample: {
      kind: 'table',
      columns: ['accession', 'protein', 'length', 'reviewed'],
      rows: [
        ['P51587', 'Breast cancer type 2 susceptibility protein', '3418', 'reviewed'],
        ['Q9W157', 'Breast cancer type 2 susceptibility protein homolog', '1244', 'reviewed'],
      ],
    },
  },
  {
    id: 'pdb',
    name: 'RCSB PDB',
    family: 'Structures',
    mark: 'boxes',
    purpose: 'Experimentally determined 3D structures of macromolecules.',
    recordCount: '220k structures',
    access: 'Open',
    state: 'connected',
    authorization: 'none',
    endpoint: 'https://data.rcsb.org/rest/v1',
    operations: [
      {
        id: 'find',
        label: 'Search structures',
        method: 'POST',
        endpoint: 'https://search.rcsb.org/rcsbsearch/v2/query',
        path: '/',
        parameters: [
          { name: 'query', label: 'Full-text search', kind: 'text', in: 'body', required: true },
          { name: 'start', label: 'Start at', kind: 'number', in: 'body', default: 0 },
          { name: 'rows', label: 'Rows', kind: 'number', in: 'body', default: 10 },
        ],
        body: '{"query":{"type":"terminal","service":"full_text","parameters":{"value":"{query}"}},"return_type":"entry","request_options":{"paginate":{"start":{start},"rows":{rows}}}}',
      },
      {
        id: 'fetch',
        label: 'One entry',
        method: 'GET',
        path: '/core/entry/{id}',
        parameters: [{ name: 'id', label: 'PDB id', kind: 'text', in: 'path', required: true }],
      },
    ],
    defaultHeaders: JSON_HEADERS,
    holds: 'Atomic coordinates, experimental method and assembly metadata.',
    updateCadence: 'weekly',
    licence: 'CC0 1.0',
    docsUrl: 'https://data.rcsb.org/redoc/index.html',
    sample: {
      kind: 'table',
      columns: ['id', 'title', 'method', 'resolution'],
      rows: [
        ['4HHB', 'The crystal structure of human deoxyhaemoglobin at 1.74 Å', 'X-RAY DIFFRACTION', '1.74'],
      ],
    },
  },
  {
    id: 'chembl',
    name: 'ChEMBL',
    family: 'Compounds',
    mark: 'flask',
    purpose: 'Bioactive molecules with their measured activities.',
    recordCount: '2.4M compounds',
    access: 'Open',
    state: 'connected',
    authorization: 'none',
    endpoint: 'https://www.ebi.ac.uk/chembl/api/data',
    operations: [
      {
        id: 'find',
        label: 'Search molecules',
        method: 'GET',
        path: '/molecule/search',
        fixed: { format: 'json' },
        parameters: [
          { name: 'query', label: 'Search', kind: 'text', in: 'query', param: 'q', required: true },
          { name: 'limit', label: 'Results', kind: 'number', in: 'query', param: 'limit', default: 20 },
          {
            name: 'page',
            label: 'Page',
            kind: 'number',
            in: 'query',
            param: 'offset',
            encode: 'offset',
            default: 1,
          },
        ],
      },
      {
        id: 'fetch',
        label: 'One molecule',
        method: 'GET',
        path: '/molecule/{id}.json',
        parameters: [{ name: 'id', label: 'ChEMBL id', kind: 'text', in: 'path', required: true }],
      },
    ],
    defaultHeaders: JSON_HEADERS,
    holds: 'Compounds, bioassays, targets and the activities measured between them.',
    updateCadence: 'quarterly',
    licence: 'CC BY-SA 3.0',
    docsUrl: 'https://chembl.gitbook.io/chembl-interface-documentation/web-services',
    sample: {
      kind: 'table',
      columns: ['molecule_chembl_id', 'pref_name', 'molecule_type', 'mw_freebase'],
      rows: [['CHEMBL25', 'ASPIRIN', 'Small molecule', '180.16']],
    },
  },
  {
    id: 'pubchem',
    name: 'PubChem',
    family: 'Compounds',
    mark: 'atom',
    purpose: 'Chemical structures, properties and biological activities.',
    recordCount: '120M compounds',
    access: 'Open',
    state: 'connected',
    authorization: 'none',
    endpoint: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug',
    operations: [
      {
        id: 'find',
        label: 'By name',
        method: 'GET',
        path: '/compound/name/{name}/property/MolecularFormula,MolecularWeight/JSON',
        parameters: [{ name: 'name', label: 'Compound name', kind: 'text', in: 'path', required: true }],
      },
      {
        id: 'similar',
        label: 'Similar to a SMILES',
        method: 'GET',
        path: '/compound/similarity/smiles/{smiles}/JSON',
        parameters: [
          { name: 'smiles', label: 'SMILES', kind: 'text', in: 'path', required: true },
          {
            name: 'threshold',
            label: 'Threshold',
            kind: 'number',
            in: 'query',
            param: 'Threshold',
            default: 90,
          },
        ],
      },
      {
        id: 'fetch',
        label: 'One compound',
        method: 'GET',
        path: '/compound/cid/{cid}/property/MolecularFormula,MolecularWeight/JSON',
        parameters: [{ name: 'cid', label: 'PubChem CID', kind: 'number', in: 'path', required: true }],
      },
    ],
    defaultHeaders: JSON_HEADERS,
    holds: 'Compounds and substances with properties, synonyms and assay results.',
    updateCadence: 'continuous',
    licence: 'Public domain',
    docsUrl: 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest',
    sample: {
      kind: 'table',
      columns: ['CID', 'MolecularFormula', 'MolecularWeight'],
      rows: [['2244', 'C9H8O4', '180.16']],
    },
  },
  {
    id: 'ensembl',
    name: 'Ensembl',
    family: 'Genomics',
    mark: 'dna',
    purpose: 'Genomes, genes, transcripts and variants.',
    recordCount: '300+ species',
    access: 'Open',
    state: 'connected',
    authorization: 'none',
    endpoint: 'https://rest.ensembl.org',
    operations: [
      {
        id: 'find',
        label: 'Gene by symbol',
        method: 'GET',
        path: '/lookup/symbol/{species}/{symbol}',
        fixed: { 'content-type': 'application/json' },
        parameters: [
          { name: 'symbol', label: 'Gene symbol', kind: 'text', in: 'path', required: true },
          { name: 'species', label: 'Species', kind: 'text', in: 'path', default: 'homo_sapiens' },
          { name: 'expand', label: 'Expand', kind: 'select', in: 'query', options: ['0', '1'], default: '0' },
        ],
      },
      {
        id: 'fetch',
        label: 'One gene',
        method: 'GET',
        path: '/lookup/id/{id}',
        fixed: { 'content-type': 'application/json' },
        parameters: [{ name: 'id', label: 'Ensembl id', kind: 'text', in: 'path', required: true }],
      },
    ],
    defaultHeaders: JSON_HEADERS,
    holds: 'Gene, transcript and variant annotation across annotated genomes.',
    updateCadence: 'three releases a year',
    licence: 'Apache 2.0',
    docsUrl: 'https://rest.ensembl.org',
    sample: {
      kind: 'table',
      columns: ['id', 'display_name', 'seq_region_name', 'start', 'end', 'biotype'],
      rows: [['ENSG00000139618', 'BRCA2', '13', '32315086', '32400268', 'protein_coding']],
    },
  },
];

/** The families present in a list, in the order they first appear. */
export function databaseFamilies(databases: readonly Database[]): string[] {
  return Array.from(new Set(databases.map((database) => database.family)));
}
