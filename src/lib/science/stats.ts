/*---------------------------------------------------------------------------------------------
 *  openlab Science — Statistical engine
 *
 *  Pure, dependency-free statistics for the research workbench. Every procedure returns
 *  a `ReproducibleResult`, i.e. a numeric result plus ready-to-run R and Python that
 *  recomputes the same numbers. That contract is what makes an analysis auditable:
 *  the workbench never reports a p-value it cannot hand back as code.
 *
 *  Conventions:
 *  - `alternative` is 'two-sided' | 'greater' | 'less' (greater = first group larger).
 *  - p-values are computed from the exact sampling distribution, not approximations
 *    from a table. Tail probabilities use the regularized incomplete beta / gamma.
 *  - All functions are total: invalid input returns an `error` field instead of throwing.
 *--------------------------------------------------------------------------------------------*/

/** Which side of the null distribution the reported p-value covers. */
export type Alternative = 'two-sided' | 'greater' | 'less';

/** Emitted source code that recomputes a result outside openlab. */
export interface Reproduction {
  /** Base R (stats package only). */
  readonly r: string;
  /** Python (scipy.stats + numpy). */
  readonly python: string;
}

/** A statistical result with its provenance. */
export interface ReproducibleResult<T> {
  /** Test or procedure identifier, e.g. `welch-t-test`. */
  readonly test: string;
  /** One-line human summary, e.g. `t(11.4) = 2.31, p = 0.041`. */
  readonly summary: string;
  /** Numeric payload. */
  readonly values: T;
  /** Assumption checks the caller should read before trusting `values`. */
  readonly assumptions: AssumptionCheck[];
  /** Recomputable R + Python. */
  readonly code: Reproduction;
  /** Set when the input was unusable; `values` is then an empty object. */
  readonly error?: string;
}

/** Outcome of a single assumption test. */
export interface AssumptionCheck {
  /** e.g. `normality`, `equal-variance`, `expected-counts`. */
  readonly name: string;
  /** `pass` means the assumption is not violated at the given alpha. */
  readonly status: 'pass' | 'warn' | 'fail' | 'skipped';
  /** Plain-language explanation, safe to show to a user. */
  readonly detail: string;
  /** p-value backing the verdict, when the check is a test. */
  readonly p?: number;
}

/** Univariate descriptive statistics. */
export interface Descriptives {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly se: number;
  readonly variance: number;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
  readonly iqr: number;
  readonly skewness: number;
  readonly kurtosis: number;
  /** 95% CI of the mean. */
  readonly ci: readonly [number, number];
}

// ---------------------------------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------------------------------

const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Lanczos approximation of `ln Γ(x)` for `x > 0`. */
export function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS_C[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_C.length; i++) {
    a += LANCZOS_C[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the regularized incomplete beta, evaluated with Lentz's method. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) {
    d = tiny;
  }
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) {
      break;
    }
  }
  return h;
}

/** Regularized incomplete beta `I_x(a, b)`, i.e. the CDF of a Beta(a, b) at `x`. */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Series form of the regularized lower incomplete gamma; accurate for `x < a + 1`. */
function gammaSeriesP(a: number, x: number): number {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 1000; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 3e-15) {
      break;
    }
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/**
 * Continued-fraction form of the regularized *upper* incomplete gamma `Q(a, x)`.
 * Computing `Q` directly (rather than `1 - P`) is what keeps the far tail of the
 * chi-square and normal distributions accurate instead of collapsing to 0.
 */
function gammaContinuedFractionQ(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = b + an / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-15) {
      break;
    }
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularized lower incomplete gamma `P(a, x)`, i.e. the CDF of a Gamma(a, 1) at `x`. */
export function incompleteGamma(a: number, x: number): number {
  if (x <= 0) {
    return 0;
  }
  if (!Number.isFinite(x)) {
    return 1;
  }
  return x < a + 1 ? gammaSeriesP(a, x) : 1 - gammaContinuedFractionQ(a, x);
}

/**
 * Regularized *upper* incomplete gamma `Q(a, x)` = 1 − P(a, x).
 *
 * Use this instead of `1 - incompleteGamma()` when you need a small tail probability:
 * subtracting from 1 throws away every significant digit of a p-value like 1e-9.
 */
export function incompleteGammaUpper(a: number, x: number): number {
  if (x <= 0) {
    return 1;
  }
  return x < a + 1 ? 1 - gammaSeriesP(a, x) : gammaContinuedFractionQ(a, x);
}

/**
 * Complementary error function.
 *
 * `erfc(x) = Q(1/2, x²)`, so the upper tail reuses the continued fraction and stays
 * accurate to ~1e-15 relative out to x ≈ 30 (where `1 - erf(x)` would already be 0).
 */
