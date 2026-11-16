/**
 * The papers a review retrieved, filterable by the decision screening gave each one.
 *
 * The decision is the review's own seed — what the model or a screener marked — so
 * `--decision include` is the set the report was written from. A paper with no decision yet
 * reads as unscreened.
 */

import { Args, Flags } from '@oclif/core';

import {
  RECOMMENDATIONS,
  RECOMMENDATION_LABEL,
  findPaper,
  findReview,
  paperMeta,
} from '@/components/literature/data';
import type { Paper, Review } from '@/components/literature/data';

import { LabCommand } from '../../lib/base';

/** The decision a review holds for a paper, or `unscreened`. */
function decision(review: Review, paper: Paper): string {
  const seed = review.seed[paper.id];
  return seed ?? 'unscreened';
}

/** A decision in the words the workspace uses. */
function decisionLabel(decision: string): string {
  return decision === 'unscreened'
    ? 'Unscreened'
    : RECOMMENDATION_LABEL[decision as keyof typeof RECOMMENDATION_LABEL];
}

export default class LiteraturePapers extends LabCommand {
  static description = 'List the papers in a review, filterable by decision';

  static args = {
    id: Args.string({ description: 'The review id', required: true }),
  };

  static flags = {
    decision: Flags.string({
      description: 'Only papers with this decision',
      options: [...RECOMMENDATIONS],
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiteraturePapers);
    await this.lab();

    const review = findReview(args.id);
    if (!review) {
      this.fail(`No review “${args.id}”. See \`openlab literature list\`.`);
    }

    const papers = review.paperIds
      .map((id) => findPaper(id))
      .filter((paper): paper is Paper => Boolean(paper))
      .filter((paper) => !flags.decision || review.seed[paper.id] === flags.decision);

    const rows = papers.map((paper) => {
      const meta = paperMeta(paper.id);
      return {
        id: paper.id,
        title: paper.title,
        year: paper.year,
        venue: paper.venue,
        decision: decisionLabel(decision(review, paper)),
        score: meta?.score ?? '',
      };
    });

    this.list(
      rows,
      [
        { key: 'id', label: 'id', width: 24, truncate: true },
        { key: 'title', label: 'title', width: 56, truncate: true },
        { key: 'year', label: 'year', align: 'right' },
        { key: 'venue', label: 'venue', width: 24, truncate: true },
        { key: 'decision', label: 'decision' },
        { key: 'score', label: 'score', align: 'right' },
      ],
      flags.decision ? `No papers marked “${flags.decision}”.` : 'This review has no papers yet.',
    );
  }
}
