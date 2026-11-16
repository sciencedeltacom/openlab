/**
 * One skill, in full.
 *
 * A skill is procedural knowledge, and its contract is what makes it auditable: what it must be
 * given, what it must leave behind, and the check a reader performs to decide whether to trust
 * the output. All three are printed, with the procedure itself, because a skill without its
 * contract is a suggestion rather than a method.
 */

import { Args } from '@oclif/core';

import {
  auditSkillContract,
  mergeScienceSkills,
  parseSkillMarkdown,
  type ScienceSkill,
} from '@/lib/science/skills';

import { LabCommand } from '../../lib/base';
import { isDirectory, listDir, pathExists, readFile } from '../../lib/host/fs';
import * as out from '../../lib/output';

/** Where a workspace keeps its own skill Markdown, as `skills.ts` says project skills live. */
const PROJECT_SKILL_DIR = '.openlab/skills';

/** The workspace’s own skills, parsed from `.openlab/skills/*.md`. */
function projectSkills(root: string): ScienceSkill[] {
  if (!pathExists(PROJECT_SKILL_DIR, root) || !isDirectory(PROJECT_SKILL_DIR, root)) {
    return [];
  }
  return listDir(PROJECT_SKILL_DIR, root)
    .filter((entry) => !entry.isDir && entry.name.endsWith('.md'))
    .flatMap((entry) => {
      try {
        const raw = readFile(`${PROJECT_SKILL_DIR}/${entry.name}`, root);
        return [parseSkillMarkdown(raw, entry.name.replace(/\.md$/, ''))];
      } catch {
        return [];
      }
    });
}

export default class SkillsShow extends LabCommand {
  static description = 'Show one skill: its contract, inputs, outputs and procedure';

  static args = { id: Args.string({ description: 'The skill id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(SkillsShow);
    const lab = await this.requireLab();
    const skills = mergeScienceSkills(projectSkills(lab.root as string));
    const skill = skills.find((candidate) => candidate.id === args.id);
    if (!skill) {
      this.fail(`No skill “${args.id}”. See \`openlab skills list\`.`);
    }
    const audit = auditSkillContract(skill);
    const value = { ...skill, audit };

    this.emit(value, () => {
      const list = (items: readonly string[]): string[] =>
        items.length > 0
          ? items.map((item, index) => `  ${index + 1}. ${item}`)
          : [out.note('  none declared')];
      const lines = [
        out.keyValues([
          ['skill', `${out.c.bold(skill.name)}  ${out.c.grey(skill.id)}`],
          ['category', skill.category],
          ['source', skill.source],
          ['contract', audit.complete ? out.mark.ok : `${out.mark.warn} missing ${audit.missing.join(', ')}`],
          ['when', skill.whenToUse],
        ]),
        '',
        out.heading('Summary'),
        `  ${skill.summary}`,
        '',
        out.heading('Procedure'),
        ...list(skill.steps),
        '',
        out.heading('Inputs'),
        ...list(skill.contract.inputs),
        '',
        out.heading('Outputs'),
        ...list(skill.contract.outputs),
        '',
        out.heading('Verification'),
        `  ${skill.contract.verification}`,
      ];
      if (skill.connectors && skill.connectors.length > 0) {
        lines.push('', out.heading('Connectors'), ...skill.connectors.map((id) => `  ${id}`));
      }
      if (skill.procedures && skill.procedures.length > 0) {
        lines.push('', out.heading('Statistical procedures'), ...skill.procedures.map((id) => `  ${id}`));
      }
      lines.push('', out.note(`Run it with /skill ${skill.id}.`));
      return lines.join('\n');
    });
  }
}
