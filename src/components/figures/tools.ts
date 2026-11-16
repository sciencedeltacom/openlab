/**
 * The studio's tools.
 *
 * A tool is what a press on the canvas does: select, pan, place a drawing, or edit a
 * structure. The rail renders this list and the canvas switches on it, so the two can never
 * disagree about what a tool is called or which shortcut reaches it.
 */

import {
  AlignLeft,
  ArrowRight,
  Binary,
  Circle,
  Frame,
  GitBranch,
  Hand,
  Hexagon,
  Minus,
  Radius,
  Shapes,
  Sigma,
  Slash,
  Square,
  Table2,
  Text as TextIcon,
  Triangle,
  type LucideIcon,
} from 'lucide-react';

export type Tool =
  | 'select'
  | 'pan'
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'line'
  | 'arrow'
  | 'bracket'
  | 'text'
  | 'math'
  | 'icon'
  | 'plot'
  | 'table'
  | 'molecule'
  | 'atom'
  | 'bond'
  | 'sequence'
  | 'mermaid';

export interface ToolMeta {
  id: Tool;
  label: string;
  icon: LucideIcon;
  /** The key that selects it, shown in the tooltip. */
  key?: string;
  group: 'navigate' | 'draw' | 'annotate' | 'panel' | 'science';
}

export const TOOLS: ToolMeta[] = [
  { id: 'select', label: 'Select', icon: Radius, key: 'v', group: 'navigate' },
  { id: 'pan', label: 'Pan', icon: Hand, key: 'h', group: 'navigate' },

  { id: 'rect', label: 'Rectangle', icon: Square, key: 'r', group: 'draw' },
  { id: 'roundRect', label: 'Panel', icon: Frame, key: 'p', group: 'draw' },
  { id: 'ellipse', label: 'Ellipse', icon: Circle, key: 'o', group: 'draw' },
  { id: 'triangle', label: 'Triangle', icon: Triangle, key: 'g', group: 'draw' },
  { id: 'line', label: 'Line', icon: Slash, key: 'l', group: 'draw' },
  { id: 'arrow', label: 'Arrow', icon: ArrowRight, key: 'a', group: 'draw' },
  { id: 'bracket', label: 'Bracket', icon: Minus, key: 'b', group: 'draw' },

  { id: 'text', label: 'Text', icon: TextIcon, key: 't', group: 'annotate' },
  { id: 'math', label: 'Equation', icon: Sigma, key: 'e', group: 'annotate' },

  { id: 'icon', label: 'Icon', icon: Shapes, key: 'i', group: 'science' },
  { id: 'plot', label: 'Plot', icon: GitBranch, key: 'c', group: 'science' },
  { id: 'table', label: 'Table', icon: Table2, key: 'x', group: 'science' },
  { id: 'molecule', label: 'Structure', icon: Hexagon, key: 'm', group: 'science' },
  { id: 'atom', label: 'Atom', icon: Circle, group: 'science' },
  { id: 'bond', label: 'Bond', icon: Slash, group: 'science' },
  { id: 'sequence', label: 'Sequence', icon: AlignLeft, key: 's', group: 'science' },
  { id: 'mermaid', label: 'Mermaid', icon: Binary, key: 'd', group: 'science' },
];

/** Tools that draw a molecule atom by atom, rather than placing a whole element. */
export const MOLECULE_TOOLS: readonly Tool[] = ['atom', 'bond'];

/** Tools that place an element, as opposed to select or pan. */
export const INSERT_TOOLS: readonly Tool[] = TOOLS.filter(
  (tool) => tool.group !== 'navigate' && !MOLECULE_TOOLS.includes(tool.id),
).map((tool) => tool.id);

/** The shortcut letter that selects a tool, if any. */
export function toolForKey(key: string): Tool | null {
  const found = TOOLS.find((tool) => tool.key === key.toLowerCase());
  return found?.id ?? null;
}
