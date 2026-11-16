/**
 * Verifies the science connectors, citation formatters and skill parser with fixed fixtures.
 *
 * Run with: `bun scripts/verify-science-connectors.ts`
 *
 * The fixtures are trimmed copies of real API responses. They exist so URL construction and
 * field mapping are checked without network access and without depending on a live service.
 */
import {
  SCIENCE_CONNECTORS,
  citationKey,
  formatCitation,
  findConnector,
  type ScienceRecord,
} from '../src/lib/science/connectors.ts';
import {
  BUILTIN_SCIENCE_SKILLS,
  auditSkillContract,
  mergeScienceSkills,
  parseSkillMarkdown,
} from '../src/lib/science/skills.ts';

let failures = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    return;
  }
  failures += 1;
  console.error(`FAIL ${label}`, detail ?? '');
};

// --- every connector builds a usable plan -----------------------------------------------------
for (const connector of SCIENCE_CONNECTORS) {
  const steps = connector.plan('crispr off-target', 5);
  check(`${connector.id}: plan is non-empty`, steps.length > 0);
  check(
    `${connector.id}: urls are https`,
    steps.every((s) => s.url.startsWith('https://')),
    steps.map((s) => s.url),
  );
  check(`${connector.id}: has attribution`, connector.attribution.length > 10);
  check(`${connector.id}: has docs url`, connector.docsUrl.startsWith('https://'));
  // The query must survive encoding. URLSearchParams encodes spaces as '+'.
  check(
    `${connector.id}: query appears in the plan`,
    steps.some((s) => decodeURIComponent(s.url).replace(/\+/g, ' ').includes('crispr off-target')),
    steps.map((s) => s.url),
  );
}

check('connector lookup by id', findConnector('pubmed')?.label === 'PubMed');
check('unknown connector id returns undefined', findConnector('nope') === undefined);

// --- PubMed two-step parse --------------------------------------------------------------------
const pubmed = findConnector('pubmed')!;
const pubmedRecords = pubmed.parse([
  { esearchresult: { idlist: ['12345', '67890'] } },
  {
    result: {
      '12345': {
        title: 'A study of <b>proteins</b>  in  vitro',
        authors: [{ name: 'Doe J' }, { name: 'Roe R' }],
        pubdate: '2021 Mar 15',
        fulljournalname: 'Journal of Tests',
        articleids: [
          { idtype: 'pubmed', value: '12345' },
          { idtype: 'doi', value: '10.1/abc' },
        ],
      },
      '67890': { title: 'Second', authors: [], pubdate: '1999', source: 'J Test' },
    },
  },
]);
check('pubmed: two records parsed', pubmedRecords.length === 2, pubmedRecords.length);
check(
  'pubmed: markup stripped and whitespace collapsed',
  pubmedRecords[0]!.title === 'A study of proteins in vitro',
  pubmedRecords[0]!.title,
);
check('pubmed: authors kept in order', pubmedRecords[0]!.authors.join('|') === 'Doe J|Roe R');
check('pubmed: year extracted from pubdate', pubmedRecords[0]!.year === 2021);
check('pubmed: doi extracted', pubmedRecords[0]!.doi === '10.1/abc');
check(
  'pubmed: url is the canonical entry',
  pubmedRecords[0]!.url === 'https://pubmed.ncbi.nlm.nih.gov/12345/',
);

// --- Europe PMC parse -------------------------------------------------------------------------
const epmc = findConnector('europepmc')!;
const epmcRecords = epmc.parse([
  {
    resultList: {
      result: [
        {
          id: '999',
          pmid: '999',
          doi: '10.2/xyz',
          title: 'Open access findings',
          authorList: { author: [{ fullName: 'Ada Lovelace' }, { lastName: 'Turing' }] },
          pubYear: '2020',
          journalTitle: 'Nature Tests',
          abstractText: 'We show that <i>things</i> happen.',
          citedByCount: 12,
          isOpenAccess: 'Y',
        },
      ],
    },
  },
]);
check('europepmc: one record', epmcRecords.length === 1);
check(
  'europepmc: abstract tidied',
  epmcRecords[0]!.abstract === 'We show that things happen.',
  epmcRecords[0]!.abstract,
);
check('europepmc: full name preferred', epmcRecords[0]!.authors[0] === 'Ada Lovelace');
check('europepmc: fallback to last name', epmcRecords[0]!.authors[1] === 'Turing');
check('europepmc: cites captured', epmcRecords[0]!.extra?.citedBy === 12);
check('europepmc: oa flag captured', epmcRecords[0]!.extra?.openAccess === 'yes');

