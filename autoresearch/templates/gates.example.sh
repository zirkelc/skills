#!/bin/sh
# Runs every gate of this repo in dependency order, one line of output per gate.
#
# The order is the point. A gate that reads a derived artifact must run after the step that
# generates it, in this same script, or it silently checks the artifact of an earlier experiment.
# Copy this file to perf/gates.sh, replace the commands, and run it before every experiment commit.
#
#   sh perf/gates.sh            cheap gates only, before every commit
#   sh perf/gates.sh --full     everything, before a keep becomes final
set -e
cd "$(git rev-parse --show-toplevel)"
FULL=${1:-}

step() {
  printf '%-22s' "$1"
  shift
  if out=$("$@" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    echo "$out" | tail -30
    exit 1
  fi
}

# 1. Regenerate what the gates read. Without this the guard can pass on a stale artifact.
step build npm run build

# 2. Behaviour, on the artifact just built.
step guard node perf/guard.mts

# 3. Cheap gates: run before every commit.
step tests npm run test-api
step lint npm run lint

[ "$FULL" = "--full" ] || exit 0

# 4. Expensive gates: run before a keep becomes final, not after every experiment.
step coverage npm run test-coverage
step typecheck npm run typecheck

# 5. Size, for any change that adds a code path. Measure the shipped artifact, minified and
#    compressed: an unminified build overstates a change several times over.
if [ -f dist/index.min.js ]; then
  raw=$(wc -c < dist/index.min.js)
  gz=$(gzip -9 -c dist/index.min.js | wc -c)
  br=$(command -v brotli >/dev/null && brotli -q 11 -c dist/index.min.js | wc -c || echo "n/a")
  printf '%-22s%s min, %s gzip, %s brotli\n' size "$raw" "$gz" "$br"
fi

# 6. Show what a formatter rewrote: those files are part of the experiment, not noise.
printf '%-22s' "working tree"
git status --short || true
