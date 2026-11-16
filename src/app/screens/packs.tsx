/**
 * Domain pack screens.
 *
 * A domain pack is an integration boundary, not a core capability: something a lab
 * installs, enables and configures, and something the workbench can say honestly whether
 * is ready. The landing lists what is available; the three doc pages are the packs this
 * workspace has enabled, and they carry the domain guidance a reader needs to run them.
 */

import type { RouteId } from '@/app/routes';
import type { CatalogScreenSpec, DocScreenSpec, ScreenSpec } from '@/components/screens/spec';

/** The installable domain packs, what each adds and what it costs to run. */
const packs: CatalogScreenSpec = {
  kind: 'catalog',
  facetLabel: 'Domain',
  columns: 3,
  records: { noun: 'Pack' },
  entries: [
    {
      id: 'genomics',
      name: 'Genomics',
      summary:
        'Reads to variants to single cells, with the reference and coordinate convention carried through every handoff.',
      group: 'Genomes & sequence',
      tags: ['FASTQ', 'VCF', 'h5ad'],
      href: 'https://www.htslib.org',
    },
    {
      id: 'molecular',
      name: 'Molecular dynamics',
      summary:
        'Structures, pockets and docking, with every preparation choice versioned like code rather than remembered.',
      group: 'Structure & chemistry',
      tags: ['PDB', 'docking', 'MD'],
      href: 'https://www.gromacs.org',
    },
    {
      id: 'ml',
      name: 'Machine learning',
      summary:
        'Baselines, grouped splits and evaluation that repeats, so a model earns its complexity before it ships.',
      group: 'Modelling & statistics',
      tags: ['scikit-learn', 'PyTorch', 'GPU'],
      href: 'https://scikit-learn.org',
    },
    {
      id: 'structural-biology',
      name: 'Structural biology',
      summary:
        'Experimental structures and predicted models side by side, with density, register and missing-atom checks before any score.',
      group: 'Structure & chemistry',
      tags: ['cryo-EM', 'crystallography', 'AlphaFold'],
      href: 'https://www.rcsb.org',
    },
    {
      id: 'cheminformatics',
      name: 'Cheminformatics',
      summary:
        'Parse, standardise and describe small molecules, and keep the toolkit name on every descriptor.',
      group: 'Structure & chemistry',
      tags: ['SMILES', 'SDF', 'RDKit'],
      href: 'https://www.rdkit.org',
    },
    {
      id: 'proteomics',
      name: 'Proteomics',
      summary:
        'Raw spectra to quantified peptides, with the search engine, false-discovery threshold and batch correction on the record.',
      group: 'Omics & imaging',
      tags: ['raw spectra', 'FDR', 'quantification'],
      href: 'https://www.ebi.ac.uk/pride/',
    },
    {
      id: 'transcriptomics',
      name: 'Transcriptomics',
      summary:
        'Bulk and single-cell expression with the annotation release and normalisation stated on every contrast.',
      group: 'Genomes & sequence',
      tags: ['RNA-seq', 'single cell', 'DE'],
      href: 'https://bioconductor.org/packages/DESeq2',
    },
    {
      id: 'imaging',
      name: 'Imaging',
      summary:
        'Microscopy and plate images with the acquisition metadata, channel look-up table and scale bar kept with every measurement.',
      group: 'Omics & imaging',
      tags: ['OME-Zarr', 'segmentation', 'napari'],
      href: 'https://napari.org',
    },
    {
      id: 'epidemiology',
      name: 'Epidemiology',
      summary:
        'Cohort and registry analysis with confounding stated up front and the design fixed before the outcome is read.',
      group: 'Modelling & statistics',
      tags: ['cohort', 'survival', 'registry'],
      href: 'https://www.ohdsi.org',
    },
  ],
};

/**
 * What the genomics pack adds, and the boundaries where silent errors happen.
 *
 * Moved from the Analyze section: this is domain guidance for an enabled pack, not a core
 * product claim.
 */