// --- Crossref parse ---------------------------------------------------------------------------
const crossref = findConnector('crossref')!;
const crossrefRecords = crossref.parse([
  {
    message: {
      items: [
        {
          DOI: '10.3/qwerty',
          title: ['A title'],
          author: [{ given: 'Grace', family: 'Hopper' }],
          'container-title': ['Computing Review'],
          issued: { 'date-parts': [[1952, 1, 1]] },
          type: 'journal-article',
          URL: 'https://doi.org/10.3/qwerty',
        },
      ],
    },
  },
]);
check('crossref: one record', crossrefRecords.length === 1);
check(
  'crossref: author assembled',
  crossrefRecords[0]!.authors[0] === 'Grace Hopper',
  crossrefRecords[0]!.authors[0],
);
check('crossref: year from date-parts', crossrefRecords[0]!.year === 1952);
check('crossref: venue from container-title', crossrefRecords[0]!.venue === 'Computing Review');

// --- arXiv Atom parse -------------------------------------------------------------------------
const arxiv = findConnector('arxiv')!;
const arxivRecords = arxiv.parse([
  `<feed>
	<entry>
		<id>http://arxiv.org/abs/2401.00001v1</id>
		<updated>2024-01-01T00:00:00Z</updated>
		<published>2024-01-01T00:00:00Z</published>
		<title>On  the   Nature of Tests</title>
		<summary>We  test things.</summary>
		<author><name>Alan Turing</name></author>
		<author><name>Alonzo Church</name></author>
		<arxiv:primary_category term="cs.LO" />
	</entry>
	</feed>`,
]);
check('arxiv: one record', arxivRecords.length === 1);
check('arxiv: title collapsed', arxivRecords[0]!.title === 'On the Nature of Tests', arxivRecords[0]!.title);
check('arxiv: both authors', arxivRecords[0]!.authors.length === 2);
check('arxiv: id is the bare number', arxivRecords[0]!.id === '2401.00001v1', arxivRecords[0]!.id);
check('arxiv: kind is preprint', arxivRecords[0]!.kind === 'preprint');

// --- UniProt parse ----------------------------------------------------------------------------
const uniprot = findConnector('uniprot')!;
const uniprotRecords = uniprot.parse([
  {
    results: [
      {
        primaryAccession: 'P12345',
        proteinDescription: { recommendedName: { fullName: { value: 'Testase' } } },
        organism: { scientificName: 'Homo sapiens' },
        sequence: { length: 321 },
        genes: [{ geneName: { value: 'TST1' } }],
      },
    ],
  },
]);
check('uniprot: one record', uniprotRecords.length === 1);
check('uniprot: protein name', uniprotRecords[0]!.title === 'Testase', uniprotRecords[0]!.title);
check('uniprot: organism as venue', uniprotRecords[0]!.venue === 'Homo sapiens');
check('uniprot: length captured', uniprotRecords[0]!.extra?.length === 321);
check('uniprot: gene captured', uniprotRecords[0]!.extra?.gene === 'TST1');

// --- ChEMBL parse -----------------------------------------------------------------------------
const chembl = findConnector('chembl')!;
const chemblRecords = chembl.parse([
  {
    molecules: [
      {
        molecule_chembl_id: 'CHEMBL1',
        pref_name: 'Testdrug',
        molecule_properties: { full_molformula: 'C9H8O4', full_mwt: '180.16' },
        max_phase: 4,
      },
    ],
  },
]);
check('chembl: one record', chemblRecords.length === 1);
check('chembl: pref name', chemblRecords[0]!.title === 'Testdrug');
check(
  'chembl: molecular weight is numeric',
  chemblRecords[0]!.extra?.weight === 180.16,
  chemblRecords[0]!.extra?.weight,
);

