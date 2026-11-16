/**
 * Molecule editing.
 *
 * A structure is atoms with coordinates and bonds between them — the model Ketcher and every
 * other 2D editor uses. These are the operations a click performs on that model: place an
 * atom, bond two, cycle a bond's order. Nothing here lays a structure out: the user places
 * the atoms, which is what a chemist expects from a drawing tool.
 */

import { moleculeExtent, uid, type Atom, type Bond, type MoleculeElement } from './types';

/** The elements the atom palette offers, in the order a chemist reaches for them. */
export const ATOM_ELEMENTS: readonly string[] = [
  'C',
  'N',
  'O',
  'S',
  'P',
  'F',
  'Cl',
  'Br',
  'I',
  'B',
  'Si',
  'Na',
  'K',
  'Mg',
  'Ca',
  'Fe',
  'Zn',
];

/** A point in the molecule's local coordinates for an artboard point. */
export function toLocal(element: MoleculeElement, x: number, y: number): { x: number; y: number } {
  return { x: x - element.x, y: y - element.y };
}

/** The nearest atom within `radius` of a local point, or null. */
export function nearestAtom(element: MoleculeElement, x: number, y: number, radius = 22): Atom | null {
  let best: Atom | null = null;
  let bestDistance = radius;
  for (const atom of element.atoms) {
    const distance = Math.hypot(atom.x - x, atom.y - y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = atom;
    }
  }
  return best;
}

/** The nearest bond within `radius` of a local point, or null. */
export function nearestBond(element: MoleculeElement, x: number, y: number, radius = 10): Bond | null {
  const byId = new Map(element.atoms.map((atom) => [atom.id, atom]));
  let best: Bond | null = null;
  let bestDistance = radius;
  for (const bond of element.bonds) {
    const a = byId.get(bond.a);
    const b = byId.get(bond.b);
    if (!a || !b) continue;
    const distance = pointSegmentDistance(x, y, a.x, a.y, b.x, b.y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = bond;
    }
  }
  return best;
}

function pointSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Re-house a set of atoms in a box that hugs them.
 *
 * The local coordinates are shifted so the artboard position of every atom is unchanged and
 * the box origin moves instead — adding an atom near an edge extends the element rather than
 * sliding everything already drawn.
 */
function normalize(element: MoleculeElement, atoms: Atom[]): MoleculeElement {
  const extent = moleculeExtent(atoms);
  return {
    ...element,
    atoms: atoms.map((atom) => ({ ...atom, x: atom.x - extent.x, y: atom.y - extent.y })),
    x: element.x + extent.x,
    y: element.y + extent.y,
    w: extent.w,
    h: extent.h,
  };
}

/** Add an atom at a local point. */
export function addAtom(element: MoleculeElement, x: number, y: number, el: string): MoleculeElement {
  const atom: Atom = { id: uid(), el, x: Math.round(x), y: Math.round(y), charge: 0 };
  return normalize(element, [...element.atoms, atom]);
}

/** Remove an atom and every bond that touched it. */
export function removeAtom(element: MoleculeElement, id: string): MoleculeElement {
  const atoms = element.atoms.filter((atom) => atom.id !== id);
  const bonds = element.bonds.filter((bond) => bond.a !== id && bond.b !== id);
  return normalize({ ...element, bonds }, atoms);
}

/** Add a bond, or cycle the order of the one that is already there. */
export function toggleBond(element: MoleculeElement, a: string, b: string): MoleculeElement {
  const existing = element.bonds.find(
    (bond) => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a),
  );
  if (existing) {
    if (existing.order === 3) {
      // Three is the last order; the next click removes the bond.
      return { ...element, bonds: element.bonds.filter((bond) => bond.id !== existing.id) };
    }
    return {
      ...element,
      bonds: element.bonds.map((bond) =>
        bond.id === existing.id ? { ...bond, order: (bond.order + 1) as 1 | 2 | 3 } : bond,
      ),
    };
  }
  return { ...element, bonds: [...element.bonds, { id: uid(), a, b, order: 1 }] };
}

/** Cycle one bond's order in place. */
export function cycleBond(element: MoleculeElement, id: string): MoleculeElement {
  return {
    ...element,
    bonds: element.bonds.map((bond) =>
      bond.id === id ? { ...bond, order: bond.order === 3 ? 1 : ((bond.order + 1) as 1 | 2 | 3) } : bond,
    ),
  };
}
