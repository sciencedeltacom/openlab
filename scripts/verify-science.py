"""SciPy reference values for scripts/verify-science.ts.

Run with any Python that has NumPy and SciPy:
    python3 apps/openlab/scripts/verify-science.py
"""

import numpy as np
from scipy import stats
from scipy.special import gammaln

A = np.array([12.1, 11.4, 13.8, 12.9, 14.2, 13.1, 12.6, 13.9, 12.2, 13.4])
B = np.array([10.2, 9.8, 11.1, 10.6, 11.9, 10.1, 10.8, 11.3, 9.9, 10.4])
X = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float)
Y = np.array([2.3, 4.1, 6.2, 7.9, 10.4, 11.8, 14.1, 15.9, 18.2, 20.1])
G1 = np.array([5.1, 5.6, 4.9, 5.3, 5.8, 5.2])
G2 = np.array([6.4, 6.9, 6.1, 6.6, 7.0, 6.3])
G3 = np.array([7.8, 8.2, 7.5, 8.0, 8.4, 7.7])

out: list[tuple[str, float]] = []
add = lambda k, v: out.append((k, float(v)))


def emit() -> None:
    for key, value in out:
        print(f"{key}={value:.10e}")


add("logGamma.1", gammaln(1))
add("logGamma.5", gammaln(5))
add("logGamma.0.5", gammaln(0.5))
add("incompleteBeta.0.5.2.3", stats.beta.cdf(0.5, 2, 3))
add("normalCdf.1.96", stats.norm.cdf(1.96))
add("normalCdf.-1.96", stats.norm.cdf(-1.96))
add("normalQuantile.0.975", stats.norm.ppf(0.975))
add("tCdf.2.228.10", stats.t.cdf(2.228138852, 10))
add("tTwoTailed.2.228138852.10", 2 * stats.t.sf(abs(2.228138852), 10))
add("tQuantile.0.95.10", stats.t.ppf(0.975, 10))
add("fCdf.4.256495.2.9", stats.f.cdf(4.256494729, 2, 9))

n = len(A)
mean = A.mean()
sd = A.std(ddof=1)
add("describe.mean", mean)
add("describe.sd", sd)
add("describe.se", sd / np.sqrt(n))
add("describe.median", np.median(A))
add("describe.q1", np.percentile(A, 25))
add("describe.q3", np.percentile(A, 75))
add("describe.skewness", stats.skew(A, bias=True))
add("describe.kurtosis", stats.kurtosis(A, bias=True, fisher=True))
lo, hi = stats.t.interval(0.95, n - 1, loc=mean, scale=stats.sem(A))
add("describe.ci.low", lo)
add("describe.ci.high", hi)

w = stats.ttest_ind(A, B, equal_var=False)
welch = stats.ttest_ind(A, B, equal_var=False)
df_w = welch.df
add("welch.t", w.statistic)
add("welch.df", df_w)
add("welch.p", w.pvalue)
crit = stats.t.ppf(0.975, df_w)
diff = A.mean() - B.mean()
se = np.sqrt(A.var(ddof=1) / len(A) + B.var(ddof=1) / len(B))
add("welch.ci.low", diff - crit * se)
add("welch.ci.high", diff + crit * se)
pooled = np.sqrt(((len(A) - 1) * A.var(ddof=1) + (len(B) - 1) * B.var(ddof=1)) / (len(A) + len(B) - 2))
add("welch.cohenD", diff / pooled)

pr = stats.ttest_rel(A - B, np.zeros(len(A)))
add("paired.t", pr.statistic)
add("paired.p", pr.pvalue)

f, pval = stats.f_oneway(G1, G2, G3)
add("anova.f", f)
add("anova.p", pval)
allv = np.concatenate([G1, G2, G3])
grand = allv.mean()
ssb = sum(len(g) * (g.mean() - grand) ** 2 for g in (G1, G2, G3))
sst = ((allv - grand) ** 2).sum()
add("anova.etaSquared", ssb / sst)

table = np.array([[20, 30], [30, 20]])
chi2, pchi, dof, expected = stats.chi2_contingency(table, correction=False)
add("chi2.stat", chi2)
add("chi2.p", pchi)
add("chi2.cramersV", np.sqrt(chi2 / table.sum()))
add("chi2.minExpected", expected.min())

r, pr2 = stats.pearsonr(X, Y)
add("pearson.r", r)
add("pearson.p", pr2)
z = np.arctanh(r)
sez = 1 / np.sqrt(len(X) - 3)
add("pearson.ci.low", np.tanh(z - stats.norm.ppf(0.975) * sez))
add("pearson.ci.high", np.tanh(z + stats.norm.ppf(0.975) * sez))

res = stats.linregress(X, Y)
add("linreg.slope", res.slope)
add("linreg.intercept", res.intercept)
add("linreg.rSquared", res.rvalue**2)
add("linreg.slopeSe", res.stderr)
add("linreg.slopeP", res.pvalue)
n2 = len(X)
tstat = res.slope / res.stderr
resid = Y - (res.intercept + res.slope * X)
add("linreg.residualSe", np.sqrt((resid**2).sum() / (n2 - 2)))
crit2 = stats.t.ppf(0.975, n2 - 2)
add("linreg.slopeCi.low", res.slope - crit2 * res.stderr)
add("linreg.slopeCi.high", res.slope + crit2 * res.stderr)

ps = [0.001, 0.008, 0.039, 0.041, 0.06, 0.3]
labels = ["a", "b", "c", "d", "e", "f"]
from statsmodels.stats.multitest import multipletests

bh = multipletests(ps, method="fdr_bh")[1]
for lab, value in zip(labels, bh):
    add(f"bh.{lab}", value)
bonf = [min(1.0, value * 3) for value in ps[:3]]
for lab, value in zip(labels[:3], bonf):
    add(f"bonferroni.{lab}", value)

emit()
