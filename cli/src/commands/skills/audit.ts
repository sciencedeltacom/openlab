/**
 * Audit every skill’s contract.
 *
 * `auditSkillContract` is the app’s own rule: a skill is complete when it declares inputs,
 * outputs, steps and a verification a reader can perform. This runs it over every skill in play
 * and lists what is incomplete, which is the state a skill is in before its author has written
 * the sections that make it auditable.
 */

import { Flags } from '@oclif/core';

import {
  auditSkillContract,
  mergeScienceSkills,
  parseSkillMarkdown,
  type ScienceSkill,
} from '@/lib/science/skills';

import { LabCommand } from '../../lib/base';
import { isDirectory, listDir, pathExists, readFile } from '../../lib/host/fs';

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

export default class SkillsAudit extends LabCommand {
  static description = 'Audit every skill’s contract and list what is incomplete';

  static flags = {
    all: Flags.boolean({ description: 'Include the skills whose contract is complete' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillsAudit);
    const lab = await this.requireLab();
    const skills = mergeScienceSkills(projectSkills(lab.root as string));
    const audited = skills
      .map((skill) => ({ skill, audit: auditSkillContract(skill) }))
      .sort((a, b) => a.skill.id.localeCompare(b.skill.id));
    const incomplete = audited.filter((entry) => !entry.audit.complete);
    const shown = flags.all ? audited : incomplete;

    this.list(
      shown.map((entry) => ({
        id: entry.skill.id,
        name: entry.skill.name,
        source: entry.skill.source,
        contract: entry.audit.complete ? 'complete' : `missing ${entry.audit.missing.join(', ')}`,
      })),
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'skill', truncate: true, width: 30 },
        { key: 'source', label: 'source' },
        { key: 'contract', label: 'contract' },
      ],
      `All ${audited.length} skills declare a complete contract.`,
    );
  }
}