// --- citations --------------------------------------------------------------------------------
const sample: ScienceRecord = {
  id: '10.1/abc',
  source: 'crossref',
  kind: 'article',
  title: 'Attention is all you need.',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  year: 2017,
  venue: 'NeurIPS',
  doi: '10.1/abc',
  url: 'https://doi.org/10.1/abc',
};
const apa = formatCitation(sample, 'apa');
check('apa: family then initials', apa.includes('Vaswani, A., & Shazeer, N.'), apa);
check('apa: year in parentheses', apa.includes('(2017).'), apa);
check('apa: trailing period removed from title', apa.includes('Attention is all you need.'), apa);
check('apa: doi link appended', apa.includes('https://doi.org/10.1/abc'), apa);

const bibtex = formatCitation(sample, 'bibtex');
check('bibtex: entry type', bibtex.startsWith('@article{'), bibtex);
check(
  'bibtex: authors joined with and',
  bibtex.includes('author = {Ashish Vaswani and Noam Shazeer}'),
  bibtex,
);

const ris = formatCitation(sample, 'ris');
check('ris: starts with TY', ris.startsWith('TY  - JOUR'), ris);
check('ris: ends with ER', ris.trimEnd().endsWith('ER  -'), ris);
check('ris: one AU line per author', (ris.match(/^AU {2}- /gm) ?? []).length === 2);

check(
  'citation key uses first author family + 2-digit year',
  citationKey(sample) === 'Vas17',
  citationKey(sample),
);
check(
  'citation key pads short names',
  citationKey({ ...sample, authors: ['Li'], year: 2020 }) === 'Lix20',
  citationKey({ ...sample, authors: ['Li'], year: 2020 }),
);

// --- skills -----------------------------------------------------------------------------------
check('bundled skills are present', BUILTIN_SCIENCE_SKILLS.length >= 8, BUILTIN_SCIENCE_SKILLS.length);
check(
  'bundled skill ids are unique',
  new Set(BUILTIN_SCIENCE_SKILLS.map((s) => s.id)).size === BUILTIN_SCIENCE_SKILLS.length,
);
for (const skill of BUILTIN_SCIENCE_SKILLS) {
  const audit = auditSkillContract(skill);
  check(`skill ${skill.id}: contract complete`, audit.complete, audit.missing);
  check(`skill ${skill.id}: has steps`, skill.steps.length >= 3);
}

const parsed = parseSkillMarkdown(`---
id: lab-notebook
name: Lab notebook entry
category: writing
summary: Record a session so it can be reproduced.
whenToUse: At the end of every bench or compute session.
connectors: [pubmed, chembl]
---

## Steps
1. Write the date, operator and instrument.
2. Record the exact parameters used.

## Inputs
- raw instrument output

## Outputs
- notebook entry

## Verification
Re-run the protocol from the entry alone.
`);
check('parse: id from frontmatter', parsed.id === 'lab-notebook');
check(
  'parse: steps stripped of numbering',
  parsed.steps[0] === 'Write the date, operator and instrument.',
  parsed.steps[0],
);
check('parse: inputs read', parsed.contract.inputs[0] === 'raw instrument output');
check('parse: outputs read', parsed.contract.outputs[0] === 'notebook entry');
check(
  'parse: verification read',
  parsed.contract.verification.startsWith('Re-run the protocol'),
  parsed.contract.verification,
);
check('parse: connectors parsed as a list', parsed.connectors?.join(',') === 'pubmed,chembl');
check('parse: source is project', parsed.source === 'project');
check('parse: contract is complete', auditSkillContract(parsed).complete);

const incomplete = parseSkillMarkdown('---\nid: sketchy\n---\n\n## Steps\n- do a thing\n');
const incompleteAudit = auditSkillContract(incomplete);
check('audit: flags missing outputs', incompleteAudit.missing.includes('outputs'), incompleteAudit.missing);
check(
  'audit: flags missing verification',
  incompleteAudit.missing.includes('verification'),
  incompleteAudit.missing,
);

const merged = mergeScienceSkills([parsed]);
check(
  'merge: project skill added',
  merged.some((s) => s.id === 'lab-notebook'),
);
check(
  'merge: bundled skill retained',
  merged.some((s) => s.id === 'literature-review'),
);
const override = mergeScienceSkills([{ ...parsed, id: 'literature-review', name: 'Overridden' }]);
check(
  'merge: project overrides bundled on id collision',
  override.find((s) => s.id === 'literature-review')?.name === 'Overridden',
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: connectors, citations and skills behave as specified');
