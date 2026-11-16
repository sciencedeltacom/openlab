/**
 * Skills section screens.
 *
 * The skill directory maps `BUILTIN_SCIENCE_SKILLS` into catalogue entries — the list is
 * imported, never retyped, so a new bundled procedure appears here automatically. The
 * reproducibility contract decides the status: a skill whose inputs, outputs, steps or
 * verification are missing is shown as incomplete rather than silently runnable.
 *
 * Recipes are the other direction: a recurring deliverable, the input it expects, and the
 * skill that produces it.
 */

import { cn } from '@/lib/cn';
import type { CatalogEntry, ScreenSpec } from '@/components/screens/spec';
import type { RouteId } from '@/app/routes';
import { auditSkillContract, BUILTIN_SCIENCE_SKILLS, type ScienceSkill } from '@/lib/science/skills';

/* ================================================================================================
 * Project skills
 * ============================================================================================== */

/**
 * Skills that live in a project rather than the bundle.
 *
 * The same shape as a bundled skill, so they audit the same way. `grant-figure-pack` is
 * deliberately incomplete: it is the draft state a real project skill passes through, and
 * the catalogue reports exactly what it is missing.
 */
const PROJECT_SKILLS: readonly ScienceSkill[] = [];

/* ================================================================================================
 * skills
 * ============================================================================================== */

/** A short list, for a skill's inputs, outputs or dependencies. */
function List({ items, ordered }: { items: readonly string[]; ordered?: boolean }) {
  if (items.length === 0) {
    return <span className="text-muted">None declared.</span>;
  }
  return (
    <ol className={cn('flex flex-col gap-1.5 ps-4', ordered ? 'list-decimal' : 'list-disc')}>
      {items.map((item) => (
        <li key={item} className="text-body text-foreground">
          {item}
        </li>
      ))}
    </ol>
  );
}

/**
 * Turn a skill into a catalogue entry, filing it by category and auditing its contract.
 *
 * The procedure is the entry's reason to exist, so the record page carries it in full: the
 * steps in order, what it must be given, what it must leave behind and the check that decides
 * whether the result can be trusted.
 */
function skillEntry(skill: ScienceSkill): CatalogEntry {
  const audit = auditSkillContract(skill);
  const needs = [
    ...(skill.connectors ?? []).map((id) => `connector: ${id}`),
    ...(skill.procedures ?? []).map((id) => `procedure: ${id}`),
  ];
  return {
    id: skill.id,
    name: skill.name,
    summary: skill.summary,
    group: skill.category,
    tags: [...skill.contract.inputs],
    status: audit.complete
      ? { label: 'ready', tone: 'ok' }
      : { label: `missing ${audit.missing.join(', ')}`, tone: 'warn' },
    meta: [`source: ${skill.source}`, ...needs],
    detail: [
      { label: 'Use when', value: <span className="text-body text-foreground">{skill.whenToUse}</span> },
      { label: 'Procedure', value: <List ordered items={skill.steps} /> },
      { label: 'Inputs', value: <List items={skill.contract.inputs} /> },
      { label: 'Outputs', value: <List items={skill.contract.outputs} /> },
      {
        label: 'Verify',
        value: <span className="text-body text-foreground">{skill.contract.verification}</span>,
      },
      ...(needs.length > 0 ? [{ label: 'Needs', value: <List items={needs} /> }] : []),
      { label: 'Source', value: <span className="font-mono text-meta text-muted">{skill.source}</span> },
      { label: 'Run it', value: <span className="font-mono text-meta text-muted">/skill {skill.id}</span> },
    ],
  };
}

/** Every skill in the library: the bundle plus this project's own. */
const SKILL_ENTRIES: CatalogEntry[] = [...BUILTIN_SCIENCE_SKILLS, ...PROJECT_SKILLS].map(skillEntry);

/* ================================================================================================
 * skills/recipes
 * ============================================================================================== */

