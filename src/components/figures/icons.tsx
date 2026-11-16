/**
 * The icon library — a Bioicons-style catalogue.
 *
 * Every icon is a 24×24 line drawing that paints in `currentColor`, so one library serves a
 * blue cell, a grey control and a black print export without a redraw. Icons lucide already
 * ships are used as they are; the biology-specific shapes it does not (organelles, an
 * antibody, a well plate) are drawn here in the same stroke language so the set reads as one.
 *
 * The catalogue is the search surface: name, category and keywords are what the insert
 * panel matches against.
 */

import type { ReactNode } from 'react';
import {
  Activity,
  Atom,
  Banana,
  Beaker,
  Bean,
  Biohazard,
  Bird,
  Bone,
  Boxes,
  Brain,
  Bug,
  Carrot,
  Cat,
  Citrus,
  Clover,
  Dog,
  Droplet,
  Droplets,
  Ear,
  Egg,
  Eye,
  Feather,
  Fish,
  FlaskConical,
  FlaskRound,
  Flower2,
  Footprints,
  Gauge,
  Grape,
  Hand,
  Hash,
  Heart,
  HeartPulse,
  Hexagon,
  Infinity as InfinityIcon,
  Leaf,
  Magnet,
  Microscope,
  Mountain,
  Nut,
  Orbit,
  PawPrint,
  PersonStanding,
  Pill,
  Pipette,
  Radiation,
  Rabbit,
  Rocket,
  Satellite,
  Scale,
  Shell,
  Skull,
  Snowflake,
  Sprout,
  Squirrel,
  Stethoscope,
  Sun,
  Syringe,
  Telescope,
  TestTube,
  TestTubes,
  Thermometer,
  TreeDeciduous,
  TreePine,
  Users,
  Waves,
  Wheat,
  Wind,
  Worm,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type IconCategory =
  'Cell' | 'Molecular' | 'Genomics' | 'Microbes' | 'Organisms' | 'Anatomy' | 'Lab' | 'Ecology' | 'Physics';

export const ICON_CATEGORIES: readonly IconCategory[] = [
  'Cell',
  'Molecular',
  'Genomics',
  'Microbes',
  'Organisms',
  'Anatomy',
  'Lab',
  'Ecology',
  'Physics',
];

/** A drawn icon: the strokes that go inside a 24×24 `<svg>` in currentColor. */
type Draw = () => ReactNode;

export interface LibraryIcon {
  id: string;
  name: string;
  category: IconCategory;
  keywords: string[];
  source: { kind: 'lucide'; Icon: LucideIcon } | { kind: 'custom'; draw: Draw };
}

const lucide = (
  Icon: LucideIcon,
  id: string,
  name: string,
  category: IconCategory,
  keywords: string[] = [],
): LibraryIcon => ({
  id,
  name,
  category,
  keywords,
  source: { kind: 'lucide', Icon },
});

const custom = (
  draw: Draw,
  id: string,
  name: string,
  category: IconCategory,
  keywords: string[] = [],
): LibraryIcon => ({
  id,
  name,
  category,
  keywords,
  source: { kind: 'custom', draw },
});

export const LIBRARY_ICONS: LibraryIcon[] = [
  /* ---- Cell ---- */
  custom(
    () => (
      <>
        <path d="M12 3c5 0 9 3.9 9 8.6 0 5-4 9.4-9 9.4s-9-4.4-9-9.4C3 6.9 7 3 12 3Z" />
        <circle cx="12" cy="11.5" r="3.2" />
        <path d="M9.4 11.8c1.2-.9 3.4-1 5.2 0" />
      </>
    ),
    'cell',
    'Cell',
    'Cell',
    ['eukaryote', 'membrane', 'cytoplasm'],
  ),
  custom(
    () => (
      <>
        <circle cx="12" cy="12" r="8.2" />
        <circle cx="12" cy="12" r="3.4" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </>
    ),
    'nucleus',
    'Nucleus',
    'Cell',
    ['dna', 'chromatin', 'organelle'],
  ),
  custom(
    () => (
      <>
        <path d="M3 12c1.6-3.4 4-5 6.4-3.8 1.6.8 2.4 2.4 4 3 2 .8 4.2-.2 5.6-2.4" />
        <path d="M3 12c1.6 3.4 4 5 6.4 3.8 1.6-.8 2.4-2.4 4-3 2-.8 4.2.2 5.6 2.4" />
        <path d="M6 9.4c1 .8 1.4 1.6 1.2 2.6M10.4 13.6c1-.8 1.4-1.6 1.2-2.6M15 10.4c1-.8 1.4-1.6 1.2-2.6" />
      </>
    ),
    'mitochondrion',
    'Mitochondrion',
    'Cell',
    ['organelle', 'atp', 'energy', 'cristae'],
  ),
  custom(
    () => (
      <>
        <path d="M4 7.5c3 1.5 13 1.5 16 0" />
        <path d="M4 11c3 1.5 13 1.5 16 0" />
        <path d="M4 14.5c3 1.5 13 1.5 16 0" />
        <circle cx="9" cy="8.6" r="1.1" fill="currentColor" />
        <circle cx="15" cy="12.1" r="1.1" fill="currentColor" />
        <circle cx="10" cy="15.6" r="1.1" fill="currentColor" />
      </>
    ),
    'er',
    'Rough ER',
    'Cell',
    ['endoplasmic reticulum', 'ribosome', 'organelle'],
  ),
  custom(
    () => (
      <>
        <path d="M5 9c2.5-1.4 6-2 9-1.4 2.4.5 4 1.6 5 2.8" />
        <path d="M5 12.4c2.5-1.4 6-2 9-1.4 2.4.5 4 1.6 5 2.8" />
        <path d="M5 15.8c2.5-1.4 6-2 9-1.4 2.4.5 4 1.6 5 2.8" />
      </>
    ),
    'golgi',
    'Golgi',
    'Cell',
    ['apparatus', 'organelle', 'secretion'],
  ),
  custom(
    () => (
      <>
        <circle cx="12" cy="12" r="7.6" />
        <circle cx="10" cy="11" r="1.4" />
        <circle cx="14.4" cy="13.4" r="1.1" />
        <circle cx="10.6" cy="14.6" r="0.9" />
      </>
    ),
    'lysosome',
    'Lysosome',
    'Cell',
    ['organelle', 'vesicle', 'degradation'],
  ),
  custom(
    () => (
      <>
        <circle cx="6" cy="8" r="2" />
        <circle cx="18" cy="8" r="2" />
        <circle cx="6" cy="16" r="2" />
        <circle cx="18" cy="16" r="2" />
        <path d="M6 10v4M18 10v4" />
      </>
    ),
    'membrane',
    'Membrane',
    'Cell',
    ['lipid bilayer', 'phospholipid', 'receptor'],
  ),
  custom(
    () => (
      <>
        <path d="M6 10v-2a2 2 0 1 1 4 0v3a2 2 0 0 0 4 0V8a2 2 0 1 1 4 0v2" />
        <path d="M6 14v2a2 2 0 1 0 4 0v-3a2 2 0 0 1 4 0v3a2 2 0 1 0 4 0v-2" />
      </>
    ),
    'ion-channel',
    'Ion channel',
    'Cell',
    ['transport', 'pore', 'membrane protein'],
  ),
  custom(
    () => (
      <>
        <path d="M4 15h16" />
        <path d="M9 15V9a3 3 0 0 1 6 0v6" />
        <path d="M12 12h.01" />
      </>
    ),
    'receptor',
    'Receptor',
    'Cell',
    ['rtk', 'gpcr', 'signalling', 'membrane'],
  ),

  /* ---- Molecular ---- */
  custom(
    () => (
      <>
        <path d="M8 4c2 6 2 10 0 16" />
        <path d="M16 4c-2 6-2 10 0 16" />
        <path d="M9.2 7h5.6M8.6 11h6.8M9.2 15h5.6" />
      </>
    ),
    'dna',
    'DNA helix',
    'Molecular',
    ['double helix', 'genome', 'nucleotide'],
  ),
  custom(
    () => (
      <>
        <path d="M5 13c2 0 3-.6 3-1.6S7 10 5 10" />
        <path d="M5 13h14" />
        <path d="M19 11c-1.6 0-2.6.5-2.6 1.4S17.4 14 19 14" />
        <path d="M7 13v4M17 13v4" />
      </>
    ),
    'rna',
    'RNA strand',
    'Molecular',
    ['transcript', 'mrna', 'nucleotide'],
  ),
  custom(
    () => (
      <>
        <circle cx="12" cy="12" r="8.4" />
        <path d="M6 9c3 2.4 9 2.4 12 0" />
        <path d="M6 15c3-2.4 9-2.4 12 0" />
      </>
    ),
    'plasmid',
    'Plasmid',
    'Molecular',
    ['vector', 'cloning', 'circular dna'],
  ),
  custom(
    () => (
      <>
        <path d="M12 3v18" />
        <path d="M12 6l-4-3M12 6l4-3M12 12l-4-3M12 12l4-3M12 18l-4-3M12 18l4-3" />
      </>
    ),
    'chromosome',
    'Chromosome',
    'Molecular',
    ['karyotype', 'centromere', 'genome'],
  ),
  custom(
    () => (
      <>
        <path d="M12 4v16" />
        <path d="M12 8l-5-4M12 8l5-4M12 14l-5-4.6M12 14l5-4.6" />
        <circle cx="12" cy="4" r="0.9" fill="currentColor" />
      </>
    ),
    'antibody',
    'Antibody',
    'Molecular',
    ['igg', 'immunoglobulin', 'binding'],
  ),
  custom(
    () => (
      <>
        <path d="M7 5c3 3 3.4 8 0 14" />
        <path d="M17 5c-3 3-3.4 8 0 14" />
        <path d="M9.6 9h4.8M9.2 13h5.6" />
        <circle cx="7" cy="5" r="1.2" fill="currentColor" />
        <circle cx="17" cy="5" r="1.2" fill="currentColor" />
      </>
    ),
    'protein',
    'Protein',
    'Molecular',
    ['fold', 'chain', 'enzyme'],
  ),
  custom(
    () => (
      <>
        <path d="M4 12h4l2-5 3 10 2-5h5" />
        <path d="M4 5v14" />
      </>
    ),
    'enzyme',
    'Enzyme kinetics',
    'Molecular',
    ['reaction', 'rate', 'catalysis'],
  ),
  custom(
    () => (
      <>
        <path d="M5 4l14 16" />
        <path d="M5 20L19 4" />
        <path d="M8.5 10.5l3-3M12 14.5l3-3" />
      </>
    ),
    'crispr',
    'CRISPR',
    'Molecular',
    ['cas9', 'guide rna', 'editing'],
  ),
  lucide(Atom, 'atom', 'Atom', 'Molecular', ['chemistry', 'orbit', 'element']),
  lucide(Syringe, 'syringe', 'Syringe', 'Molecular', ['injection', 'dose']),

  /* ---- Genomics ---- */
  lucide(TestTube, 'test-tube', 'Test tube', 'Genomics', ['assay', 'sample']),
  lucide(TestTubes, 'test-tubes', 'Test tubes', 'Genomics', ['rack', 'assay']),
  custom(
    () => (
      <>
        <rect x="4" y="7" width="16" height="10" rx="1.6" />
        <path d="M6.6 10v4M9.3 10v4M12 10v4M14.7 10v4M17.4 10v4" />
      </>
    ),
    'gel',
    'Gel',
    'Genomics',
    ['electrophoresis', 'bands', 'blot'],
  ),
  custom(
    () => (
      <>
        <rect x="4" y="5" width="16" height="14" rx="1.6" />
        <path d="M4 11h16M4 16.5h16M9.3 5v14M14.6 5v14" />
      </>
    ),
    'well-plate',
    'Well plate',
    'Genomics',
    ['96 well', 'assay', 'plate'],
  ),
  custom(
    () => (
      <>
        <path d="M9 3v8a3 3 0 0 0 6 0V3" />
        <path d="M9 6.5h6" />
        <path d="M12 14v7" />
      </>
    ),
    'pcr-tube',
    'PCR tube',
    'Genomics',
    ['pcr', 'reaction', 'tube'],
  ),
  lucide(Hash, 'hash', 'Hash', 'Genomics', ['count', 'index']),
  lucide(Boxes, 'boxes', 'Boxes', 'Genomics', ['library', 'clones']),

  /* ---- Microbes ---- */
  custom(
    () => (
      <>
        <circle cx="12" cy="12" r="6" />
        <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />
        <circle cx="10" cy="11" r="0.8" fill="currentColor" />
        <circle cx="13.6" cy="13.4" r="0.8" fill="currentColor" />
      </>
    ),
    'virus',
    'Virus',
    'Microbes',
    ['capsid', 'envelope', 'spike', 'infection'],
  ),
  custom(
    () => (
      <>
        <rect x="3" y="9" width="16" height="6" rx="3" />
        <path d="M19 12h2" />
        <path d="M6 12h.01M8.4 12h.01" />
      </>
    ),
    'bacterium',
    'Bacterium',
    'Microbes',
    ['rod', 'prokaryote', 'microbiology'],
  ),
  custom(
    () => (
      <>
        <path d="M12 3l4 7H8l4-7Z" />
        <path d="M12 10v8" />
        <path d="M9 18h6M10 21h4" />
      </>
    ),
    'phage',
    'Bacteriophage',
    'Microbes',
    ['phage', 'capsid', 'tail'],
  ),
  lucide(Biohazard, 'biohazard', 'Biohazard', 'Microbes', ['safety', 'bsl', 'hazard']),
  lucide(Bug, 'bug', 'Microbe', 'Microbes', ['pathogen', 'insect']),

  /* ---- Organisms ---- */
  custom(
    () => (
      <>
        <path d="M6 11c0-3 2.4-5 6-5s6 2 6 5" />
        <path d="M18 11v4c0 2-2.4 3.4-6 3.4S6 17 6 15v-4" />
        <path d="M6 11c-1.2-.4-2-1.2-2-2.2 0-1.2 1-2 2-2" />
        <path d="M18 11c1.2-.4 2-1.2 2-2.2 0-1.2-1-2-2-2" />
      </>
    ),
    'mouse',
    'Mouse',
    'Organisms',
    ['mammal', 'in vivo', 'model'],
  ),
  custom(
    () => (
      <>
        <ellipse cx="12" cy="13" rx="7.5" ry="4.4" />
        <path d="M8.6 9.6L5 6M15.4 9.6L19 6" />
        <path d="M9 13h.01M15 13h.01" />
      </>
    ),
    'fly',
    'Fly',
    'Organisms',
    ['drosophila', 'model', 'insect'],
  ),
  lucide(Worm, 'worm', 'Worm', 'Organisms', ['c. elegans', 'model', 'nematode']),
  custom(
    () => (
      <>
        <path d="M3 12c3-3 6-3 9 0 3 3 6 3 9 0" />
        <path d="M21 12l-2-2M21 12l-2 2" />
        <circle cx="6.5" cy="11" r="0.9" fill="currentColor" />
      </>
    ),
    'zebrafish',
    'Zebrafish',
    'Organisms',
    ['danio', 'vertebrate', 'model'],
  ),
  custom(
    () => (
      <>
        <path d="M12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        <path d="M12 10c0-3 2-5 4-5s3 1.4 3 3" />
        <path d="M9 14.4c-1.6 0-2.6-.8-2.6-2S7.4 10 9 10" />
      </>
    ),
    'embryo',
    'Embryo',
    'Organisms',
    ['development', 'blastocyst', 'zygote'],
  ),
  lucide(Bird, 'bird', 'Bird', 'Organisms', ['avian', 'model']),
  lucide(Fish, 'fish', 'Fish', 'Organisms', ['zebrafish', 'marine']),
  lucide(Rabbit, 'rabbit', 'Rabbit', 'Organisms', ['lagomorph', 'model']),
  lucide(Cat, 'cat', 'Cat', 'Organisms', ['feline', 'model']),
  lucide(Dog, 'dog', 'Dog', 'Organisms', ['canine', 'model']),
  lucide(Squirrel, 'squirrel', 'Rodent', 'Organisms', ['rodent']),
  lucide(Shell, 'shell', 'Shell', 'Organisms', ['mollusc', 'marine']),
  lucide(Egg, 'egg', 'Egg', 'Organisms', ['oocyte', 'embryo']),

  /* ---- Anatomy ---- */
  lucide(Heart, 'heart', 'Heart', 'Anatomy', ['cardiac', 'organ']),
  lucide(HeartPulse, 'heart-pulse', 'Heart rate', 'Anatomy', ['cardiac', 'ecg', 'pulse']),
  lucide(Brain, 'brain', 'Brain', 'Anatomy', ['neuro', 'cortex']),
  lucide(Stethoscope, 'stethoscope', 'Stethoscope', 'Anatomy', ['clinical', 'exam']),
  lucide(Bone, 'bone', 'Bone', 'Anatomy', ['skeletal', 'osteo']),
  lucide(Eye, 'eye', 'Eye', 'Anatomy', ['ocular', 'vision']),
  lucide(Ear, 'ear', 'Ear', 'Anatomy', ['auditory', 'hearing']),
  lucide(Hand, 'hand', 'Hand', 'Anatomy', ['limb', 'digit']),
  lucide(Footprints, 'footprints', 'Footprints', 'Anatomy', ['gait', 'tracking']),
  lucide(PersonStanding, 'person', 'Person', 'Anatomy', ['subject', 'cohort']),
  lucide(Users, 'cohort', 'Cohort', 'Anatomy', ['subjects', 'participants']),
  lucide(Skull, 'skull', 'Skull', 'Anatomy', ['cranium', 'mortality']),
  custom(
    () => (
      <>
        <path d="M12 4c-3 0-4.6 2-4.6 4.6 0 2 1 2.8 1 4.4V17h7.2v-4c0-1.6 1-2.4 1-4.4C16.6 6 15 4 12 4Z" />
        <path d="M12 4V2.4" />
      </>
    ),
    'neurone',
    'Neuron',
    'Anatomy',
    ['synapse', 'axon', 'dendrite', 'neuro'],
  ),
  lucide(Activity, 'activity', 'Trace', 'Anatomy', ['signal', 'trace', 'time series']),
  lucide(Waves, 'waves', 'Waves', 'Anatomy', ['eeg', 'signal', 'oscillation']),

  /* ---- Lab ---- */
  lucide(Microscope, 'microscope', 'Microscope', 'Lab', ['imaging', 'microscopy']),
  lucide(FlaskConical, 'flask', 'Flask', 'Lab', ['chemistry', 'reaction']),
  lucide(FlaskRound, 'flask-round', 'Round flask', 'Lab', ['chemistry', 'solution']),
  lucide(Beaker, 'beaker', 'Beaker', 'Lab', ['chemistry', 'volume']),
  lucide(Pipette, 'pipette', 'Pipette', 'Lab', ['transfer', 'volume']),
  custom(
    () => (
      <>
        <path d="M12 3v6" />
        <rect x="8" y="9" width="8" height="6" rx="1.6" />
        <path d="M12 15v6" />
        <path d="M10.4 3h3.2" />
      </>
    ),
    'micropipette',
    'Micropipette',
    'Lab',
    ['pipette', 'volume', 'transfer'],
  ),
  custom(
    () => (
      <>
        <ellipse cx="12" cy="12" rx="9" ry="6" />
        <ellipse cx="12" cy="12" rx="6" ry="3.4" />
        <path d="M9 12h.01M15 12h.01" />
      </>
    ),
    'petri-dish',
    'Petri dish',
    'Lab',
    ['culture', 'colony', 'plate'],
  ),
  custom(
    () => (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4v8l6 3.4" />
      </>
    ),
    'centrifuge',
    'Centrifuge',
    'Lab',
    ['spin', 'pellet', 'rotor'],
  ),
  custom(
    () => (
      <>
        <rect x="7" y="3" width="10" height="13" rx="2" />
        <path d="M7 9h10" />
        <path d="M12 16v5" />
        <path d="M10 16h4" />
      </>
    ),
    'cryo-vial',
    'Cryo vial',
    'Lab',
    ['freezer', 'storage', 'sample'],
  ),
  lucide(Thermometer, 'thermometer', 'Thermometer', 'Lab', ['temperature', 'pcr']),
  lucide(Scale, 'scale', 'Scale', 'Lab', ['balance', 'mass', 'weigh']),
  lucide(Magnet, 'magnet', 'Magnet', 'Lab', ['sorting', 'beads', 'purification']),
  lucide(Gauge, 'gauge', 'Gauge', 'Lab', ['pressure', 'instrument']),
  lucide(Pill, 'pill', 'Compound', 'Lab', ['drug', 'treatment', 'dose']),

  /* ---- Ecology ---- */
  lucide(Leaf, 'leaf', 'Leaf', 'Ecology', ['plant', 'photosynthesis']),
  lucide(Sprout, 'sprout', 'Sprout', 'Ecology', ['seedling', 'growth']),
  lucide(TreeDeciduous, 'tree', 'Tree', 'Ecology', ['forest', 'canopy']),
  lucide(TreePine, 'conifer', 'Conifer', 'Ecology', ['forest', 'pine']),
  lucide(Flower2, 'flower', 'Flower', 'Ecology', ['bloom', 'pollination']),
  lucide(Clover, 'clover', 'Clover', 'Ecology', ['legume', 'nitrogen']),
  lucide(Wheat, 'wheat', 'Wheat', 'Ecology', ['crop', 'cereal']),
  lucide(Bean, 'bean', 'Bean', 'Ecology', ['legume', 'seed']),
  lucide(Nut, 'nut', 'Nut', 'Ecology', ['seed', 'kernel']),
  lucide(Carrot, 'carrot', 'Carrot', 'Ecology', ['root', 'crop']),
  lucide(Citrus, 'citrus', 'Citrus', 'Ecology', ['fruit', 'crop']),
  lucide(Grape, 'grape', 'Grape', 'Ecology', ['fruit', 'vine']),
  lucide(Banana, 'banana', 'Banana', 'Ecology', ['fruit', 'crop']),
  lucide(Feather, 'feather', 'Feather', 'Ecology', ['plumage', 'bird']),
  lucide(Mountain, 'mountain', 'Mountain', 'Ecology', ['terrain', 'field site']),
  lucide(Sun, 'sun', 'Sun', 'Ecology', ['light', 'climate']),
  lucide(Wind, 'wind', 'Wind', 'Ecology', ['air', 'ventilation']),
  lucide(Droplet, 'droplet', 'Droplet', 'Ecology', ['liquid', 'water']),
  lucide(Droplets, 'droplets', 'Droplets', 'Ecology', ['rain', 'liquid']),
  lucide(Snowflake, 'snowflake', 'Snow', 'Ecology', ['cryo', 'cold']),

  /* ---- Physics ---- */
  lucide(InfinityIcon, 'infinity', 'Infinity', 'Physics', ['limit', 'math']),
  lucide(Satellite, 'satellite', 'Satellite', 'Physics', ['orbit', 'remote sensing']),
  lucide(Telescope, 'telescope', 'Telescope', 'Physics', ['observation', 'astronomy']),
  lucide(Orbit, 'orbit', 'Orbit', 'Physics', ['electron', 'planet']),
  lucide(Rocket, 'rocket', 'Rocket', 'Physics', ['launch', 'propulsion']),
  lucide(Radiation, 'radiation', 'Radiation', 'Physics', ['decay', 'isotope']),
  lucide(Zap, 'zap', 'Bolt', 'Physics', ['energy', 'electric']),
  lucide(Hexagon, 'hexagon', 'Hexagon', 'Physics', ['lattice', 'crystal']),
  lucide(PawPrint, 'paw', 'Paw', 'Organisms', ['animal', 'tracking']),
];

/** The catalogue, by id, for the renderer. */
export const ICON_BY_ID = new Map(LIBRARY_ICONS.map((icon) => [icon.id, icon]));

/** A search over the catalogue. Empty query returns everything. */
export function searchIcons(query: string, category: IconCategory | 'All' = 'All'): LibraryIcon[] {
  const needle = query.trim().toLowerCase();
  return LIBRARY_ICONS.filter((icon) => {
    if (category !== 'All' && icon.category !== category) return false;
    if (!needle) return true;
    return (
      icon.name.toLowerCase().includes(needle) ||
      icon.id.includes(needle) ||
      icon.category.toLowerCase().includes(needle) ||
      icon.keywords.some((word) => word.toLowerCase().includes(needle))
    );
  });
}

/**
 * Draw one icon.
 *
 * The wrapper owns the 24×24 viewBox, the stroke language and the colour; the entry only
 * supplies its own geometry. A lucide icon is one component; a custom one is its strokes.
 */
export function IconGlyph({
  id,
  className,
  strokeWidth = 1.6,
}: {
  id: string;
  className?: string;
  strokeWidth?: number;
}) {
  const icon = ICON_BY_ID.get(id);
  if (!icon) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
      </svg>
    );
  }
  if (icon.source.kind === 'lucide') {
    const Icon = icon.source.Icon;
    return <Icon className={className} strokeWidth={strokeWidth} aria-hidden />;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {icon.source.draw()}
    </svg>
  );
}
