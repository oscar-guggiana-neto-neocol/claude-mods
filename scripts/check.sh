#!/usr/bin/env bash
# Validates the marketplace, then validates and tests every mod.
set -euo pipefail
cd "$(dirname "$0")/.."

claude plugin validate .
for mod in mods/*/; do
  echo "== ${mod}"
  claude plugin validate "$mod"
  if compgen -G "${mod}hooks/*.test.ts" > /dev/null; then
    claude plugin test "$mod"
  fi
done