/** A recurring deliverable, the input it expects, and the procedure behind it. */
const RECIPE_DATA: {
  id: string;
  name: string;
  summary: string;
  deliverable: string;
  skill: string;
  inputs: string[];
}[] = [
  {
    id: 'recipe-differential-expression',
    name: 'Differential expression table',
    summary:
      'A condition comparison with effect sizes, confidence intervals and the method that produced them.',
    deliverable: 'A table plus the script and the figure that recompute it.',
    skill: 'statistical-reporting',
    inputs: ['count matrix', 'sample sheet with the contrast'],
  },
  {
    id: 'recipe-singlecell-integration',
    name: 'Single-cell integration report',
    summary: 'Batches merged with the integration method named and its assumptions checked.',
    deliverable: 'An integrated object, a UMAP and the parameter record.',
    skill: 'reproducible-analysis',
    inputs: ['per-batch objects', 'batch labels'],
  },
  {
    id: 'recipe-structure-prep',
    name: 'Structure preparation',
    summary: 'A receptor or complex cleaned, protonated and ready for docking or simulation.',
    deliverable: 'A prepared structure file and the log of what was removed.',
    skill: 'molecular-structure-prep',
    inputs: ['PDB or mmCIF entry', 'target pH'],
  },
  {
    id: 'recipe-power-analysis',
    name: 'Power analysis',
    summary: 'The sample size a design needs, with the effect size it assumed and where that came from.',
    deliverable: 'A power curve and a stated N with its assumptions.',
    skill: 'power-analysis',
    inputs: ['design', 'expected effect size or pilot SD'],
  },
  {
    id: 'recipe-reproducibility-audit',
    name: 'Reproducibility audit',
    summary: 'Every number in a claim rerun from its source, and the ones that do not match listed.',
    deliverable: 'A pass/fail table with the commands that reproduce each row.',
    skill: 'reproducible-analysis',
    inputs: ['claim or manuscript section', 'analysis folder'],
  },
  {
    id: 'recipe-figure-pack',
    name: 'Figure pack',
    summary: 'A publication figure with vector and raster exports, its source document and its provenance.',
    deliverable: 'PDF + 300 dpi PNG + the editable source.',
    skill: 'figure-provenance',
    inputs: ['data series', 'journal figure width'],
  },
  {
    id: 'recipe-dataset-release',
    name: 'Dataset release',
    summary: 'A deposit with a checksummed manifest, a licence and the fields a repository expects.',
    deliverable: 'A release folder and a metadata record.',
    skill: 'data-quality-audit',
    inputs: ['dataset folder', 'repository target'],
  },
  {
    id: 'recipe-incoming-data-audit',
    name: 'Incoming data audit',
    summary: 'What arrived: schema, missingness, duplicates and the decisions taken before analysis.',
    deliverable: 'An audit note and a cleaned copy, with the raw file untouched.',
    skill: 'data-quality-audit',
    inputs: ['raw data files', 'expected schema'],
  },
  {
    id: 'recipe-results-section',
    name: 'Results section',
    summary:
      'Prose that states what was measured, how many, and what the interval was, with no claim the data cannot carry.',
    deliverable: 'A results draft plus the table it refers to.',
    skill: 'results-writeup',
    inputs: ['analysis outputs', 'study design'],
  },
  {
    id: 'recipe-systematic-review',
    name: 'Systematic review',
    summary:
      'A question screened against a protocol, with the included records and the reason each exclusion was made.',
    deliverable: 'A review report and its screening record.',
    skill: 'literature-review',
    inputs: ['review question', 'inclusion and exclusion criteria'],
  },
];

const RECIPE_ENTRIES: CatalogEntry[] = RECIPE_DATA.map((recipe) => ({
  id: recipe.id,
  name: recipe.name,
  summary: recipe.summary,
  group: 'Deliverables',
  tags: ['recipe'],
  status: { label: 'ready', tone: 'ok' },
  meta: [`skill: ${recipe.skill}`],
  detail: [
    { label: 'Deliverable', value: recipe.deliverable },
    { label: 'Needs', value: recipe.inputs.join(' · ') },
    {
      label: 'Procedure',
      value: <span className="font-mono text-meta text-muted">/skill {recipe.skill}</span>,
    },
  ],
}));

/* ================================================================================================
 * skills — directory
 * ============================================================================================== */

/** The directory: every skill as a procedure with its contract audit. */
const SKILLS_CATALOG: ScreenSpec = {
  kind: 'catalog',
  facetLabel: 'Category',
  columns: 3,
  records: { noun: 'Skill' },
  entries: SKILL_ENTRIES,
  empty: 'No skills loaded. Skills come from the bundle and from .openlab/skills.',
};

/* ================================================================================================
 * Export
 * ============================================================================================== */

/** Skills section screens, keyed by route. */
export const skillScreens: Partial<Record<RouteId, ScreenSpec>> = {
  skills: SKILLS_CATALOG,
  'skills/recipes': {
    kind: 'catalog',
    facetLabel: 'Deliverable',
    columns: 3,
    records: { noun: 'Recipe' },
    entries: RECIPE_ENTRIES,
    empty: 'No recipes yet. Recipes are added by the lab and by installed extensions.',
  },
};
