/**
 * The workspace's systematic reviews.
 *
 * A review is one question, the protocol it was run under, and the records retrieved for it.
 * The row is what a reader needs to decide whether to open it: how far screening has got, how
 * many records were kept, and when it was last worked on.
 */

import { REVIEWS, reviewProgress, touchedLabel } from '@/components/literature/data';

import { LabCommand } from '../../lib/base';

export default class LiteratureList extends LabCommand {
  static description = 'List the workspace’s systematic reviews';

  async run(): Promise<void> {
    await this.lab();

    const rows = REVIEWS.map((review) => {
      const progress = reviewProgress(review);
      return {
        id: review.id,
        question: review.short || review.question,
        state: review.state,
        screened: `${progress.screened}/${review.total}`,
        included: String(progress.included),
        touched: touchedLabel(review),
      };
    });

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'question', label: 'question', width: 44, truncate: true },
        { key: 'state', label: 'state' },
        { key: 'screened', label: 'screened', align: 'right' },
        { key: 'included', label: 'included', align: 'right' },
        { key: 'touched', label: 'touched' },
      ],
      'No reviews yet. `openlab literature new --question "…"` opens one.',
    );
  }
}
