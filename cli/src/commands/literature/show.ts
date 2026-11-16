/**
 * One systematic review in full.
 *
 * It shows what the review is, the protocol it was run under, every record with its screening
 * decision and score, the extraction the model read off each one, and the report it ended on.
 * A review whose run never wrote a report has none to show, and says so rather than printing a
 * blank one.
 */

import { Args } from '@oclif/core';

import {
  EXTRACTION_FIELDS,
  RECOMMENDATION_LABEL,
  contentOf,
  findPaper,
  findReview,
  paperMeta,
  reviewProgress,
  touchedLabel,
} from '@/components/literature/data';
import type { Paper, Review } from '@/components/literature/data';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** The decision a review holds for a paper, in words. */
function decision(review: Review, paper: Paper): string {
  const seed = review.seed[paper.id];
  return seed ? RECOMMENDATION_LABEL[seed] : 'Unscreened';
}

export default class LiteratureShow extends LabCommand {
  static description = 'Show one systematic review: its papers, decisions, extraction and report';

  static args = {
    id: Args.string({ description: 'The review id', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(LiteratureShow);
    await this.lab();

    const review = findReview(args.id);
    if (!review) {
      this.fail(`No review “${args.id}”. See \`openlab literature list\`.`);
    }

    const progress = reviewProgress(review);
    const content = contentOf(review);
    const papers = review.paperIds
      .map((id) => findPaper(id))
      .filter((paper): paper is Paper => Boolean(paper));

    this.emit({ review, progress, papers, content: content ?? null }, () => {
      const lines = [
        out.heading(review.short || review.question),
        out.keyValues([
          ['id', review.id],
          ['question', review.question],
          ['state', review.state],
          ['records', String(review.total)],
          ['screened', `${progress.screened} (${progress.included} included, ${progress.excluded} excluded)`],
          ['touched', touchedLabel(review)],
        ]),
        '',
        out.heading('Protocol'),
        ...review.protocol.map((fact) => `  ${out.c.grey(fact.label)}  ${fact.value}`),
      ];

      lines.push('', out.heading('Papers'));
      if (papers.length === 0) {
        lines.push(out.note('  no records registered yet.'));
      } else {
        lines.push(
          out.table(papers, [
            { key: 'id', label: 'id', width: 24, truncate: true },
            { key: 'title', label: 'title', width: 50, truncate: true },
            { key: 'year', label: 'year', align: 'right' },
            { key: 'venue', label: 'venue', width: 24, truncate: true },
            { key: 'decision', label: 'decision', format: (paper) => decision(review, paper) },
            {
              key: 'score',
              label: 'score',
              align: 'right',
              format: (paper) => String(paperMeta(paper.id)?.score ?? ''),
            },
          ]),
        );
      }

      const extracted = papers.filter((paper) =>
        EXTRACTION_FIELDS.some((field) => paper.extraction[field.key]?.value),
      );
      if (extracted.length > 0) {
        lines.push('', out.heading('Extraction'));
        for (const paper of extracted) {
          lines.push(`  ${out.c.bold(paper.title)}`);
          for (const field of EXTRACTION_FIELDS) {
            const value = paper.extraction[field.key]?.value;
            if (value) lines.push(`    ${out.c.grey(field.label)}  ${value}`);
          }
        }
      }

      lines.push('', out.heading('Report'));
      const body = content?.report.body ?? content?.report.summary;
      lines.push(body ? body : out.note('  no report yet. Run the review.'));
      return lines.join('\n');
    });
  }
}
