/**
 * Workspace icons.
 *
 * A workspace wears an icon rather than a colour dot: a glyph says what it is at a glance
 * and survives a colour-blind reader. The store keeps the icon's *name*, so a page can draw
 * it without importing the catalogue and old data maps cleanly.
 */

import {
  Atom,
  Beaker,
  Binary,
  Boxes,
  Brain,
  Bug,
  Compass,
  Cpu,
  Dna,
  FlaskConical,
  Globe,
  Hexagon,
  Leaf,
  Magnet,
  Microscope,
  Orbit,
  Rocket,
  Sigma,
  Star,
  Telescope,
  TestTube,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Every icon a workspace can wear. */
const ICONS: Record<string, LucideIcon> = {
  atom: Atom,
  beaker: Beaker,
  binary: Binary,
  boxes: Boxes,
  brain: Brain,
  bug: Bug,
  compass: Compass,
  cpu: Cpu,
  dna: Dna,
  flask: FlaskConical,
  globe: Globe,
  leaf: Leaf,
  magnet: Magnet,
  microscope: Microscope,
  orbit: Orbit,
  rocket: Rocket,
  sigma: Sigma,
  star: Star,
  telescope: Telescope,
  testtube: TestTube,
  waves: Waves,
  zap: Zap,
};

/** Every icon name, for the picker. */
export const PROJECT_ICON_NAMES: readonly string[] = Object.keys(ICONS);

const NAMES = PROJECT_ICON_NAMES;

/** The icon for a workspace, falling back to a hexagon for anything unknown. */
export function projectIcon(name: string | undefined): LucideIcon {
  return (name ? ICONS[name] : undefined) ?? Hexagon;
}

/** A fresh icon for a new workspace. */
export function randomProjectIcon(): string {
  return NAMES[Math.floor(Math.random() * NAMES.length)] ?? 'hexagon';
}

/** A stable icon for a workspace that predates icons, derived from its id. */
export function iconForId(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return NAMES[Math.abs(hash) % NAMES.length] ?? 'hexagon';
}