const genomics: DocScreenSpec = {
  kind: 'doc',
  sections: [
    {
      id: 'path',
      title: 'What this pack adds: reference to variants to single cells',
      bullets: [
        'Reference: choose a build and an analysis set (GRCh38 no-alt), and keep the FASTA plus its index alongside the results.',
        'Reads: FASTQ → adapter trim → align → coordinate-sorted BAM or CRAM, with duplicates marked.',
        'Variants: call → normalise indels → filter → one VCF per sample set, with the caller and version recorded.',
        'Annotation: GTF/GFF for gene models, then a consequence tool; the annotation release is part of the result.',
        'Single cell: count matrix → QC → normalisation → integration → embedding and labels, written as h5ad.',
      ],
    },
    {
      id: 'reference',
      title: 'Reference before reads',
      bullets: [
        'Contig names are the interface. chr1 and 1 are different references; mixing them silently drops alignments.',
        'A no-alt analysis set is not compatible with a CRAM encoded against the full assembly: the decoder needs the exact FASTA used to write the file.',
        'A reference is immutable. A new build is a new directory, never an update in place.',
        'Gene models change between annotation releases, so a consequence can change without the variant changing.',
      ],
    },
    {
      id: 'alignments',
      title: 'Reads and alignments',
      bullets: [
        'BAM is the per-read record; a coverage track is derived from it and can always be regenerated.',
        'Mark duplicates before computing coverage, or the track carries PCR artefacts as signal.',
        'MAPQ is defined by the aligner and is not comparable across aligners; a threshold copied from a paper may be wrong for your pipeline.',
        'CRAM saves space and costs reference access: keep the exact FASTA version with the file, or the archive is unreadable.',
      ],
    },
    {
      id: 'formats',
      title: 'The formats, and what they cost',
      table: {
        columns: ['Format', 'Holds', 'Typical size'],
        rows: [
          [
            'FASTQ',
            'Reads as sequenced: bases plus per-base quality, no alignment',
            '40–100 GB gzip for 30× human WGS',
          ],
          [
            'BAM',
            'Aligned reads, coordinate-sorted with a .bai or .csi index',
            '60–90 GB for 30×; more if duplicates are kept',
          ],
          [
            'CRAM',
            'The same alignments, reference-compressed; needs the exact reference to decode',
            '30–40 GB for 30×, roughly 40% smaller than BAM',
          ],
          [
            'VCF',
            'Variants with genotypes, filters and INFO fields; text until bgzipped and indexed',
            '10 MB–1 GB per callset; gVCFs are much larger',
          ],
          [
            'BED',
            'Intervals (peaks, regions, blacklists) in 0-based half-open coordinates',
            'KB for a gene set; GB across many peak-call sets',
          ],
          [
            'GTF',
            'Gene, transcript and exon annotation; 1-based closed, so it disagrees with BED by one base',
            '~45 MB gzip for human Ensembl annotation',
          ],
          [
            'h5ad',
            'Single-cell counts with obs/var metadata and embeddings; sparse by default',
            '1–50 GB depending on cells and metadata',
          ],
          [
            'loom',
            'Single-cell counts in a fixed HDF5 layout, with no metadata convention',
            'Similar to h5ad; faster to append, harder to annotate',
          ],
        ],
      },
    },
    {
      id: 'handoffs',
      title: 'What travels between steps',
      bullets: [
        'Coordinate conventions change at every boundary: BED 0-based half-open, GTF 1-based inclusive, VCF 1-based. Convert once, at the boundary, and note it.',
        'Sort order is a contract too: coordinate-sorted and indexed, or the next tool does a linear scan or fails outright.',
        'Checksum each handoff. A truncated CRAM aligns perfectly on the first chromosome and stops early.',
        'A file without the command that produced it is an input, not an intermediate. Every intermediate names its command.',
      ],
    },
  ],
};

/**
 * What the molecular pack adds: structures, pockets, docking and properties.
 *
 * Moved from the Analyze section: domain guidance for an enabled pack.
 */
