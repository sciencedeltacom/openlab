/*---------------------------------------------------------------------------------------------
 *  openlab Science — Skill catalogue
 *
 *  A *skill* is procedural knowledge: the steps an agent should follow for a recurring
 *  research task, written so a human can read and edit it. It is deliberately not a tool —
 *  tools execute, skills decide *how* to execute.
 *
 *  openlab's addition to the format is the reproducibility **contract**. Every skill
 *  declares what it consumes, what it must produce, and how a reader can verify the result
 *  without trusting the agent. A skill whose contract cannot be satisfied is reported as
 *  incomplete rather than silently run, which is what keeps a session auditable.
 *--------------------------------------------------------------------------------------------*/

/** Grouping used by the workbench UI. */
export type ScienceSkillCategory =
  'literature' | 'data' | 'statistics' | 'reproduction' | 'writing' | 'biology' | 'chemistry';

/** What a skill guarantees about its inputs, outputs and correctness. */
export interface ScienceSkillContract {
  /** Inputs the skill cannot run without, named the way a user would say them. */
  readonly inputs: readonly string[];
  /** Artifacts the skill must leave behind. */
  readonly outputs: readonly string[];
  /** The check a reader performs to decide whether to trust the output. */
  readonly verification: string;
}

/** A single procedure in the library. */
export interface ScienceSkill {
  /** Stable kebab-case identifier used by `/skill <id>`. */
  readonly id: string;
  readonly name: string;
  readonly category: ScienceSkillCategory;
  /** One sentence: what the procedure achieves. */
  readonly summary: string;
  /** The situation that should trigger this skill instead of improvising. */
  readonly whenToUse: string;
  /** Ordered steps. Written as instructions to a careful colleague. */
  readonly steps: readonly string[];
  readonly contract: ScienceSkillContract;
  /** Connector ids from `connectors.ts` that make this skill materially better. */
  readonly connectors?: readonly string[];
  /** Statistical procedures from `stats.ts` this skill relies on. */
  readonly procedures?: readonly string[];
  /** `builtin` ships with openlab; `project` came from the user's `.openlab/skills`. */
  readonly source: 'builtin' | 'project';
}

