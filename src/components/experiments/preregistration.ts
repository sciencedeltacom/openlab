/**
 * Pre-registration: the plan, fixed before the data is looked at.
 *
 * An experiment's hypothesis is a claim; a pre-registration is the promise about how it will be
 * tested. The plan below is that promise: the primary outcome, the procedure, the alpha, the
 * side of the test, what is excluded, and when the run stops. It is hashed at lock time, and
 * the hash travels with the record — a plan edited afterwards no longer matches its signature,
 * which is the difference between a pre-registration and a story told after the fact.
 *
 * Nothing here decides whether a deviation is acceptable. It records the deviations, with the
 * point in the run at which they were made, and leaves the judgement to the reader.
 */

/** The procedures a plan can name; the same ids the statistics tool runs. */
export const PREREG_TESTS = [
  'descriptives',
  'welch-t-test',
  'paired-t-test',
  'one-sample-t-test',
  'one-way-anova',
  'chi-square',
  'pearson-correlation',
  'linear-regression',
] as const;

export type PreregTest = (typeof PREREG_TESTS)[number];

/** Which side of the null the test covers. */
export type PreregSide = 'two-sided' | 'greater' | 'less';

/** The decisions a plan fixes before any result exists. */
export interface PreregistrationPlan {
  hypothesis: string;
  primaryOutcome: string;
  test: PreregTest | string;
  /** The threshold a p-value is judged against, e.g. 0.05. */
  alpha: number;
  alternative: PreregSide;
  /** Rows, subjects or runs that will be left out, and on what rule. */
  exclusions: string;
  /** What would stop the run early. */
  stoppingRule: string;
  /** Anything else decided in advance: covariates, transformations, corrections. */
  analysisNotes: string;
}

/** When a decision was made, relative to seeing the results. */
export type DeviationPhase = 'before-results' | 'after-results';

/** One decision that departed from the plan, and why. */
export interface Deviation {
  id: string;
  at: number;
  /** The reader's own account of when it was made; the report shows it. */
  phase: DeviationPhase;
  /** What changed, e.g. `test: welch-t-test → one-way-anova`. */
  decision: string;
  reason: string;
  by: string;
}

/** A plan that was locked, with the signature and the deviations recorded since. */
export interface Preregistration extends PreregistrationPlan {
  lockedAt: number;
  lockedBy: string;
  /** SHA-256 of the plan and its lock, or an `fnv:` fingerprint where WebCrypto is absent. */
  hash: string;
  deviations: Deviation[];
}

/** The plan fields, without the lock or the deviations. */
export function planOf(preregistration: Preregistration): PreregistrationPlan {
  return {
    hypothesis: preregistration.hypothesis,
    primaryOutcome: preregistration.primaryOutcome,
    test: preregistration.test,
    alpha: preregistration.alpha,
    alternative: preregistration.alternative,
    exclusions: preregistration.exclusions,
    stoppingRule: preregistration.stoppingRule,
    analysisNotes: preregistration.analysisNotes,
  };
}

/**
 * The plan as one string, in a fixed field order.
 *
 * The order is the whole point: the same plan hashed twice must produce the same digest, so
 * the fields are written by hand rather than by `JSON.stringify` over an object whose key
 * order depends on how it was built.
 */
export function canonicalPlan(plan: PreregistrationPlan, lockedAt: number, lockedBy: string): string {
  return [
    `hypothesis:${plan.hypothesis.trim()}`,
    `outcome:${plan.primaryOutcome.trim()}`,
    `test:${plan.test}`,
    `alpha:${plan.alpha}`,
    `side:${plan.alternative}`,
    `exclusions:${plan.exclusions.trim()}`,
    `stopping:${plan.stoppingRule.trim()}`,
    `notes:${plan.analysisNotes.trim()}`,
    `lockedAt:${lockedAt}`,
    `lockedBy:${lockedBy}`,
  ].join('\n');
}

/** A deterministic fingerprint for the environments without WebCrypto. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** SHA-256 of the canonical plan, or the fallback fingerprint. */
export async function hashPlan(
  plan: PreregistrationPlan,
  lockedAt: number,
  lockedBy: string,
): Promise<string> {
  const text = canonicalPlan(plan, lockedAt, lockedBy);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return fnv(text);
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** True when the plan still hashes to the value written at lock time. */
export async function verifyPreregistration(preregistration: Preregistration): Promise<boolean> {
  const expected = await hashPlan(
    planOf(preregistration),
    preregistration.lockedAt,
    preregistration.lockedBy,
  );
  return expected === preregistration.hash;
}

/** One line a report can print for a deviation. */
export function deviationLine(deviation: Deviation): string {
  const when = deviation.phase === 'after-results' ? 'after results' : 'before results';
  return `${when}: ${deviation.decision}. ${deviation.reason}`;
}

/**
 * The deviation report, as Markdown.
 *
 * This is the artefact the gate exists to produce: the claim, the plan it was tested under, the
 * signature, and every decision that departed from it with when it was made. It is copied into
 * a lab notebook or a paper's methods section, so it is written to be read, not parsed.
 */
export function preregistrationReport(
  experimentId: string,
  hypothesis: string,
  preregistration: Preregistration,
  integrity: 'intact' | 'changed' | 'none',
): string {
  const lines = [
    `# Pre-registration: ${experimentId}`,
    '',
    `Hypothesis: ${hypothesis.trim()}`,
    `Primary outcome: ${preregistration.primaryOutcome.trim()}`,
    `Procedure: ${preregistration.test} · alpha ${preregistration.alpha} · ${preregistration.alternative}`,
    `Exclusions: ${preregistration.exclusions.trim() || 'none stated'}`,
    `Stopping rule: ${preregistration.stoppingRule.trim() || 'none stated'}`,
    `Other decisions: ${preregistration.analysisNotes.trim() || 'none stated'}`,
    '',
    `Locked: ${new Date(preregistration.lockedAt).toISOString()} by ${preregistration.lockedBy}`,
    `Signature (SHA-256): ${preregistration.hash}`,
    `Plan status: ${integrity === 'changed' ? 'CHANGED AFTER SIGNING' : 'intact'}`,
    '',
    `## Deviations (${preregistration.deviations.length})`,
  ];
  if (preregistration.deviations.length === 0) {
    lines.push('None. The analysis followed the plan.');
  } else {
    for (const deviation of preregistration.deviations) {
      lines.push(
        `- [${deviation.phase === 'after-results' ? 'after results' : 'before results'}] ${deviation.decision}: ${deviation.reason} (${new Date(deviation.at).toISOString()}, ${deviation.by})`,
      );
    }
  }
  return lines.join('\n');
}
