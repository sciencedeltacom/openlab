/**
 * The science skills in play.
 *
 * The bundled procedures merged with the workspace’s own — the app’s `mergeScienceSkills`, so a
 * skill written into `.openlab/skills` appears here the moment it is read. Rows are ordered by
 * category so the list reads as the groups the Skills page shows.
 */

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
        // A file that cannot be read is not a skill; the audit is the place that says so.
        return [];
      }
    });
}

export default class SkillsList extends LabCommand {
  static description = 'List the science skills in play, bundled and project-local';

  async run(): Promise<void> {
    await this.parse(SkillsList);
    const lab = await this.requireLab();
    const skills = mergeScienceSkills(projectSkills(lab.root as string)).sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
    const rows = skills.map((skill) => {
      const audit = auditSkillContract(skill);
      return {
        id: skill.id,
        name: skill.name,
        category: skill.category,
        source: skill.source,
        contract: audit.complete ? 'ready' : `missing ${audit.missing.join(', ')}`,
      };
    });

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'skill', truncate: true, width: 30 },
        { key: 'category', label: 'category' },
        { key: 'source', label: 'source' },
        { key: 'contract', label: 'contract' },
      ],
      'No skills loaded.',
    );
  }
}
