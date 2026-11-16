/**
 * The pack list's own vocabulary.
 *
 * The catalogue in `app/screens/packs.tsx` is the source of truth for what a pack is and
 * says. This module adds only what a card needs on top of it — a family icon, the pack's own
 * mark, and the tools and skills it brings — and resolves the tool and skill names from the
 * catalogues they already live in, so a pack cannot list a tool under a name the tool page
 * does not use.
 */

import {
  Activity,
  Atom,
  BookMarked,
  Boxes,
  Brain,
  Dna,
  FlaskConical,
  Microscope,
  Sigma,
  TestTube,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { CatalogEntry, EntryTone, ScreenSpec } from '@/components/screens/spec';
import { toolCatalogScreens } from '@/app/screens/tools';
import { skillScreens } from '@/app/screens/skills';

/** A domain family's icon and tint. The family names match the catalogue's `group`. */
export const PACK_FAMILY_META: Record<string, { icon: LucideIcon; chip: string }> = {
  'Genomes & sequence': { icon: Dna, chip: 'bg-accent/15 text-accent' },
  'Structure & chemistry': { icon: Atom, chip: 'bg-warning/15 text-warning' },
  'Modelling & statistics': { icon: Sigma, chip: 'bg-success/15 text-success' },
  'Omics & imaging': { icon: Microscope, chip: 'bg-surface-tertiary text-foreground' },
};

/** Each pack's own mark, so a card is recognisable before its name is read. */
export const PACK_ICON: Record<string, LucideIcon> = {
  genomics: Dna,
  molecular: Atom,
  ml: Brain,
  'structural-biology': Boxes,
  cheminformatics: FlaskConical,
  proteomics: TestTube,
  transcriptomics: Activity,
  imaging: Microscope,
  epidemiology: Users,
};

/** The tools a pack installs, by catalogue id. */
export const PACK_TOOLS: Record<string, string[]> = {
  genomics: [
    'bwa',
    'star',
    'samtools',
    'bcftools',
    'bedtools',
    'fastqc',
    'multiqc',
    'gatk',
    'freebayes',
    'plink',
    'scanpy',
    'seurat',
    'cellranger',
    'harmony',
  ],
  molecular: ['vina', 'gromacs', 'openmm', 'pymol', 'alphafold', 'colabfold', 'rdkit', 'openbabel', 'blast'],
  ml: ['scikit-learn', 'pytorch', 'jax', 'optuna', 'mlflow', 'scipy', 'statsmodels', 'pymc'],
  'structural-biology': ['alphafold', 'colabfold', 'pymol', 'blast', 'hmmer', 'mafft', 'iqtree'],
  cheminformatics: ['rdkit', 'openbabel', 'vina', 'snakemake', 'mlflow', 'scipy'],
  proteomics: [
    'blast',
    'hmmer',
    'multiqc',
    'fastqc',
    'snakemake',
    'nextflow',
    'dvc',
    'mlflow',
    'statsmodels',
    'scipy',
  ],
  transcriptomics: [
    'star',
    'bowtie2',
    'samtools',
    'deseq2',
    'edger',
    'limma',
    'seurat',
    'scanpy',
    'harmony',
    'scvi',
    'cellranger',
  ],
  imaging: ['imagej', 'napari', 'cytoscape', 'gephi', 'igraph', 'scanpy', 'seurat', 'pytorch', 'dask'],
  epidemiology: ['plink', 'statsmodels', 'pymc', 'brms', 'scipy', 'scikit-learn', 'duckdb', 'polars'],
};

/** The skills and recipes a pack brings, by catalogue id and the list they live in. */
export const PACK_SKILLS: Record<string, { id: string; kind: 'skill' | 'recipe' }[]> = {
  genomics: [
    { id: 'recipe-differential-expression', kind: 'recipe' },
    { id: 'recipe-singlecell-integration', kind: 'recipe' },
    { id: 'reproducible-analysis', kind: 'skill' },
  ],
  molecular: [
    { id: 'recipe-structure-prep', kind: 'recipe' },
    { id: 'reproducible-analysis', kind: 'skill' },
  ],
  ml: [
    { id: 'recipe-power-analysis', kind: 'recipe' },
    { id: 'recipe-reproducibility-audit', kind: 'recipe' },
  ],
  'structural-biology': [
    { id: 'molecular-structure-prep', kind: 'skill' },
    { id: 'recipe-structure-prep', kind: 'recipe' },
    { id: 'recipe-figure-pack', kind: 'recipe' },
  ],
  cheminformatics: [
    { id: 'recipe-dataset-release', kind: 'recipe' },
    { id: 'recipe-figure-pack', kind: 'recipe' },
  ],
  proteomics: [
    { id: 'recipe-incoming-data-audit', kind: 'recipe' },
    { id: 'recipe-results-section', kind: 'recipe' },
  ],
  transcriptomics: [
    { id: 'recipe-differential-expression', kind: 'recipe' },
    { id: 'recipe-singlecell-integration', kind: 'recipe' },
    { id: 'recipe-results-section', kind: 'recipe' },
  ],
  imaging: [
    { id: 'molecular-structure-prep', kind: 'skill' },
    { id: 'recipe-figure-pack', kind: 'recipe' },
    { id: 'recipe-incoming-data-audit', kind: 'recipe' },
  ],
  epidemiology: [
    { id: 'recipe-power-analysis', kind: 'recipe' },
    { id: 'recipe-systematic-review', kind: 'recipe' },
    { id: 'recipe-results-section', kind: 'recipe' },
  ],
};

/** The catalogue entries from a spec, or an empty list for a spec that has none. */
function catalogEntries(spec: ScreenSpec | undefined): CatalogEntry[] {
  return spec && spec.kind === 'catalog' ? spec.entries : [];
}

/**
 * The tool catalogue, read when a pack asks.
 *
 * A function rather than a module constant: the catalogue is built from the runtime, which
 * includes an extension installed in this session, and reading it at import time also made
 * this module depend on the tool screen's own module finishing first.
 */
function toolEntries(): CatalogEntry[] {
  return catalogEntries(toolCatalogScreens()['tools/catalog']);
}

/** The skill and recipe catalogues, read the same way. */
const SKILL_ENTRIES = catalogEntries(skillScreens['skills']);
const RECIPE_ENTRIES = catalogEntries(skillScreens['skills/recipes']);

/** A tool's display name, falling back to its id when the catalogue has no entry. */
export function toolName(id: string): string {
  return toolEntries().find((entry) => entry.id === id)?.name ?? id;
}

/** True when the tool page knows this id; otherwise the pack row is a label, not a link. */
export function hasToolEntry(id: string): boolean {
  return toolEntries().some((entry) => entry.id === id);
}

/** A skill or recipe's display name, reading both lists. */
export function skillName(id: string): string {
  return (
    SKILL_ENTRIES.find((entry) => entry.id === id)?.name ??
    RECIPE_ENTRIES.find((entry) => entry.id === id)?.name ??
    id
  );
}

/** True when a skill or recipe has a page to open. */
export function hasSkillEntry(id: string): boolean {
  return SKILL_ENTRIES.some((entry) => entry.id === id) || RECIPE_ENTRIES.some((entry) => entry.id === id);
}

/** The icons a pack card uses beside its tool and skill counts. */
export const PACK_BRING_ICON: { tools: LucideIcon; skills: LucideIcon } = {
  tools: Wrench,
  skills: BookMarked,
};

/** The entry tone as a chip colour. */
export function toneColor(tone: EntryTone): 'success' | 'warning' | 'danger' | 'default' {
  if (tone === 'ok') return 'success';
  if (tone === 'warn') return 'warning';
  if (tone === 'danger') return 'danger';
  return 'default';
}
