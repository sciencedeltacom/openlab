/**
 * The recipes in play.
 *
 * A recipe is a recurring deliverable plus the procedure that produces it, and the packs are
 * what carry one into a session: every `recipe-*` id in a pack's skill list is a recipe that
 * pack brings. The app’s own recipe catalogue is empty in this build, so these are the recipes
 * the packs declare rather than ones with a written deliverable behind them.
 */

import { allPacks } from '@/lib/agent/packs';

import { LabCommand } from '../../../lib/base';

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

export default class SkillsRecipesList extends LabCommand {
  static description = 'List the recipes the packs carry';

  async run(): Promise<void> {
    await this.parse(SkillsRecipesList);
    const lab = await this.lab({ root: null });
    const rows = recipes().map((recipe) => ({
      id: recipe.id,
      packs: recipe.packs.join(', '),
      open: recipe.packs.some((id) => lab.state.enabledPacks.includes(id)) ? 'open' : '',
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'packs', label: 'packs', truncate: true, width: 40 },
        { key: 'open', label: '' },
      ],
      'No recipe is carried by a pack in this build.',
    );
  }
}
