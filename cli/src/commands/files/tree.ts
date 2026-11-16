/**
 * The workspace as a tree.
 *
 * `.git`, `node_modules` and build output are left out unless `--all`, because a tree that
 * includes them is a tree nobody reads. `--depth` bounds the walk so a large checkout cannot
 * flood the terminal.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { listDir } from '../../lib/host/fs';
import * as out from '../../lib/output';

/** Folders a tree leaves out unless `--all` was asked for. */
const SKIP = ['.git', 'node_modules', 'target', 'dist', '.venv'];

/** One node of the tree, as the renderer and the JSON both read it. */
interface Node {
  name: string;
  type: 'dir' | 'file' | 'symlink';
  size: number;
  children?: Node[];
}

/** Walk a folder into nodes, stopping at `depth` levels below it. */
function build(path: string, root: string, depth: number, all: boolean): Node[] {
  return listDir(path, root)
    .filter((entry) => all || !entry.name.startsWith('.'))
    .filter((entry) => all || !(entry.isDir && SKIP.includes(entry.name)))
    .map((entry) => {
      const node: Node = {
        name: entry.name,
        type: entry.isSymlink ? 'symlink' : entry.isDir ? 'dir' : 'file',
        size: entry.isDir ? 0 : entry.size,
      };
      if (entry.isDir && depth > 0) {
        node.children = build(entry.path, root, depth - 1, all);
      }
      return node;
    });
}

/** The box-drawing lines for a set of nodes. */
function render(nodes: readonly Node[], prefix = ''): string[] {
  const lines: string[] = [];
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1;
    const label =
      node.type === 'dir'
        ? out.c.bold(out.c.cyan(`${node.name}/`))
        : node.type === 'symlink'
          ? out.c.magenta(`${node.name}@`)
          : node.name;
    lines.push(`${prefix}${last ? '└── ' : '├── '}${label}`);
    if (node.children) {
      lines.push(...render(node.children, `${prefix}${last ? '    ' : '│   '}`));
    }
  });
  return lines;
}

export default class FilesTree extends LabCommand {
  static description = 'Show the workspace as a tree';

  static args = {
    path: Args.string({ description: 'The folder to start from (default: the lab root)' }),
  };

  static flags = {
    depth: Flags.integer({
      char: 'd',
      description: 'How deep to descend; 0 lists only the top level',
      default: 3,
    }),
    all: Flags.boolean({ char: 'a', description: 'Include dotfiles, .git, node_modules and build output' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FilesTree);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const path = args.path ?? '.';

    const tree = build(path, root, Math.max(0, flags.depth), flags.all);
    this.emit(tree, (nodes) => [out.c.bold(this.short(root)), ...render(nodes)].join('\n'));
  }
}