/** Every skill openlab ships. Curated for depth over count: each one is meant to be followed. */
const BUILTIN_SKILL_DEFINITIONS: readonly Omit<ScienceSkill, 'source'>[] = [
  {
    id: 'literature-review',
    name: 'Literature review',
    category: 'literature',
    summary: 'Turn a research question into a documented, reproducible search and a synthesised answer.',
    whenToUse: 'The user asks what is known about a topic, or needs a defensible set of references.',
    steps: [
      'Restate the question as a searchable claim, then list the concepts and their synonyms.',
      'Search at least three sources with different coverage (PubMed for biomedicine, Crossref for published DOIs, arXiv for preprints) using the same concept list.',
      'Record every query verbatim with its source and date. A search you cannot re-run is not evidence.',
      'Deduplicate by DOI, then by title and year when no DOI exists; keep the surviving metadata with its source.',
      'For each retained record, extract: population, intervention or exposure, comparator, outcome, and the direction of the effect.',
      'Group by finding, not by paper. Note where studies disagree and what differs between them.',
      'State the strength of the evidence explicitly, including the searches that found nothing.',
    ],
    contract: {
      inputs: ['research question', 'inclusion and exclusion criteria'],
      outputs: [
        'references.bib or references.ris',
        'search-log.md with verbatim queries and dates',
        'synthesis.md',
      ],
      verification:
        'Re-run one logged query and confirm it returns the records cited from that source; check that every claim in the synthesis maps to a reference.',
    },
    connectors: ['pubmed', 'europepmc', 'crossref', 'arxiv'],
  },
  {
    id: 'data-quality-audit',
    name: 'Data quality audit',
    category: 'data',
    summary: 'Characterise a dataset before analysing it, without modifying the source.',
    whenToUse: 'A dataset arrives and nobody has confirmed what is actually in it.',
    steps: [
      'Treat the input files as read-only; write every derived artifact to a results directory.',
      'Report shape, column types, and per-column missingness as counts and percentages.',
      'Flag columns that are constant, near-constant, or duplicated under another name.',
      'Check ranges against the domain: negative counts, impossible dates, percentages outside 0–100.',
      'Identify the unit of observation and confirm it is not repeated across rows in a way that inflates n.',
      'Look for sentinel values masquerading as data (-999, 0 for a measurement that cannot be zero).',
      'Summarise what was found and what a downstream analysis must handle.',
    ],
    contract: {
      inputs: ['dataset path'],
      outputs: [
        'quality-report.md',
        'quality-figures/ (missingness map, distributions)',
        'audit-code that reruns clean',
      ],
      verification:
        'Compare row and column counts against the original file; confirm the input file hash is unchanged.',
    },
  },
  {
    id: 'hypothesis-test-design',
    name: 'Hypothesis test design',
    category: 'statistics',
    summary: 'Fix the question, the test and the stopping rule before touching the data.',
    whenToUse: 'An analysis is about to look at outcomes and no primary test has been declared.',
    steps: [
      'State the null and alternative hypotheses in one sentence each, naming the population and the outcome.',
      'Declare the primary outcome and the primary test. Everything else is secondary and labelled as such.',
      'Choose the test from the design: paired data uses a paired test, independent groups use Welch by default.',
      'Justify the sample size, or record explicitly that the analysis is exploratory.',
      'Declare the significance threshold and whether multiplicity correction applies to the family of tests.',
      'Write the analysis code before inspecting the outcome variable; commit it so the order is provable.',
      'Run assumption checks and state which ones failed and what was done about it.',
    ],
    contract: {
      inputs: ['outcome definition', 'grouping or pairing variable'],
      outputs: ['analysis-plan.md', 'analysis code committed before results are viewed'],
      verification:
        'Confirm the plan predates the results in version control, and that the reported test is the declared one.',
    },
    procedures: ['welch-t-test', 'paired-t-test', 'one-way-anova', 'multiple-comparisons'],
  },
  {
    id: 'reproducible-analysis',
    name: 'Reproducible analysis',
    category: 'reproduction',
    summary: 'Produce an analysis that a stranger can rerun on their own machine and get the same numbers.',
    whenToUse: 'A result will be shared, reviewed, or published.',
    steps: [
      'Pin the environment: language version, package versions, and the exact command that runs the analysis.',
      'Keep raw inputs untouched; every output is generated, never edited by hand.',
      'Set and record random seeds wherever randomness enters, including data splitting.',
      'Write paths relative to the project root so the analysis runs from a clean checkout.',
      'Emit the numbers into machine-readable files and build the prose from those files, not from copy-paste.',
      'Add one entry-point script that runs the whole pipeline end to end.',
      'Test the pipeline from a fresh clone and record how long it took.',
    ],
    contract: {
      inputs: ['analysis code', 'raw data', 'environment specification'],
      outputs: [
        'run.sh or equivalent single entry point',
        'results/ with machine-readable outputs',
        'environment lockfile',
      ],
      verification:
        'Run the entry point from a clean checkout; the produced numbers must match the reported ones exactly.',
    },
    procedures: ['descriptives'],
  },
  {
    id: 'statistical-reporting',
    name: 'Statistical reporting',
    category: 'writing',
    summary: 'Report a test so a reader can judge it without seeing the code.',
    whenToUse: 'Results exist and need to be written into a manuscript, report or slide.',
    steps: [
      'Report the test by name, the statistic, the degrees of freedom, and the exact p-value.',
      'Give the effect size with its units and its confidence interval. A p-value alone is not a result.',
      'State n per group and how missing data were handled.',
      'Report the assumptions you checked and the ones you did not.',
      'Describe the direction of the effect in words, not just its significance.',
      'For multiple tests, say which correction was used and how the family was defined.',
      'Round consistently: p to three decimals (or "< 0.001"), statistics to three significant figures.',
    ],
    contract: {
      inputs: ['test results with effect sizes and CIs', 'n per group'],
      outputs: ['results paragraph', 'table of statistics with consistent rounding'],
      verification: 'Every number in the prose must appear in the machine-readable results file.',
    },
    procedures: [
      'welch-t-test',
      'paired-t-test',
      'one-way-anova',
      'chi-square',
      'pearson-correlation',
      'linear-regression',
    ],
  },
  {
    id: 'power-analysis',
    name: 'Power analysis',
    category: 'statistics',
    summary: 'Decide how many observations are needed, or how much a finished study could have detected.',
    whenToUse: 'Planning a study, or judging whether a null result means anything.',
    steps: [
      'Fix the smallest effect size that would change the conclusion; justify it from prior work, not from convenience.',
      'Choose alpha and the target power (0.8 is a convention, not a law).',
      'Account for the design: pairing, clustering, repeated measures, and expected attrition.',
      'Compute the required n, then compute it again for the attrition-adjusted n.',
      'For a completed study, report the minimum detectable effect at the achieved n and the observed variance.',
      'State the assumption that most strongly drives the answer, since that is where the result is fragile.',
    ],
    contract: {
      inputs: ['expected effect size with justification', 'alpha', 'target power', 'design features'],
      outputs: ['power-report.md with the calculation and its inputs', 'runnable power script'],
      verification:
        'Recompute the power for the reported n and confirm it matches; vary the effect size and confirm the sensitivity reported.',
    },
  },
  {
    id: 'figure-provenance',
    name: 'Figure provenance',
    category: 'reproduction',
    summary: 'Make every figure traceable to the data and code that produced it.',
    whenToUse: 'Figures are about to be shared, submitted, or reused in a talk.',
    steps: [
      'Give each figure one generating function and one output path; no figure is edited by hand afterwards.',
      'Write the figure as a vector format for the manuscript, plus a raster copy for slides.',
      'Embed the source data as a sibling file with the same stem as the figure.',
      'Record the exact command that regenerates the figure in a manifest.',
      'Check the figure is readable in greyscale and that colour is not the only channel encoding a difference.',
      'Label axes with units and state the summary statistic in the caption (mean ± SD, median [IQR]).',
    ],
    contract: {
      inputs: ['analysis outputs'],
      outputs: [
        'figure files',
        'figure-data/ with one file per figure',
        'figure-manifest.json mapping figure → command',
      ],
      verification:
        'Delete the figure, rerun its manifest entry, and confirm the regenerated file is byte-identical.',
    },
  },
  {
    id: 'molecular-structure-prep',
    name: 'Molecular structure preparation',
    category: 'chemistry',
    summary:
      'Prepare a ligand or protein structure for docking or simulation without silent geometry errors.',
    whenToUse: 'A structure file needs to become simulation-ready input.',
    steps: [
      'Record the source structure identifier and download date so the exact input is recoverable.',
      'Inspect for missing atoms, alternate conformations, and non-standard residue names before doing anything else.',
      'Set protonation and charge states explicitly and record the pH assumption used.',
      'Remove crystallographic waters only after checking whether any are structurally required.',
      'Minimise with restraints rather than relaxing the whole structure, and compare the result to the input.',
      'Validate the prepared structure: bond lengths, chirality, and the absence of atomic clashes.',
    ],
    contract: {
      inputs: ['structure file or database identifier'],
      outputs: [
        'prepared structure',
        'preparation log with every decision and its reason',
        'validation metrics',
      ],
      verification:
        'Compare the prepared structure against the input: no atom moved beyond the declared tolerance, no stereocentre inverted.',
    },
    connectors: ['uniprot'],
  },
  {
    id: 'compound-screening',
    name: 'Compound screening',
    category: 'chemistry',
    summary: 'Filter a compound set for developability before committing to assays.',
    whenToUse: 'A list of candidate molecules needs triage.',
    steps: [
      'Normalise structures and check for salts, mixtures and duplicate scaffolds.',
      'Report physicochemical properties with the calculation method named; values differ between toolkits.',
      'Apply the declared filters (for example Lipinski or Veber) and record which rule rejected each compound.',
      'Flag structural alerts as flags, not verdicts, and cite the alert set used.',
      'Rank by the property that matters to the project, not by a generic score.',
      'Keep the rejected compounds in the output with the reason, so the filter can be audited.',
    ],
    contract: {
      inputs: ['compound list with structures'],
      outputs: ['screening table with per-compound verdicts and reasons', 'filter definitions'],
      verification:
        'Recompute the properties for three compounds by hand or with an independent toolkit and confirm they agree.',
    },
    connectors: ['chembl'],
  },
  {
    id: 'results-writeup',
    name: 'Results write-up',
    category: 'writing',
    summary: 'Draft the results section from the produced artifacts, not from memory.',
    whenToUse: 'An analysis is finished and needs to become prose.',
    steps: [
      'List every artifact the analysis produced and read them all before writing a sentence.',
      'Structure the section by question, in the order the questions were declared.',
      'For each question: what was measured, what was found, and how certain it is.',
      'Report what did not work. A failed run that changed the approach is a result.',
      'Copy every number from the machine-readable output; never retype one.',
      'Mark every claim that the data does not support and remove it.',
      'Leave interpretation to the discussion; results state what was observed.',
    ],
    contract: {
      inputs: ['machine-readable results', 'analysis plan'],
      outputs: ['results section', 'claim-to-artifact mapping for review'],
      verification: 'For each sentence containing a number, locate that number in the results files.',
    },
  },
];

