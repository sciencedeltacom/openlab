/**
 * Write a skill into the workspace.
 *
 * A project skill is a Markdown file under `.openlab/skills/`, the folder the app reads project
 * skills from; the same `parseSkillMarkdown` the app uses reads it back, so a file written here
 * is a procedure the Skills page and the agent both see. The procedure text is the file's body,
 * which is where its `## Steps`, `## Inputs`, `## Outputs` and `## Verification` sections live —
 * the audit is what says whether they are all there.
 */

import { Flags } from '@oclif/core';

import { auditSkillContract, parseSkillMarkdown, type ScienceSkillCategory } from '@/lib/science/skills';

import { LabCommand } from '../../lib/base';
import { pathExists, readFile, writeFile } from '../../lib/host/fs';
import * as out from '../../lib/output';

/** The categories a skill can be filed under, as `skills.ts` names them. */
const CATEGORIES: readonly ScienceSkillCategory[] = [
  'literature',
  'data',
  'statistics',
  'reproduction',
  'writing',
  'biology',
  'chemistry',
];

/** Where a workspace keeps its own skill Markdown, as `skills.ts` says project skills live. */
const PROJECT_SKILL_DIR = '.openlab/skills';

export default class SkillsNew extends LabCommand {
  static description = 'Write a skill Markdown file into the workspace';

  static flags = {
    id: Flags.string({ description: 'The skill’s kebab-case id', required: true }),
    name: Flags.string({ description: 'The skill’s display name (default: the id)' }),
    category: Flags.string({
      description: 'The category it is filed under',
      required: true,
      options: [...CATEGORIES],
    }),
    'procedure-file': Flags.string({
      description: 'A workspace file whose text becomes the skill’s procedure',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillsNew);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const id = flags.id.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      this.fail(`A skill id is lowercase kebab-case, e.g. \`figure-provenance\`, not “${id}”.`);
    }
    const path = `${PROJECT_SKILL_DIR}/${id}.md`;
    if (pathExists(path, root)) {
      this.fail(`${path} already exists; edit it in place rather than overwriting it.`);
    }

    let procedure: string;
    try {
      procedure = readFile(flags['procedure-file'], root);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }

    const body = [
      '---',
      `id: ${id}`,
      `name: ${flags.name?.trim() || id}`,
      `category: ${flags.category}`,
      '---',
      '',
      procedure.trimEnd(),
      '',
    ].join('\n');
    writeFile(path, body, root);

    const skill = parseSkillMarkdown(body, id);
    const audit = auditSkillContract(skill);
    this.emit({ path, skill, audit }, () =>
      [
        `${out.mark.ok} Wrote ${out.c.bold(path)}`,
        out.keyValues([
          ['name', skill.name],
          ['category', skill.category],
          ['steps', String(skill.steps.length)],
          [
            'contract',
            audit.complete
              ? out.mark.ok
              : `${out.mark.warn} missing ${audit.missing.join(', ')}: add those sections to the file`,
          ],
        ]),
        '',
        out.note(`Check it with \`openlab skills show ${id}\`.`),
      ].join('\n'),
    );
  }
}
