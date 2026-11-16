/**
 * One recipe.
 *
 * The packs that carry it, and whether any of them is open. A recipe in the app’s catalogue
 * would also name its deliverable, the input it expects and the skill that produces it; that
 * catalogue is empty in this build, so this says so rather than inventing a procedure.
 */

import { Args } from '@oclif/core';

import { allPacks, findPack } from '@/lib/agent/packs';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** Every recipe id the packs carry, with the packs that bring it. */
function recipes(): { id: string; packs: string[] }[] {
  const byId = new Map<string, string[]>();
  for (const pack of allPacks()) {
    for (const id of pack.skills) {
      if (!id.startsWith('recipe-')) continue;
      byId.set(id, [...(byId.get(id) ?? []), pack.id]);
    }
  }
  return [...byId.entries()].map(([id, packs]) => ({ id, packs })).sort((a, b) => a.id.localeCompare(b.id));
}

export default class SkillsRecipesShow extends LabCommand {
  static description = 'Show one recipe and the packs that carry it';

  static args = { id: Args.string({ description: 'The recipe id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(SkillsRecipesShow);
    const lab = await this.lab({ root: null });
    const recipe = recipes().find((candidate) => candidate.id === args.id);
    if (!recipe) {
      this.fail(`No recipe “${args.id}”. See \`openlab skills recipes list\`.`);
    }
    const packs = recipe.packs.map((id) => ({
      id,
      name: findPack(id)?.name ?? id,
      open: lab.state.enabledPacks.includes(id),
    }));
    const value = { ...recipe, packs };

    this.emit(value, () => {
      const lines = [
        out.keyValues([
          ['recipe', out.c.bold(recipe.id)],
          ['open', packs.some((pack) => pack.open) ? 'yes' : out.c.grey('no pack carrying it is open')],
        ]),
        '',
        out.heading('Carried by'),
        ...packs.map(
          (pack) => `  ${pack.name}  ${out.c.grey(pack.id)}${pack.open ? `  ${out.mark.ok}` : ''}`,
        ),
        '',
        out.note(
          'This build’s recipe catalogue carries no entry for it, so the deliverable it produces, the input it expects and the skill behind it are not written down yet.',
        ),
      ];
      return lines.join('\n');
    });
  }
}
