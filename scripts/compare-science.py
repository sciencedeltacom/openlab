"""Compare scripts/verify-science.ts output with the SciPy reference and report max error."""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent

# The interpreter running this file by default, or one named explicitly. SciPy is the only
# requirement; the old absolute path into one developer's virtualenv made the oracle
# unrunnable anywhere else.
PYTHON = os.environ.get("OPENLAB_SCIENCE_PYTHON") or sys.executable


def parse(text: str) -> dict[str, float]:
    values: dict[str, float] = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, raw = line.split("=", 1)
        try:
            values[key.strip()] = float(raw)
        except ValueError:
            continue
    return values


def main() -> int:
    ts = subprocess.run(["bun", str(HERE / "verify-science.ts")], capture_output=True, text=True, cwd=ROOT)
    if ts.returncode != 0:
        print(ts.stderr, file=sys.stderr)
        return 1
    py = subprocess.run([PYTHON, str(HERE / "verify-science.py")], capture_output=True, text=True)
    if py.returncode != 0:
        print(py.stderr, file=sys.stderr)
        return 1

    a = parse(ts.stdout)
    b = parse(py.stdout)

    missing = sorted(set(b) - set(a))
    extra = sorted(set(a) - set(b))
    if missing or extra:
        print("key mismatch", {"missing": missing, "extra": extra}, file=sys.stderr)
        return 1

    worst: list[tuple[float, str, float, float]] = []
    for key, expected in b.items():
        actual = a[key]
        # Mixed absolute + relative tolerance: a value that is exactly 0 in SciPy
        # (logGamma(1)) must not be scored as a huge relative error.
        error = abs(actual - expected)
        threshold = 1e-9 + 1e-6 * abs(expected)
        worst.append((error / threshold, key, actual, expected))

    worst.sort(reverse=True)
    print(f"compared {len(worst)} statistics")
    for score, key, actual, expected in worst[:8]:
        print(f"  {key:26s} score={score:.3e}  ts={actual:.12g}  scipy={expected:.12g}")

    failures = [w for w in worst if w[0] > 1.0]
    if failures:
        print(f"\nFAIL: {len(failures)} statistics exceed tolerance")
        return 1
    print("\nOK: all statistics agree with SciPy within 1e-6 relative / 1e-9 absolute error")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