/**
 * The bundled procedures, tagged as built-in.
 *
 * `source` is stamped here rather than written on every definition: it is a fact about
 * where the skill came from, not something an author should have to remember.
 */
export const BUILTIN_SCIENCE_SKILLS: readonly ScienceSkill[] = BUILTIN_SKILL_DEFINITIONS.map((skill) => ({
  ...skill,
  source: 'builtin' as const,
}));

/** Frontmatter fields recognised in a project skill file. */
const FRONTMATTER_KEYS = [
  'id',
  'name',
  'category',
  'summary',
  'whenToUse',
  'connectors',
  'procedures',
] as const;

/** Minimal `key: value` frontmatter reader; avoids a YAML dependency for a five-field format. */
function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return { fields: {}, body: raw };
  }
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep <= 0) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    const value = line
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) {
      fields[key] = value;
    }
  }
  return { fields, body: match[2] ?? '' };
}

/** Split a frontmatter list value (`["a", "b"]`, `a, b`, or `[a, b]`) into items. */
function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * Parse a project skill markdown file into a {@link ScienceSkill}.
 *
 * Contract sections are read from `## Inputs`, `## Outputs` and `## Verification`
 * headings; numbered or bulleted lines under `## Steps` become the step list.
 */
export function parseSkillMarkdown(raw: string, fallbackId = 'unnamed-skill'): ScienceSkill {
  const { fields, body } = parseFrontmatter(raw);
  const sections = new Map<string, string[]>();
  let current = 'intro';
  for (const line of body.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      current = heading[1]!.trim().toLowerCase();
      if (!sections.has(current)) {
        sections.set(current, []);
      }
      continue;
    }
    sections.get(current)?.push(line);
  }
  const lines = (name: string): string[] =>
    (
      sections.get(name) ?? [
        ...Array.from(sections.entries())
          .filter(([key]) => key.startsWith(name))
          .flatMap(([, value]) => value),
      ]
    )
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);

  const unknown = Object.keys(fields).filter((key) => !(FRONTMATTER_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    // Surfaced instead of ignored: a typo'd key silently changes skill behaviour.
    console.warn(
      `[openlabScience] skill "${fields.id ?? fallbackId}" has unknown frontmatter keys: ${unknown.join(', ')}`,
    );
  }

  const category = (fields.category ?? 'data') as ScienceSkillCategory;
  return {
    id: fields.id ?? fallbackId,
    name: fields.name ?? fields.id ?? fallbackId,
    category,
    summary: fields.summary ?? 'No summary provided.',
    whenToUse: fields.whenToUse ?? 'Use when the task matches this procedure.',
    steps: lines('steps').length > 0 ? lines('steps') : ['No steps recorded yet.'],
    contract: {
      inputs: lines('inputs'),
      outputs: lines('outputs'),
      verification: lines('verification').join(' ') || 'No verification step declared.',
    },
    connectors: parseList(fields.connectors),
    procedures: parseList(fields.procedures),
    source: 'project',
  };
}

/** Report whether a skill declares enough of a contract to be run responsibly. */
export function auditSkillContract(skill: ScienceSkill): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (skill.contract.inputs.length === 0) {
    missing.push('inputs');
  }
  if (skill.contract.outputs.length === 0) {
    missing.push('outputs');
  }
  if (/no verification step declared/i.test(skill.contract.verification)) {
    missing.push('verification');
  }
  if (skill.steps.length === 0 || /no steps recorded/i.test(skill.steps[0] ?? '')) {
    missing.push('steps');
  }
  return { complete: missing.length === 0, missing };
}

/** Bundled skills plus project skills, project entries winning on id collision. */
export function mergeScienceSkills(projectSkills: readonly ScienceSkill[]): ScienceSkill[] {
  const byId = new Map<string, ScienceSkill>();
  for (const skill of BUILTIN_SCIENCE_SKILLS) {
    byId.set(skill.id, skill);
  }
  for (const skill of projectSkills) {
    byId.set(skill.id, skill);
  }
  return [...byId.values()];
}
