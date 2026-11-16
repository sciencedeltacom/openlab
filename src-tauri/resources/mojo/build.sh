#!/usr/bin/env bash
# Compile the Mojo hot path and its Python extension, and run the checks.
#
# Mojo is optional: the worker falls back to the Python twin when the extension is
# absent. Run this after installing Mojo (pip install mojo, or pixi):
#
#     ./build.sh
#
# It writes `openlab_scan.so`, which the worker imports as `openlab_scan`.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v mojo >/dev/null 2>&1; then
  echo "mojo is not installed; the worker will use the Python fallback" >&2
  exit 0
fi

echo "— checks —"
mojo test_openlab_scan.mojo

echo "— python extension —"
mojo build openlab_scan_py.mojo --emit shared-lib -o openlab_scan.so
echo "wrote openlab_scan.so"