const molecular: DocScreenSpec = {
  kind: 'doc',
  sections: [
    {
      id: 'structure',
      title: 'What this pack adds: structures, pockets and docking',
      bullets: [
        'Experimental versus predicted: a crystal or cryo-EM structure is a measurement with missing atoms; an AlphaFold model is a hypothesis about a single chain.',
        'Resolution is not accuracy. A 1.8 Å structure with the sequence register wrong is worse than a 3 Å structure that fits the density.',
        'Check the construct against the sequence you care about: tags, mutations and missing loops change the pocket.',
        'B-factors say where the model is confident, not where the protein moves in solution.',
      ],
    },
    {
      id: 'prep',
      title: 'Preparation decisions are results',
      bullets: [
        'Protonation and charge are assumptions: state the pH, keep the tool output, and use the same states across engines.',
        'Waters, metals and cofactors: remove crystallographic waters only after checking whether any are structurally required.',
        'Alternate conformations and missing atoms are resolved explicitly, not averaged silently.',
        'One receptor preparation is shared by every docking run. Otherwise an engine comparison measures the preparation, not the engines.',
        'Validate the prepared structure: bond lengths, chirality, and no atomic clashes.',
      ],
    },
    {
      id: 'pockets',
      title: 'Pockets',
      bullets: [
        'A pocket is defined by a ligand, a geometry detector, or a trajectory. The definition belongs next to the pocket, not in an email.',
        'Cryptic pockets appear in one conformation and not another. A negative result in one structure is not a negative result about the protein.',
        'Rank by buriedness and volume before druggability scores; a score is an input to a decision, never the decision.',
        'A pocket found by two independent methods within 2 Å is a candidate; one method gives a hypothesis.',
      ],
    },
    {
      id: 'docking',
      title: 'Docking',
      bullets: [
        'Redock the co-crystal ligand first. An RMSD ≤ 2 Å against the experimental pose is the control; without it the scores mean nothing.',
        'The score ranks poses. It is not a binding free energy, and reporting it in kcal/mol as a Kd is a category error.',
        'Search within the pocket, not the whole protein. Exhaustiveness is a cost knob, not an accuracy knob.',
        'Report pose stability across runs and the residues that hold the pose, not just the best result of ten.',
      ],
    },
    {
      id: 'properties',
      title: 'Properties',
      bullets: [
        'Normalise first: salts, solvent, tautomers, stereochemistry. Two SMILES can be the same molecule written differently.',
        'Name the toolkit when reporting a value. logP, pKa and TPSA differ between implementations, and the number without the method is not reproducible.',
        'Descriptors filter a list; they do not establish a mechanism.',
        'Keep rejected compounds in the output with the rule that rejected them, so the filter can be audited.',
      ],
    },
    {
      id: 'code',
      title: 'RDKit and Biopython, in one pass',
      body: [
        'Ligand properties and a pocket extracted from a complex. Both are the kind of check run before a docking campaign, not after.',
      ],
      code: {
        language: 'python',
        source: `from rdkit import Chem
from rdkit.Chem import Descriptors, Lipinski, rdMolDescriptors

# Imatinib, parsed from its canonical SMILES.
mol = Chem.MolFromSmiles("Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1")
assert mol is not None, "the SMILES did not parse"

for name, value in {
    "MW": Descriptors.MolWt(mol),
    "cLogP": Descriptors.MolLogP(mol),
    "TPSA": rdMolDescriptors.CalcTPSA(mol),
    "HBD": Lipinski.NumHDonors(mol),
    "HBA": Lipinski.NumHAcceptors(mol),
    "rotatable": Lipinski.NumRotatableBonds(mol),
}.items():
    print(f"{name:10s} {value:.1f}")

# --- pocket residues: everything within 5 Å of the ligand ---------------------
from Bio.PDB import MMCIFParser, NeighborSearch, Selection

model = MMCIFParser(QUIET=True).get_structure("target", "structures/complex.cif")[0]
ligand = [res for res in Selection.unfold_entities(model, "R") if res.id[0] != " "]
protein = [atom for atom in Selection.unfold_entities(model, "A") if atom.get_parent().id[0] == " "]
search = NeighborSearch(protein)

pocket = {
    f"{atom.get_parent().get_resname()}{atom.get_parent().id[1]}"
    for ligand_residue in ligand
    for ligand_atom in ligand_residue
    for atom in search.search(ligand_atom.coord, 5.0)
}
print(sorted(pocket))`,
      },
    },
  ],
  aside: [
    {
      title: 'House rules',
      items: [
        { label: 'Source', value: 'PDB entry, recorded with the download date' },
        { label: 'Preparation', value: 'protonation at pH 7.4, waters removed after inspection' },
        { label: 'Docking control', value: 'redock the co-crystal ligand, RMSD ≤ 2 Å' },
        { label: 'Descriptors', value: 'RDKit, method named in the output' },
        { label: 'Tolerance', value: 'no atom moves beyond the declared tolerance without a note' },
      ],
    },
  ],
};

/**
 * What the machine-learning pack adds: baselines, honest splits and repeatable evaluation.
 *
 * Moved from the Analyze section: domain guidance for an enabled pack.
 */