export function erfc(x: number): number {
  if (x < 0) {
    return 2 - erfc(-x);
  }
  if (x < 2) {
    // Maclaurin series of erf(x) = 2/√π · Σ (−1)ⁿ x^(2n+1) / (n!(2n+1)).
    let sum = 0;
    let term = x;
    for (let n = 0; n < 300; n++) {
      const add = term / (2 * n + 1);
      sum += add;
      term *= (-x * x) / (n + 1);
      if (Math.abs(add) < 1e-18) {
        break;
      }
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  return gammaContinuedFractionQ(0.5, x * x);
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** CDF of Student's t distribution with `df` degrees of freedom. */
export function tCdf(t: number, df: number): number {
  if (df <= 0) {
    return NaN;
  }
  const x = df / (df + t * t);
  const ib = incompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - ib / 2 : ib / 2;
}

/** Two-sided p-value for a t statistic. */
export function tTwoTailed(t: number, df: number): number {
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** Upper-tail probability of a chi-square statistic; numerically safe for tiny p-values. */
export function chiSquareSurvival(x: number, df: number): number {
  return incompleteGammaUpper(df / 2, x / 2);
}

/** CDF of the F distribution with `d1` (numerator) and `d2` (denominator) df. */
export function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0) {
    return 0;
  }
  return incompleteBeta((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
}

/**
 * Upper-tail probability of an F statistic.
 *
 * Evaluated through the swapped incomplete beta rather than `1 - fCdf()`; an ANOVA with
 * p = 4e-9 would otherwise lose nine significant digits to cancellation.
 */
export function fSurvivalUpper(x: number, d1: number, d2: number): number {
  if (x <= 0) {
    return 1;
  }
  return incompleteBeta(d2 / (d2 + d1 * x), d2 / 2, d1 / 2);
}

/** Invert a monotone-increasing CDF by bisection. */
function invertCdf(cdf: (x: number) => number, target: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    if (cdf(mid) < target) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/** Two-sided critical t value for a given confidence level. */
export function tQuantile(confidence: number, df: number): number {
  const target = 0.5 + confidence / 2;
  return invertCdf((t) => tCdf(t, df), target, 0, 1000);
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

const EMPTY_CODE: Reproduction = { r: '', python: '' };

/** Round for display without changing the underlying number. */
export function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Format a p-value the way a paper would: `<0.001` instead of `0.0000`. */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) {
    return 'n/a';
  }
  if (p < 0.001) {
    return '< 0.001';
  }
  return `= ${round(p, 3).toFixed(3)}`;
}

/** Build an error result shaped like a successful one, so callers never branch on `undefined`. */
function fail<T>(test: string, message: string): ReproducibleResult<T> {
  return {
    test,
    summary: message,
    values: {} as T,
    assumptions: [],
    code: EMPTY_CODE,
    error: message,
  };
}

/** Reject non-finite entries, which silently poison every downstream statistic. */
function clean(values: readonly number[]): number[] {
  return values.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

function requireTwoGroups(test: string, a: readonly number[], b: readonly number[]) {
  const ga = clean(a);
  const gb = clean(b);
  if (ga.length < 2 || gb.length < 2) {
    return { error: fail<never>(test, 'Each group needs at least two finite numbers.') };
  }
  return { ga, gb };
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    return NaN;
  }
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

/** Render a numeric vector as an R / Python literal, shared by every emitter. */
function vectorLiteral(values: readonly number[]): { r: string; python: string } {
  const body = values.map((v) => String(v)).join(', ');
  return { r: `c(${body})`, python: `[${body}]` };
}

function assumption(
  name: string,
  status: AssumptionCheck['status'],
  detail: string,
  p?: number,
): AssumptionCheck {
  return { name, status, detail, p };
}

// ---------------------------------------------------------------------------------------------
// Descriptives
// ---------------------------------------------------------------------------------------------

/** Descriptive statistics for one sample, including a 95% CI of the mean. */
export function describe(input: readonly number[], confidence = 0.95): ReproducibleResult<Descriptives> {
  const values = clean(input);
  if (values.length < 2) {
    return fail('descriptives', 'At least two finite numbers are required.');
  }
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const sorted = [...values].sort((a, b) => a - b);
  // Standardized moments use the *population* SD so skewness/kurtosis stay consistent
  // with scipy.stats.skew(..., bias=True) / .kurtosis(..., bias=True).
  const m2 = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sdPop = Math.sqrt(m2);
  const m3 = values.reduce((s, v) => s + ((v - mean) / sdPop) ** 3, 0) / n;
  const m4 = values.reduce((s, v) => s + ((v - mean) / sdPop) ** 4, 0) / n;
  const tCrit = tQuantile(confidence, n - 1);
  const lit = vectorLiteral(values);

  const stats: Descriptives = {
    n,
    mean,
    sd,
    se,
    variance,
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[n - 1],
    iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
    skewness: m3,
    kurtosis: m4 - 3,
    ci: [mean - tCrit * se, mean + tCrit * se],
  };

  return {
    test: 'descriptives',
    summary: `n = ${n}, mean = ${round(mean)}, SD = ${round(sd)}, 95% CI [${round(stats.ci[0])}, ${round(stats.ci[1])}]`,
    values: stats,
    assumptions: [
      assumption(
        'normality',
        Math.abs(stats.skewness) < 1 && Math.abs(stats.kurtosis) < 2 ? 'pass' : 'warn',
        `Skewness ${round(stats.skewness, 3)}, excess kurtosis ${round(stats.kurtosis, 3)}. Values beyond ±1 / ±2 make the mean a weaker summary.`,
      ),
    ],
    code: {
      r: `x <- ${lit.r}\nn <- length(x)\nmean(x); sd(x); median(x); IQR(x)\nt.test(x)$conf.int`,
      python: `import numpy as np\nfrom scipy import stats\nx = np.array(${lit.python})\nnp.mean(x), np.std(x, ddof=1), np.median(x)\nstats.t.interval(${confidence}, len(x) - 1, loc=np.mean(x), scale=stats.sem(x))`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Assumption checks
// ---------------------------------------------------------------------------------------------

/**
 * Brown–Forsythe test for equal variances (Levene on absolute deviations from the median).
 * Robust to non-normality, which is why it is used here instead of Bartlett's test.
 */
export function leveneTest(groups: readonly (readonly number[])[]): AssumptionCheck {
  const cleaned = groups.map(clean).filter((g) => g.length >= 2);
  if (cleaned.length < 2) {
    return assumption('equal-variance', 'skipped', 'Fewer than two usable groups.');
  }
  const deviations = cleaned.map((g) => {
    const m = quantile(
      [...g].sort((a, b) => a - b),
      0.5,
    );
    return g.map((v) => Math.abs(v - m));
  });
  const all = deviations.flat();
  const grand = all.reduce((s, v) => s + v, 0) / all.length;
  const k = deviations.length;
  const n = all.length;

  let ssBetween = 0;
  let ssWithin = 0;
  deviations.forEach((g) => {
    const gm = g.reduce((s, v) => s + v, 0) / g.length;
    ssBetween += g.length * (gm - grand) ** 2;
    g.forEach((v) => {
      ssWithin += (v - gm) ** 2;
    });
  });

  const df1 = k - 1;
  const df2 = n - k;
  if (df2 <= 0 || ssWithin <= 0) {
    return assumption('equal-variance', 'skipped', 'Not enough residual variation to test.');
  }
  const f = ssBetween / df1 / (ssWithin / df2);
  const p = fSurvivalUpper(f, df1, df2);
  return assumption(
    'equal-variance',
    p < 0.05 ? 'warn' : 'pass',
    p < 0.05
      ? `Brown–Forsythe p ${formatP(p)}: variances differ, so the Welch correction is used.`
      : `Brown–Forsythe p ${formatP(p)}: variances are compatible with equality.`,
    p,
  );
}

/** Skewness / kurtosis screen for approximate normality, with a sample-size caveat. */
export function normalityScreen(values: readonly number[]): AssumptionCheck {
  const g = clean(values);
  if (g.length < 8) {
    return assumption('normality', 'skipped', `n = ${g.length}: too few points to judge normality.`);
  }
  const n = g.length;
  const mean = g.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(g.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const skew = g.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0) / n;
  const kurt = g.reduce((s, v) => s + ((v - mean) / sd) ** 4, 0) / n - 3;
  const skewZ = Math.abs(skew) / Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3)));
  const kurtZ = Math.abs(kurt) / Math.sqrt(24 / n);
  const p = 2 * (1 - normalCdf(Math.max(skewZ, kurtZ)));
  const ok = skewZ < 1.96 && kurtZ < 1.96;
  return assumption(
    'normality',
    ok ? 'pass' : n >= 30 ? 'warn' : 'fail',
    ok
      ? 'Skewness and kurtosis are within sampling noise of a normal distribution.'
      : `Skewness z = ${round(skewZ, 2)}, kurtosis z = ${round(kurtZ, 2)}${n >= 30 ? '; the CLT still covers the mean, but check a plot.' : '; prefer a rank-based test at this sample size.'}`,
    p,
  );
}

// ---------------------------------------------------------------------------------------------
// t tests
// ---------------------------------------------------------------------------------------------

/** Result payload shared by every t test. */
export interface TTestValues {
  readonly t: number;
  readonly df: number;
  readonly p: number;
  readonly meanA: number;
  readonly meanB: number;
  readonly meanDifference: number;
  /** CI of the difference (or of the single mean for a one-sample test). */
  readonly ci: readonly [number, number];
  readonly cohenD: number;
  readonly nA: number;
  readonly nB: number;
}

/**
 * Welch's two-sample t test. Welch is the default (not Student's pooled t) because it keeps
 * the nominal error rate when variances differ, at the cost of a few degrees of freedom.
 */
export function welchTTest(
  a: readonly number[],
  b: readonly number[],
  options: { confidence?: number; alternative?: Alternative } = {},
): ReproducibleResult<TTestValues> {
  const confidence = options.confidence ?? 0.95;
  const alternative = options.alternative ?? 'two-sided';
  const prepared = requireTwoGroups('welch-t-test', a, b);
  if ('error' in prepared) {
    return prepared.error as ReproducibleResult<TTestValues>;
  }
  const { ga, gb } = prepared;
  const nA = ga.length;
  const nB = gb.length;
  const meanA = ga.reduce((s, v) => s + v, 0) / nA;
  const meanB = gb.reduce((s, v) => s + v, 0) / nB;
  const varA = ga.reduce((s, v) => s + (v - meanA) ** 2, 0) / (nA - 1);
  const varB = gb.reduce((s, v) => s + (v - meanB) ** 2, 0) / (nB - 1);
  const seA = varA / nA;
  const seB = varB / nB;
  const se = Math.sqrt(seA + seB);
  const diff = meanA - meanB;
  const t = diff / se;
  const df = (seA + seB) ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));

  const p =
    alternative === 'two-sided'
      ? tTwoTailed(t, df)
      : alternative === 'greater'
        ? 1 - tCdf(t, df)
        : tCdf(t, df);

  const tCrit = tQuantile(confidence, df);
  const pooledSd = Math.sqrt(((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2));
  const cohenD = diff / pooledSd;
  const litA = vectorLiteral(ga);
  const litB = vectorLiteral(gb);

  const values: TTestValues = {
    t,
    df,
    p,
    meanA,
    meanB,
    meanDifference: diff,
    ci: [diff - tCrit * se, diff + tCrit * se],
    cohenD,
    nA,
    nB,
  };

  const size =
    Math.abs(cohenD) < 0.2
      ? 'negligible'
      : Math.abs(cohenD) < 0.5
        ? 'small'
        : Math.abs(cohenD) < 0.8
          ? 'medium'
          : 'large';

  return {
    test: 'welch-t-test',
    summary: `t(${round(df, 1)}) = ${round(t, 3)}, p ${formatP(p)}, Cohen's d = ${round(cohenD, 3)} (${size})`,
    values,
    assumptions: [
      normalityScreen(ga),
      normalityScreen(gb),
      assumption(
        'equal-variance',
        'pass',
        'Welch correction applied: equal variances are not required, only reported for context.',
      ),
      assumption(
        'independence',
        'skipped',
        'Independence is a design property; verify how the samples were collected.',
      ),
    ],
    code: {
      r: `a <- ${litA.r}\nb <- ${litB.r}\nt.test(a, b, var.equal = FALSE, alternative = "${alternative}", conf.level = ${confidence})\n# Cohen's d\neffsize::cohen.d(a, b)`,
      python: `import numpy as np\nfrom scipy import stats\na = np.array(${litA.python})\nb = np.array(${litB.python})\nstats.ttest_ind(a, b, equal_var=False, alternative="${alternative}")\n# Cohen's d\nnx, ny = len(a), len(b)\nsd = np.sqrt(((nx-1)*np.var(a, ddof=1) + (ny-1)*np.var(b, ddof=1)) / (nx+ny-2))\n(np.mean(a) - np.mean(b)) / sd`,
    },
  };
}

/** Paired t test for two measurements on the same units. */
export function pairedTTest(
  a: readonly number[],
  b: readonly number[],
  options: { confidence?: number; alternative?: Alternative } = {},
): ReproducibleResult<TTestValues> {
  const confidence = options.confidence ?? 0.95;
  const alternative = options.alternative ?? 'two-sided';
  const prepared = requireTwoGroups('paired-t-test', a, b);
  if ('error' in prepared) {
    return prepared.error as ReproducibleResult<TTestValues>;
  }
  const { ga, gb } = prepared;
  if (ga.length !== gb.length) {
    return fail('paired-t-test', `Paired test needs equal lengths; got ${ga.length} and ${gb.length}.`);
  }
  const diffs = ga.map((v, i) => v - gb[i]);
  const n = diffs.length;
  const meanA = ga.reduce((s, v) => s + v, 0) / n;
  const meanB = gb.reduce((s, v) => s + v, 0) / n;
  const diff = diffs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(diffs.reduce((s, v) => s + (v - diff) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const t = diff / se;
  const df = n - 1;
  const p =
    alternative === 'two-sided'
      ? tTwoTailed(t, df)
      : alternative === 'greater'
        ? 1 - tCdf(t, df)
        : tCdf(t, df);
  const tCrit = tQuantile(confidence, df);
  const dz = diff / sd;
  const litA = vectorLiteral(ga);
  const litB = vectorLiteral(gb);

  return {
    test: 'paired-t-test',
    summary: `paired t(${df}) = ${round(t, 3)}, p ${formatP(p)}, Cohen's dz = ${round(dz, 3)}`,
    values: {
      t,
      df,
      p,
      meanA,
      meanB,
      meanDifference: diff,
      ci: [diff - tCrit * se, diff + tCrit * se],
      cohenD: dz,
      nA: n,
      nB: n,
    },
    assumptions: [
      normalityScreen(diffs),
      assumption('independence', 'skipped', 'Pairs must be independent of each other, not of their partner.'),
    ],
    code: {
      r: `a <- ${litA.r}\nb <- ${litB.r}\nt.test(a, b, paired = TRUE, alternative = "${alternative}", conf.level = ${confidence})`,
      python: `import numpy as np\nfrom scipy import stats\na = np.array(${litA.python})\nb = np.array(${litB.python})\nstats.ttest_rel(a, b, alternative="${alternative}")`,
    },
  };
}

/** One-sample t test against a reference mean. */
export function oneSampleTTest(
  input: readonly number[],
  mu = 0,
  options: { confidence?: number; alternative?: Alternative } = {},
): ReproducibleResult<TTestValues> {
  const confidence = options.confidence ?? 0.95;
  const alternative = options.alternative ?? 'two-sided';
  const g = clean(input);
  if (g.length < 2) {
    return fail('one-sample-t-test', 'At least two finite numbers are required.');
  }
  const n = g.length;
  const mean = g.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(g.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const diff = mean - mu;
  const t = diff / se;
  const df = n - 1;
  const p =
    alternative === 'two-sided'
      ? tTwoTailed(t, df)
      : alternative === 'greater'
        ? 1 - tCdf(t, df)
        : tCdf(t, df);
  const tCrit = tQuantile(confidence, df);
  const cohenD = diff / sd;
  const lit = vectorLiteral(g);

  return {
    test: 'one-sample-t-test',
    summary: `t(${df}) = ${round(t, 3)}, p ${formatP(p)}, mean difference ${round(diff)}`,
    values: {
      t,
      df,
      p,
      meanA: mean,
      meanB: mu,
      meanDifference: diff,
      ci: [diff - tCrit * se, diff + tCrit * se],
      cohenD,
      nA: n,
      nB: 1,
    },
    assumptions: [normalityScreen(g)],
    code: {
      r: `x <- ${lit.r}\nt.test(x, mu = ${mu}, alternative = "${alternative}", conf.level = ${confidence})`,
      python: `import numpy as np\nfrom scipy import stats\nx = np.array(${lit.python})\nstats.ttest_1samp(x, popmean=${mu}, alternative="${alternative}")`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// ANOVA
// ---------------------------------------------------------------------------------------------

/** One-way ANOVA result payload. */
export interface AnovaValues {
  readonly f: number;
  readonly dfBetween: number;
  readonly dfWithin: number;
  readonly p: number;
  readonly etaSquared: number;
  readonly omegaSquared: number;
  readonly groupMeans: readonly number[];
  readonly groupSizes: readonly number[];
}

/** One-way ANOVA with Brown–Forsythe variance check and a Tukey-ready grouping summary. */
export function anovaOneWay(
  groups: readonly (readonly number[])[],
  options: { labels?: readonly string[] } = {},
): ReproducibleResult<AnovaValues> {
  const cleaned = groups.map(clean).filter((g) => g.length >= 2);
  if (cleaned.length < 2) {
    return fail('one-way-anova', 'At least two groups with two or more finite values are required.');
  }
  const k = cleaned.length;
  const sizes = cleaned.map((g) => g.length);
  const means = cleaned.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
  const grand = cleaned.flat().reduce((s, v) => s + v, 0) / cleaned.flat().length;

  let ssBetween = 0;
  let ssWithin = 0;
  cleaned.forEach((g, i) => {
    ssBetween += g.length * (means[i] - grand) ** 2;
    g.forEach((v) => {
      ssWithin += (v - means[i]) ** 2;
    });
  });
  const dfBetween = k - 1;
  const dfWithin = sizes.reduce((s, n) => s + n, 0) - k;
  const f = ssBetween / dfBetween / (ssWithin / dfWithin);
  const p = fSurvivalUpper(f, dfBetween, dfWithin);
  const ssTotal = ssBetween + ssWithin;
  const etaSquared = ssBetween / ssTotal;
  const omegaSquared = (ssBetween - dfBetween * (ssWithin / dfWithin)) / (ssTotal + ssWithin / dfWithin);

  const labels = options.labels ?? cleaned.map((_, i) => `group${i + 1}`);

  return {
    test: 'one-way-anova',
    summary: `F(${dfBetween}, ${dfWithin}) = ${round(f, 3)}, p ${formatP(p)}, η² = ${round(etaSquared, 3)}`,
    values: {
      f,
      dfBetween,
      dfWithin,
      p,
      etaSquared,
      omegaSquared,
      groupMeans: means,
      groupSizes: sizes,
    },
    assumptions: [
      leveneTest(cleaned),
      ...cleaned.slice(0, 4).map((g, i) => {
        const check = normalityScreen(g);
        return { ...check, name: `normality (${labels[i] ?? i + 1})` };
      }),
      assumption(
        'independence',
        'skipped',
        'Each observation must belong to exactly one group and be independent of the others.',
      ),
    ],
    code: {
      r: `df <- data.frame(\n  value = c(${cleaned.map((g) => g.join(', ')).join(', ')}),\n  group = factor(rep(c(${labels.map((l) => `"${l}"`).join(', ')}), times = c(${sizes.join(', ')})))\n)\nsummary(aov(value ~ group, data = df))\nTukeyHSD(aov(value ~ group, data = df))`,
      python: `from scipy import stats\n${cleaned.map((g, i) => `g${i} = [${g.join(', ')}]`).join('\n')}\nstats.f_oneway(${cleaned.map((_, i) => `g${i}`).join(', ')})`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Categorical tests
// ---------------------------------------------------------------------------------------------

/** Chi-square result payload, covering both goodness-of-fit and independence. */
export interface ChiSquareValues {
  readonly chiSquare: number;
  readonly df: number;
  readonly p: number;
  /** Cramér's V effect size (independence only). */
  readonly cramersV: number | null;
  readonly minExpected: number;
  readonly expected: readonly (readonly number[])[];
}

/**
 * Pearson chi-square test. Pass a single row for goodness of fit, a matrix for independence.
 * `expected` is computed as row-total × column-total / grand-total for matrices.
 */
export function chiSquareTest(table: readonly (readonly number[])[]): ReproducibleResult<ChiSquareValues> {
  const rows = table.map((r) => r.map((v) => (Number.isFinite(v) && v >= 0 ? v : NaN)));
  if (rows.length === 0 || rows.some((r) => r.length === 0 || r.some((v) => Number.isNaN(v)))) {
    return fail('chi-square', 'Counts must be finite non-negative numbers.');
  }
  const rowTotals = rows.map((r) => r.reduce((s, v) => s + v, 0));
  const grand = rowTotals.reduce((s, v) => s + v, 0);
  if (grand <= 0) {
    return fail('chi-square', 'The table is empty.');
  }
  const cols = rows[0].length;
  const isIndependence = rows.length > 1;
  const colTotals = Array.from({ length: cols }, (_, c) => rows.reduce((s, r) => s + (r[c] ?? 0), 0));

  // Independence expects row-total × column-total / grand; goodness of fit expects a uniform split.
  const expected = isIndependence
    ? rows.map((_, r) => colTotals.map((c) => (rowTotals[r] * c) / grand))
    : [Array.from({ length: cols }, () => grand / cols)];

  let chiSquare = 0;
  rows.forEach((row, r) => {
    row.forEach((obs, c) => {
      const exp = expected[r]![c]!;
      if (exp > 0) {
        chiSquare += (obs - exp) ** 2 / exp;
      }
    });
  });

  const df = rows.length === 1 ? cols - 1 : (rows.length - 1) * (cols - 1);
  const p = chiSquareSurvival(chiSquare, df);
  const minExpected = Math.min(...expected.flat());
  const n = grand;
  const cramersV =
    isIndependence && df > 0 ? Math.sqrt(chiSquare / (n * Math.min(rows.length - 1, cols - 1))) : null;

  const matrix = rows.map((r) => `c(${r.join(', ')})`).join(',\n  ');

  return {
    test: isIndependence ? 'chi-square-independence' : 'chi-square-goodness-of-fit',
    summary: `χ²(${df}) = ${round(chiSquare, 3)}, p ${formatP(p)}${cramersV !== null ? `, Cramér's V = ${round(cramersV, 3)}` : ''}`,
    values: { chiSquare, df, p, cramersV, minExpected, expected },
    assumptions: [
      assumption(
        'expected-counts',
        minExpected < 1 ? 'fail' : minExpected < 5 ? 'warn' : 'pass',
        minExpected < 5
          ? `Smallest expected count is ${round(minExpected, 2)}. Below 5 the chi-square approximation drifts; pool categories or use Fisher's exact test.`
          : `Smallest expected count is ${round(minExpected, 2)}.`,
      ),
      assumption('independence', 'skipped', 'Each observation must contribute to exactly one cell.'),
    ],
    code: {
      r: `m <- matrix(c(\n  ${matrix}\n), nrow = ${rows.length}, byrow = TRUE)\nchisq.test(m)`,
      python: `import numpy as np\nfrom scipy import stats\nm = np.array([\n  ${matrix}\n])\nstats.chi2_contingency(m).statistic, stats.chi2_contingency(m).pvalue`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Correlation and regression
// ---------------------------------------------------------------------------------------------

/** Correlation result payload. */
export interface CorrelationValues {
  readonly r: number;
  readonly n: number;
  readonly p: number;
  readonly df: number;
  readonly ci: readonly [number, number];
  readonly rSquared: number;
}

/** Pearson product-moment correlation with a Fisher-z confidence interval. */
export function pearsonCorrelation(
  x: readonly number[],
  y: readonly number[],
  options: { confidence?: number } = {},
): ReproducibleResult<CorrelationValues> {
  const confidence = options.confidence ?? 0.95;
  const xs = clean(x);
  const ys = clean(y);
  const n = Math.min(xs.length, ys.length);
  if (n < 3) {
    return fail('pearson-correlation', 'At least three paired finite values are required.');
  }
  const ax = xs.slice(0, n);
  const ay = ys.slice(0, n);
  const mx = ax.reduce((s, v) => s + v, 0) / n;
  const my = ay.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (ax[i]! - mx) * (ay[i]! - my);
    sxx += (ax[i]! - mx) ** 2;
    syy += (ay[i]! - my) ** 2;
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const df = n - 2;
  const t = (r * Math.sqrt(df)) / Math.sqrt(1 - r * r);
  const p = tTwoTailed(t, df);
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  const zCrit = normalQuantile(0.5 + confidence / 2);
  const se = 1 / Math.sqrt(n - 3);
  const lo = Math.tanh(z - zCrit * se);
  const hi = Math.tanh(z + zCrit * se);

  return {
    test: 'pearson-correlation',
    summary: `r(${df}) = ${round(r, 3)}, p ${formatP(p)}, ${Math.round(confidence * 100)}% CI [${round(lo, 3)}, ${round(hi, 3)}]`,
    values: { r, n, p, df, ci: [lo, hi], rSquared: r * r },
    assumptions: [
      normalityScreen(ax),
      normalityScreen(ay),
      assumption(
        'linearity',
        'skipped',
        'Pearson r assumes a straight-line relationship; plot the pairs, or use Spearman when it is monotone but curved.',
      ),
    ],
    code: {
      r: `x <- c(${ax.join(', ')})\ny <- c(${ay.join(', ')})\ncor.test(x, y, method = "pearson", conf.level = ${confidence})`,
      python: `import numpy as np\nfrom scipy import stats\nx = np.array([${ax.join(', ')}])\ny = np.array([${ay.join(', ')}])\nstats.pearsonr(x, y)`,
    },
  };
}

/** Inverse standard normal CDF (Acklam's rational approximation, ~1e-9 accurate). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) {
    return p <= 0 ? -Infinity : Infinity;
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - plow) {
    return -normalQuantile(1 - p);
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Ordinary least squares simple linear regression with inference on the slope. */
export interface RegressionValues {
  readonly slope: number;
  readonly intercept: number;
  readonly rSquared: number;
  readonly slopeSe: number;
  readonly slopeT: number;
  readonly slopeP: number;
  readonly residualSe: number;
  readonly df: number;
  readonly n: number;
  readonly slopeCi: readonly [number, number];
}

/** OLS `y = intercept + slope·x`, with the standard errors and CI a reviewer will ask for. */
export function linearRegression(
  x: readonly number[],
  y: readonly number[],
  options: { confidence?: number } = {},
): ReproducibleResult<RegressionValues> {
  const confidence = options.confidence ?? 0.95;
  const xs = clean(x);
  const ys = clean(y);
  const n = Math.min(xs.length, ys.length);
  if (n < 3) {
    return fail('linear-regression', 'At least three paired finite values are required.');
  }
  const ax = xs.slice(0, n);
  const ay = ys.slice(0, n);
  const mx = ax.reduce((s, v) => s + v, 0) / n;
  const my = ay.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (ax[i]! - mx) * (ay[i]! - my);
    sxx += (ax[i]! - mx) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    sse += (ay[i]! - (intercept + slope * ax[i]!)) ** 2;
  }
  const df = n - 2;
  const residualSe = Math.sqrt(sse / df);
  const slopeSe = residualSe / Math.sqrt(sxx);
  const slopeT = slope / slopeSe;
  const slopeP = tTwoTailed(slopeT, df);
  const tCrit = tQuantile(confidence, df);
  const sst = ay.reduce((s, v) => s + (v - my) ** 2, 0);
  const rSquared = 1 - sse / sst;

  return {
    test: 'linear-regression',
    summary: `y = ${round(intercept, 3)} + ${round(slope, 3)}x, R² = ${round(rSquared, 3)}, slope p ${formatP(slopeP)}`,
    values: {
      slope,
      intercept,
      rSquared,
      slopeSe,
      slopeT,
      slopeP,
      residualSe,
      df,
      n,
      slopeCi: [slope - tCrit * slopeSe, slope + tCrit * slopeSe],
    },
    assumptions: [
      normalityScreen(ay),
      assumption(
        'homoscedasticity',
        'skipped',
        'Constant residual variance is assumed; plot residuals against fitted values to confirm.',
      ),
      assumption(
        'linearity',
        'skipped',
        'A straight line is assumed. A curved cloud means you need a term or a transform.',
      ),
    ],
    code: {
      r: `x <- c(${ax.join(', ')})\ny <- c(${ay.join(', ')})\nfit <- lm(y ~ x)\nsummary(fit)\nconfint(fit, level = ${confidence})`,
      python: `import numpy as np\nfrom scipy import stats\nx = np.array([${ax.join(', ')}])\ny = np.array([${ay.join(', ')}])\nres = stats.linregress(x, y)\nprint(res.slope, res.intercept, res.rvalue**2, res.pvalue, res.stderr)`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Multiple comparisons
// ---------------------------------------------------------------------------------------------

/** A p-value that survived (or did not survive) multiplicity correction. */
export interface AdjustedPValue {
  readonly label: string;
  readonly p: number;
  readonly adjusted: number;
  readonly rejected: boolean;
}

/**
 * Multiple-comparison correction.
 * - `bonferroni` controls the family-wise error rate; strict, use for a handful of planned tests.
 * - `bh` (Benjamini–Hochberg) controls the false discovery rate; the default for screening many tests.
 */
export function adjustPValues(
  entries: readonly { label: string; p: number }[],
  options: { method?: 'bonferroni' | 'bh'; alpha?: number } = {},
): ReproducibleResult<{ readonly results: readonly AdjustedPValue[] }> {
  const method = options.method ?? 'bh';
  const alpha = options.alpha ?? 0.05;
  if (entries.length === 0) {
    return fail('multiple-comparisons', 'No p-values were supplied.');
  }
  const order = entries.map((e, i) => ({ ...e, i })).sort((a, b) => a.p - b.p);
  const m = entries.length;
  const adjusted = new Array<number>(m);
  const rejected = new Array<boolean>(m);

  if (method === 'bonferroni') {
    order.forEach((entry) => {
      const value = Math.min(1, entry.p * m);
      adjusted[entry.i] = value;
      rejected[entry.i] = value < alpha;
    });
  } else {
    let running = 1;
    for (let rank = m - 1; rank >= 0; rank--) {
      const entry = order[rank]!;
      const value = Math.min(running, (entry.p * m) / (rank + 1));
      running = value;
      adjusted[entry.i] = value;
      rejected[entry.i] = value < alpha;
    }
  }

  const results: AdjustedPValue[] = entries.map((e, i) => ({
    label: e.label,
    p: e.p,
    adjusted: adjusted[i] ?? 1,
    rejected: rejected[i] ?? false,
  }));
  const survivors = results.filter((r) => r.rejected).length;
  const lit = `c(${entries.map((e) => e.p).join(', ')})`;

  return {
    test: `multiple-comparisons-${method}`,
    summary: `${survivors} of ${m} tests survive ${method.toUpperCase()} at α = ${alpha}.`,
    values: { results },
    assumptions: [
      assumption(
        'family-definition',
        'skipped',
        'Correction is only meaningful if the tests you passed really form one family (same question, same dataset).',
      ),
    ],
    code: {
      r: `p <- ${lit}\np.adjust(p, method = "${method === 'bh' ? 'BH' : 'bonferroni'}")`,
      python: `import numpy as np\nfrom statsmodels.stats.multitest import multipletests\np = np.array([${entries.map((e) => e.p).join(', ')}])\nmultipletests(p, method="${method === 'bh' ? 'fdr_bh' : 'bonferroni'}")`,
    },
  };
}
