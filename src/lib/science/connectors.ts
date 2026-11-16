/*---------------------------------------------------------------------------------------------
 *  openlab Science — Literature & data connectors
 *
 *  A connector is a *declarative* description of one public research API: how to build the
 *  request, how to read the response, and how to cite it. Nothing here performs I/O, which
 *  keeps the whole layer testable without network access and lets the UI decide transport
 *  (Tauri proxy when the host allowlist permits it, plain fetch otherwise).
 *
 *  Every connector targets an API that is free to use and needs no API key. Where a service
 *  asks for a polite identifier we send the openlab user agent instead of a per-user key.
 *--------------------------------------------------------------------------------------------*/

/** Shape of a record after normalisation, regardless of which API produced it. */
export interface ScienceRecord {
  /** Stable id, unique within `source`. */
  readonly id: string;
  /** Connector id that produced this record. */
  readonly source: string;
  /** What the record describes. */
  readonly kind: 'article' | 'preprint' | 'dataset' | 'protein' | 'compound';
  readonly title: string;
  /** Author names in the order the source reported them. */
  readonly authors: readonly string[];
  readonly year?: number;
  /** Journal, conference or repository name. */
  readonly venue?: string;
  readonly doi?: string;
  /** Canonical landing page. */
  readonly url?: string;
  readonly abstract?: string;
  /** Source-specific extras worth showing (organism, molecular formula, citation count…). */
  readonly extra?: Readonly<Record<string, string | number>>;
}

