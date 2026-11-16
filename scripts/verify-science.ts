/**
 * Cross-checks the openlab Science statistics engine against SciPy on fixed fixtures.
 *
 * Run with: `bun scripts/verify-science.ts`
 *
 * The values are asserted against `scripts/science-reference.json`, a snapshot produced by
 * `scripts/verify-science.py` (SciPy). That makes the gate runnable with nothing installed
 * beyond Bun, while the oracle stays reproducible: regenerate the snapshot with
 * `python3 scripts/compare-science.py` and commit it.
 *
 * One `key=value` line per statistic is still printed, which is what the oracle diffs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  adjustPValues,
  anovaOneWay,
  chiSquareTest,
  describe,
  fCdf,
  incompleteBeta,
  linearRegression,
  logGamma,
  normalCdf,
  normalQuantile,
  pearsonCorrelation,
  tCdf,
  tQuantile,
  tTwoTailed,
  welchTTest,
} from '../src/lib/science/stats.ts';

const A = [12.1, 11.4, 13.8, 12.9, 14.2, 13.1, 12.6, 13.9, 12.2, 13.4];
const B = [10.2, 9.8, 11.1, 10.6, 11.9, 10.1, 10.8, 11.3, 9.9, 10.4];
const X = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const Y = [2.3, 4.1, 6.2, 7.9, 10.4, 11.8, 14.1, 15.9, 18.2, 20.1];
const G1 = [5.1, 5.6, 4.9, 5.3, 5.8, 5.2];
const G2 = [6.4, 6.9, 6.1, 6.6, 7.0, 6.3];
const G3 = [7.8, 8.2, 7.5, 8.0, 8.4, 7.7];

const out: string[] = [];
const push = (key: string, value: number | string) =>
  out.push(`${key}=${typeof value === 'number' ? value.toExponential(10) : value}`);

// --- special functions -----------------------------------------------------------------------
push('logGamma.1', logGamma(1));
push('logGamma.5', logGamma(5));
push('logGamma.0.5', logGamma(0.5));
push('incompleteBeta.0.5.2.3', incompleteBeta(0.5, 2, 3));
push('normalCdf.1.96', normalCdf(1.96));
push('normalCdf.-1.96', normalCdf(-1.96));
push('normalQuantile.0.975', normalQuantile(0.975));
push('tCdf.2.228.10', tCdf(2.228138852, 10));
push('tTwoTailed.2.228138852.10', tTwoTailed(2.228138852, 10));
push('tQuantile.0.95.10', tQuantile(0.95, 10));
push('fCdf.4.256495.2.9', fCdf(4.256494729, 2, 9));

// --- descriptives ----------------------------------------------------------------------------
const d = describe(A);
push('describe.mean', d.values.mean);
push('describe.sd', d.values.sd);
push('describe.se', d.values.se);
push('describe.median', d.values.median);
push('describe.q1', d.values.q1);
push('describe.q3', d.values.q3);
push('describe.skewness', d.values.skewness);
push('describe.kurtosis', d.values.kurtosis);
push('describe.ci.low', d.values.ci[0]);
push('describe.ci.high', d.values.ci[1]);

// --- t tests ---------------------------------------------------------------------------------
const w = welchTTest(A, B);
push('welch.t', w.values.t);
push('welch.df', w.values.df);
push('welch.p', w.values.p);
push('welch.ci.low', w.values.ci[0]);
push('welch.ci.high', w.values.ci[1]);
push('welch.cohenD', w.values.cohenD);

const p = welchTTest(
  A.map((v, i) => v - B[i]!),
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
);
push('paired.t', p.values.t);
push('paired.p', p.values.p);

// --- ANOVA -----------------------------------------------------------------------------------
const a = anovaOneWay([G1, G2, G3], { labels: ['g1', 'g2', 'g3'] });
push('anova.f', a.values.f);
push('anova.p', a.values.p);
push('anova.etaSquared', a.values.etaSquared);

// --- chi-square ------------------------------------------------------------------------------
const chi = chiSquareTest([
  [20, 30],
  [30, 20],
]);
push('chi2.stat', chi.values.chiSquare);
push('chi2.p', chi.values.p);
push('chi2.cramersV', chi.values.cramersV as number);
push('chi2.minExpected', chi.values.minExpected);

// --- correlation + regression ----------------------------------------------------------------
const c = pearsonCorrelation(X, Y);
push('pearson.r', c.values.r);
push('pearson.p', c.values.p);
push('pearson.ci.low', c.values.ci[0]);
push('pearson.ci.high', c.values.ci[1]);

const lr = linearRegression(X, Y);
push('linreg.slope', lr.values.slope);
push('linreg.intercept', lr.values.intercept);
push('linreg.rSquared', lr.values.rSquared);
push('linreg.slopeSe', lr.values.slopeSe);
push('linreg.slopeP', lr.values.slopeP);
push('linreg.residualSe', lr.values.residualSe);
push('linreg.slopeCi.low', lr.values.slopeCi[0]);
push('linreg.slopeCi.high', lr.values.slopeCi[1]);

// --- multiple comparisons --------------------------------------------------------------------
const mc = adjustPValues(
  [
    { label: 'a', p: 0.001 },
    { label: 'b', p: 0.008 },
    { label: 'c', p: 0.039 },
    { label: 'd', p: 0.041 },
    { label: 'e', p: 0.06 },
    { label: 'f', p: 0.3 },
  ],
  { method: 'bh' },
);
mc.values.results.forEach((r) => push(`bh.${r.label}`, r.adjusted));

const mb = adjustPValues(
  [
    { label: 'a', p: 0.001 },
    { label: 'b', p: 0.008 },
    { label: 'c', p: 0.039 },
  ],
  { method: 'bonferroni' },
);
mb.values.results.forEach((r) => push(`bonferroni.${r.label}`, r.adjusted));

console.log(out.join('\n'));

// --- the gate ---------------------------------------------------------------------------------
const reference = JSON.parse(
  readFileSync(join(import.meta.dir, 'science-reference.json'), 'utf8'),
) as Record<string, number>;
const actual = new Map(
  out.map((line) => {
    const [key, raw] = line.split('=');
    return [key, Number(raw)] as const;
  }),
);

const missing = Object.keys(reference).filter((key) => !actual.has(key));
const extra = [...actual.keys()].filter((key) => !(key in reference));
const failures: { key: string; actual: number; expected: number; error: number }[] = [];
for (const [key, expected] of Object.entries(reference)) {
  const value = actual.get(key);
  if (value === undefined) continue;
  const error = Math.abs(value - expected);
  const tolerance = 1e-9 + 1e-6 * Math.abs(expected);
  if (error > tolerance) failures.push({ key, actual: value, expected, error });
}

if (missing.length > 0 || extra.length > 0) {
  console.error(`FAIL key mismatch — missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  process.exit(1);
}

if (failures.length > 0) {
  failures.sort((left, right) => right.error - left.error);
  for (const failure of failures.slice(0, 8)) {
    console.error(
      `FAIL ${failure.key} — expected ${failure.expected}, got ${failure.actual} (error ${failure.error})`,
    );
  }
  console.error(`\n${failures.length} of ${Object.keys(reference).length} statistics are outside tolerance`);
  process.exit(1);
}

console.log(`\nOK: ${Object.keys(reference).length} statistics agree with the SciPy snapshot`);