const ml: DocScreenSpec = {
  kind: 'doc',
  sections: [
    {
      id: 'baselines',
      title: 'What this pack adds: baselines, splits and evaluation',
      bullets: [
        'The majority class, then one informative feature, then the model. Report all three in that order.',
        'A model that cannot beat the one-feature baseline has not earned its complexity, and the comparison costs one line of code.',
        'For a genomics model, the one-feature baseline is usually the strongest simple signal: mismatch count, expression of one marker, GC content.',
        'The baseline also calibrates expectations: if it scores 0.75, a model at 0.84 is a real but modest gain, not a breakthrough.',
      ],
    },
    {
      id: 'splits',
      title: 'Split honestly',
      bullets: [
        'Split by the unit that matters (donor, guide, chromosome, batch), not by row. Rows from the same unit are not independent.',
        'Freeze the holdout before the first model is trained, and let nothing except the final report touch it.',
        'Use grouped or stratified grouped folds so a guide, a donor or a batch never straddles two folds.',
        'For time-ordered data, split by time. A random split of a time series predicts the past from the future and scores beautifully.',
        'Report the split as a file, so the same folds are used by everyone and by every rerun.',
      ],
    },
    {
      id: 'evaluation',
      title: 'Evaluation that repeats',
      bullets: [
        'Report the metric with its spread across folds or seeds. A single number is a draw from a distribution you have not looked at.',
        'AUROC for ranking, a precision–recall curve when the positive class is rare, and calibration when the probability will be used.',
        'Report per-group metrics (each guide, each donor), not only the pooled number. Pooling hides the group the model fails on.',
        'For the final number, bootstrap over the evaluation set and report the interval; it is cheap and it is the number a reviewer asks for.',
        'Compare models on the same folds, with the same seeds, or the comparison measures the split.',
      ],
    },
    {
      id: 'leakage',
      title: 'Leakage, in the order it is usually found',
      bullets: [
        'Preprocessing fitted before the split: scalers, imputers, feature selection and target encoding all belong inside the fold.',
        'A feature computed from the outcome, or from a window that includes it. Check the timestamp of every column against the label.',
        'Duplicate or near-duplicate samples across folds: two guides one mismatch apart are the same experiment wearing a different index.',
        'Tuning on the holdout, once, by anyone. The holdout stops being one the first time it informs a choice.',
        'Labels derived from a feature by a rule you could write down, so the model has learned the rule, not the biology.',
      ],
    },
    {
      id: 'code',
      title: 'The evaluation, in scikit-learn',
      body: [
        'Baselines, grouped folds and preprocessing inside the pipeline. This is the shape every model comparison in the project follows.',
      ],
      code: {
        language: 'python',
        source: `import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

X = sites[["mismatches", "atac_cpm", "gc_content"]].to_numpy()
y = sites["edited"].to_numpy()
groups = sites["guide"].to_numpy()          # a guide never straddles a fold

cv = GroupKFold(n_splits=5)
models = {
    "majority": (DummyClassifier(strategy="prior"), ["mismatches"]),
    "mismatches only": (make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)), ["mismatches"]),
    "sequence + ATAC": (
        make_pipeline(StandardScaler(), GradientBoostingClassifier(random_state=0)),
        ["mismatches", "atac_cpm", "gc_content"],
    ),
}

for name, (model, columns) in models.items():
    scores = cross_val_score(model, sites[columns].to_numpy(), y, groups=groups, cv=cv, scoring="roc_auc")
    print(f"{name:16s} AUROC {scores.mean():.3f} ± {scores.std():.3f}  (5 folds, grouped by guide)")

# Preprocessing lives inside the pipeline on purpose: it is refit on every training fold,
# so the scaler never sees the fold it is scored on.`,
      },
    },
  ],
  aside: [
    {
      title: 'The rules',
      items: [
        { label: 'Baseline', value: 'majority class, then one feature' },
        { label: 'Split', value: 'grouped by guide; holdout frozen first' },
        { label: 'Scoring', value: 'AUROC with spread, calibration when probabilities matter' },
        { label: 'Seeds', value: 'recorded per run' },
        { label: 'Gate', value: 'nothing ships without beating the one-feature baseline' },
      ],
    },
  ],
};

/**
 * The catalogue and the guides, exported for the pack list and each pack's record.
 *
 * The record page reads a pack's own entry and, when one exists, its guide here, so a card
 * and its page cannot disagree and the guide has exactly one home.
 */
export const packCatalog: CatalogScreenSpec = packs;

/** The long-form guides, keyed by pack id. Only the enabled packs carry one. */
export const packGuides: Record<string, DocScreenSpec> = {
  genomics,
  molecular,
  ml,
};

/**
 * The packs route.
 *
 * The guides below are not screens: they are the long half of a pack's own record page, read
 * through `packGuides`. `packs/:packId` is the page, one of them.
 */
export const packScreens: Partial<Record<RouteId, ScreenSpec>> = { packs };