/** One HTTP request in a connector's plan. */
export interface ConnectorStep {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Identifier of a citation style supported by {@link formatCitation}. */
export type CitationStyle = 'apa' | 'bibtex' | 'ris';

/** A public research API described declaratively. */
export interface ScienceConnector {
  readonly id: string;
  readonly label: string;
  readonly category: 'literature' | 'biomolecule' | 'chemistry';
  /** Where the data comes from and under which terms — shown in the UI. */
  readonly attribution: string;
  readonly docsUrl: string;
  /** One-line description of what the connector is good at. */
  readonly summary: string;
  /** Ordered requests to run; later steps may depend on earlier payloads. */
  plan(query: string, limit: number): ConnectorStep[];
  /** Turn the raw payloads (one per step, same order) into records. */
  parse(payloads: readonly unknown[]): ScienceRecord[];
}

const USER_AGENT = 'openlab/1.0 (research workbench; +https://github.com/sciencedeltacom/openlab)';

/** JSON headers with the polite user agent most of these APIs expect. */
const jsonHeaders: Readonly<Record<string, string>> = {
  Accept: 'application/json',
  'User-Agent': USER_AGENT,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(raw) ? raw : undefined;
}

/** Collapse whitespace and strip the inline markup APIs put inside abstracts. */
function tidy(text: string | undefined, max = 1200): string | undefined {
  if (!text) {
    return undefined;
  }
  const clean = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) {
    return undefined;
  }
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// ---------------------------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------------------------

/**
 * PubMed via NCBI E-utilities. Two-step by design: `esearch` resolves a query to PMIDs,
 * `esummary` resolves PMIDs to metadata (and `efetch` would give full abstracts).
 */
const pubmed: ScienceConnector = {
  id: 'pubmed',
  label: 'PubMed',
  category: 'literature',
  attribution: 'U.S. National Library of Medicine (NCBI E-utilities), public domain data',
  docsUrl: 'https://www.ncbi.nlm.nih.gov/books/NBK25501/',
  summary: 'Biomedical and life-sciences literature, back to 1946.',
  plan(query, limit) {
    const search = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
    search.searchParams.set('db', 'pubmed');
    search.searchParams.set('term', query);
    search.searchParams.set('retmode', 'json');
    search.searchParams.set('retmax', String(limit));
    search.searchParams.set('sort', 'relevance');
    const summary = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
    summary.searchParams.set('db', 'pubmed');
    summary.searchParams.set('retmode', 'json');
    summary.searchParams.set('id', '{ids}');
    return [
      { url: search.toString(), headers: jsonHeaders },
      { url: summary.toString(), headers: jsonHeaders },
    ];
  },
  parse(payloads) {
    const search = asRecord(payloads[0]);
    const ids = asArray(asRecord(search?.esearchresult)?.idlist)
      .map((v) => str(v))
      .filter(Boolean) as string[];
    const summary = asRecord(asRecord(payloads[1])?.result);
    return ids.flatMap((id) => {
      const item = asRecord(summary?.[id]);
      if (!item) {
        return [];
      }
      const authors = asArray(item.authors)
        .map((a) => str(asRecord(a)?.name))
        .filter(Boolean) as string[];
      return [
        {
          id,
          source: 'pubmed',
          kind: 'article' as const,
          title: tidy(str(item.title), 400) ?? '(untitled)',
          authors,
          year: num(str(item.pubdate)?.slice(0, 4)),
          venue: str(item.fulljournalname) ?? str(item.source),
          doi: asArray(item.articleids)
            .map((a) => asRecord(a))
            .find((a) => str(a?.idtype) === 'doi')
            ? str(
                asArray(item.articleids)
                  .map((a) => asRecord(a))
                  .find((a) => str(a?.idtype) === 'doi')?.value,
              )
            : undefined,
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          extra: { pmid: id },
        },
      ];
    });
  },
};

/** Europe PMC: one request, full abstracts, DOI and open-access flags. */
const europePmc: ScienceConnector = {
  id: 'europepmc',
  label: 'Europe PMC',
  category: 'literature',
  attribution: 'Europe PMC (EMBL-EBI), open access subset plus MEDLINE abstracts',
  docsUrl: 'https://europepmc.org/RestfulWebService',
  summary: 'Life-science literature with abstracts, citations and open-access links.',
  plan(query, limit) {
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    url.searchParams.set('query', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageSize', String(limit));
    url.searchParams.set('resultType', 'core');
    return [{ url: url.toString(), headers: jsonHeaders }];
  },
  parse(payloads) {
    const list = asArray(asRecord(asRecord(payloads[0])?.resultList)?.result);
    return list.flatMap((raw) => {
      const item = asRecord(raw);
      if (!item) {
        return [];
      }
      const id = str(item.id) ?? str(item.pmid) ?? str(item.doi);
      if (!id) {
        return [];
      }
      const authorList = asRecord(item.authorList);
      const authors = asArray(authorList?.author)
        .map((a) => {
          const author = asRecord(a);
          return str(author?.fullName) ?? str(author?.lastName) ?? undefined;
        })
        .filter(Boolean) as string[];
      const journalInfo = asRecord(item.journalInfo);
      const journal = asRecord(journalInfo?.journal);
      return [
        {
          id,
          source: 'europepmc',
          kind: 'article' as const,
          title: tidy(str(item.title), 400) ?? '(untitled)',
          authors,
          year: num(item.pubYear),
          venue: str(item.journalTitle) ?? str(journal?.title),
          doi: str(item.doi),
          url: str(item.pmid)
            ? `https://europepmc.org/article/MED/${str(item.pmid)}`
            : `https://doi.org/${str(item.doi)}`,
          abstract: tidy(str(item.abstractText)),
          extra: {
            pmid: str(item.pmid) ?? '',
            citedBy: num(item.citedByCount) ?? 0,
            openAccess: str(item.isOpenAccess) === 'Y' ? 'yes' : 'no',
          },
        },
      ];
    });
  },
};

/** Crossref: publisher-deposited metadata; the best source for a correct DOI and venue. */
const crossref: ScienceConnector = {
  id: 'crossref',
  label: 'Crossref',
  category: 'literature',
  attribution: 'Crossref REST API, publisher-deposited metadata',
  docsUrl: 'https://api.crossref.org/',
  summary: 'Authoritative DOI, journal and year metadata for almost every published paper.',
  plan(query, limit) {
    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query', query);
    url.searchParams.set('rows', String(limit));
    url.searchParams.set('select', 'DOI,title,author,container-title,issued,abstract,type,URL');
    return [{ url: url.toString(), headers: jsonHeaders }];
  },
  parse(payloads) {
    const items = asArray(asRecord(asRecord(asRecord(payloads[0])?.message)?.items) ?? []);
    return items.flatMap((raw) => {
      const item = asRecord(raw);
      const doi = str(item?.DOI);
      if (!item || !doi) {
        return [];
      }
      const authors = asArray(item.author)
        .map((a) => {
          const author = asRecord(a);
          const given = str(author?.given);
          const family = str(author?.family);
          return [given, family].filter(Boolean).join(' ') || str(author?.name);
        })
        .filter(Boolean) as string[];
      const issued = asArray(asRecord(item.issued)?.['date-parts']);
      const year = num(asArray(issued[0])[0]);
      return [
        {
          id: doi,
          source: 'crossref',
          kind: 'article' as const,
          title: tidy(str(asArray(item.title)[0]), 400) ?? '(untitled)',
          authors,
          year,
          venue: str(asArray(item['container-title'])[0]),
          doi,
          url: str(item.URL) ?? `https://doi.org/${doi}`,
          abstract: tidy(str(item.abstract)),
          extra: { type: str(item.type) ?? 'unknown' },
        },
      ];
    });
  },
};

/**
 * arXiv Atom feed. Parsed with a small regex extractor instead of pulling in an XML
 * dependency; the feed shape is stable and the fields read here are flat.
 */
const arxiv: ScienceConnector = {
  id: 'arxiv',
  label: 'arXiv',
  category: 'literature',
  attribution: "arXiv.org (Cornell University), subject to arXiv's terms of use",
  docsUrl: 'https://info.arxiv.org/help/api/index.html',
  summary: 'Preprints in physics, mathematics, computer science and quantitative biology.',
  plan(query, limit) {
    const url = new URL('https://export.arxiv.org/api/query');
    url.searchParams.set('search_query', `all:${query}`);
    url.searchParams.set('max_results', String(limit));
    url.searchParams.set('sortBy', 'relevance');
    return [{ url: url.toString(), headers: { 'User-Agent': USER_AGENT } }];
  },
  parse(payloads) {
    const xml = typeof payloads[0] === 'string' ? payloads[0] : '';
    const entries = xml.split('<entry>').slice(1);
    return entries.flatMap((chunk) => {
      const pick = (tag: string): string | undefined => {
        const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(chunk);
        return match ? match[1]!.replace(/\s+/g, ' ').trim() : undefined;
      };
      const id = pick('id');
      if (!id) {
        return [];
      }
      const authors = [...chunk.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map((m) =>
        m[1]!.trim(),
      );
      return [
        {
          id: id.split('/abs/').pop() ?? id,
          source: 'arxiv',
          kind: 'preprint' as const,
          title: tidy(pick('title'), 400) ?? '(untitled)',
          authors,
          year: num(pick('published')?.slice(0, 4)),
          venue: 'arXiv',
          url: id,
          abstract: tidy(pick('summary')),
          extra: { primaryCategory: pick('arxiv:primary_category') ?? '' },
        },
      ];
    });
  },
};

/** UniProt: reviewed protein records with sequence and organism. */
const uniprot: ScienceConnector = {
  id: 'uniprot',
  label: 'UniProt',
  category: 'biomolecule',
  attribution: 'UniProt Consortium (CC BY 4.0)',
  docsUrl: 'https://www.uniprot.org/help/api',
  summary: 'Protein sequences, names, organisms and functional annotation.',
  plan(query, limit) {
    const url = new URL('https://rest.uniprot.org/uniprotkb/search');
    url.searchParams.set('query', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('size', String(limit));
    url.searchParams.set('fields', 'accession,protein_name,organism_name,sequence,length,gene_primary');
    return [{ url: url.toString(), headers: jsonHeaders }];
  },
  parse(payloads) {
    const results = asArray(asRecord(payloads[0])?.results);
    return results.flatMap((raw) => {
      const item = asRecord(raw);
      const accession = str(item?.primaryAccession);
      if (!item || !accession) {
        return [];
      }
      const proteinDescription = asRecord(item.proteinDescription);
      const recommended = asRecord(proteinDescription?.recommendedName);
      const proteinName =
        str(asRecord(recommended?.fullName)?.value) ?? str(recommended?.fullName) ?? accession;
      return [
        {
          id: accession,
          source: 'uniprot',
          kind: 'protein' as const,
          title: proteinName ?? accession,
          authors: ['UniProt Consortium'],
          venue: str(asRecord(item.organism)?.scientificName),
          url: `https://www.uniprot.org/uniprotkb/${accession}/entry`,
          extra: {
            length: num(asRecord(item.sequence)?.length) ?? 0,
            gene:
              str(asRecord(asArray(item.genes)[0])?.geneName) ??
              str(asRecord(asRecord(asArray(item.genes)[0])?.geneName)?.value) ??
              '',
          },
        },
      ];
    });
  },
};

/** ChEMBL: bioactivity records for small molecules. */
const chembl: ScienceConnector = {
  id: 'chembl',
  label: 'ChEMBL',
  category: 'chemistry',
  attribution: 'ChEMBL (EMBL-EBI), CC BY-SA 3.0',
  docsUrl: 'https://chembl.gitbook.io/chembl-interface-documentation/web-services',
  summary: 'Curated bioactivity, targets and physicochemical properties of drug-like molecules.',
  plan(query, limit) {
    const url = new URL('https://www.ebi.ac.uk/chembl/api/data/molecule/search.json');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    return [{ url: url.toString(), headers: jsonHeaders }];
  },
  parse(payloads) {
    const molecules = asArray(asRecord(payloads[0])?.molecules);
    return molecules.flatMap((raw) => {
      const item = asRecord(raw);
      const id = str(item?.molecule_chembl_id);
      if (!item || !id) {
        return [];
      }
      return [
        {
          id,
          source: 'chembl',
          kind: 'compound' as const,
          title: str(item.pref_name) ?? id,
          authors: ['ChEMBL'],
          url: `https://www.ebi.ac.uk/chembl/explore/compound/${id}`,
          extra: {
            formula: str(asRecord(item.molecule_properties)?.full_molformula) ?? '',
            weight: num(asRecord(item.molecule_properties)?.full_mwt) ?? 0,
            maxPhase: num(item.max_phase) ?? 0,
          },
        },
      ];
    });
  },
};

/** Every connector openlab ships, in the order the UI should list them. */
export const SCIENCE_CONNECTORS: readonly ScienceConnector[] = [
  pubmed,
  europePmc,
  crossref,
  arxiv,
  uniprot,
  chembl,
];

/** Look a connector up by id. */
export function findConnector(id: string): ScienceConnector | undefined {
  return SCIENCE_CONNECTORS.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------------------------

/** `Doe, J.` / `Doe, J., & Roe, R.` — the author form APA wants. */
function apaAuthors(authors: readonly string[]): string {
  const formatted = authors.map((name) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0]!;
    }
    const family = parts.pop()!;
    const initials = parts.map((p) => `${p[0]!.toUpperCase()}.`).join(' ');
    return `${family}, ${initials}`;
  });
  if (formatted.length === 0) {
    return 'Anon.';
  }
  if (formatted.length === 1) {
    return formatted[0]!;
  }
  return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
}

/** A short key usable as an in-text citation, e.g. `Watson53` or `Chembl42`. */
export function citationKey(record: ScienceRecord): string {
  const first = record.authors[0]?.split(/\s+/).pop() ?? record.id;
  const clean = first.replace(/[^A-Za-z]/g, '');
  const name = clean.length >= 3 ? clean.slice(0, 3) : clean.padEnd(3, 'x');
  return `${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()}${(record.year ?? 0) % 100}`.padEnd(
    3,
    'x',
  );
}

/**
 * Render a record as a bibliography entry.
 *
 * These are *format* helpers, not a CSL processor: they cover the three styles scientists
 * paste into manuscripts and stay readable in review. Anything more belongs in a proper
 * citation manager.
 */
export function formatCitation(record: ScienceRecord, style: CitationStyle = 'apa'): string {
  switch (style) {
    case 'bibtex': {
      const type = record.kind === 'preprint' ? 'misc' : record.kind === 'dataset' ? 'dataset' : 'article';
      const key =
        `${record.authors[0]?.split(/\s+/).pop() ?? record.source}${record.year ?? ''}${record.id}`.replace(
          /[^A-Za-z0-9:._-]/g,
          '',
        );
      const fields = [
        `  title = {${record.title}}`,
        record.authors.length ? `  author = {${record.authors.join(' and ')}}` : undefined,
        record.year ? `  year = {${record.year}}` : undefined,
        record.venue ? `  journal = {${record.venue}}` : undefined,
        record.doi ? `  doi = {${record.doi}}` : undefined,
        record.url ? `  url = {${record.url}}` : undefined,
      ].filter(Boolean);
      return `@${type}{${key},\n${fields.join(',\n')}\n}`;
    }
    case 'ris': {
      const lines = [`TY  - ${record.kind === 'preprint' ? 'UNPB' : 'JOUR'}`];
      lines.push(...record.authors.map((a) => `AU  - ${a}`));
      lines.push(`TI  - ${record.title}`);
      if (record.year) {
        lines.push(`PY  - ${record.year}`);
      }
      if (record.venue) {
        lines.push(`JO  - ${record.venue}`);
      }
      if (record.doi) {
        lines.push(`DO  - ${record.doi}`);
      }
      if (record.url) {
        lines.push(`UR  - ${record.url}`);
      }
      if (record.abstract) {
        lines.push(`AB  - ${record.abstract}`);
      }
      lines.push('ER  - ');
      return lines.join('\n');
    }
    default: {
      const authors = apaAuthors(record.authors);
      const year = record.year ? `(${record.year}).` : '(n.d.).';
      const title = record.title.replace(/\.$/, '');
      const venue = record.venue ? `*${record.venue}*.` : '';
      const doi = record.doi ? ` https://doi.org/${record.doi}` : record.url ? ` ${record.url}` : '';
      return `${authors} ${year} ${title}. ${venue}${doi}`.replace(/\s+/g, ' ').trim();
    }
  }
}
