#!/bin/bash
# Quality gate. Runs on servidor-noralabs as ~/n8n-nodes-atendebot/bin/portao.sh <ref>.
# Clean checkout of <ref> from the bare repo, then: install, lint, build, tests, scan.
# Prints PASS/FAIL per step and a final "PORTAO: PASS|FAIL" (exit 1 on FAIL).
set -u
BASE="$HOME/n8n-nodes-atendebot"
export PATH="$BASE/node/bin:$PATH"
REF="${1:?usage: portao.sh <ref>}"

WORK="$(mktemp -d "$BASE/work/portao.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
git --git-dir="$BASE/repo.git" archive "$REF" | tar -x -C "$WORK" || { echo "PORTAO: FAIL (ref $REF not found)"; exit 1; }
cd "$WORK" || exit 1

FAIL=0
step() {
  local name="$1"; shift
  if timeout 900 "$@" >"$WORK/.step.log" 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    grep -v '^Sourcemap for' "$WORK/.step.log" | sed 's/\x1b\[[0-9;]*m//g' | tail -40
    FAIL=1
  fi
}

echo "ref $REF ($(git --git-dir="$BASE/repo.git" rev-parse --short "$REF"))  node $(node -v)"
step "npm ci" npm ci --no-audit --no-fund
if [ "$FAIL" = 0 ]; then
  step "lint" npm run lint
  step "build" npm run build
  step "typecheck tests" npm run typecheck:tests
  step "vitest" npx vitest run
  step "analyzePackage (source)" node "$BASE/bin/scan.mjs" "$WORK"
  mkdir -p "$WORK/.pack" && npm pack --silent --pack-destination "$WORK/.pack" >/dev/null 2>&1
  mkdir -p "$WORK/.packed" && tar -xzf "$WORK"/.pack/*.tgz -C "$WORK/.packed" 2>/dev/null
  step "analyzePackage (npm pack)" node "$BASE/bin/scan.mjs" "$WORK/.packed/package"
fi

if [ "$FAIL" = 0 ]; then echo "PORTAO: PASS"; else echo "PORTAO: FAIL"; exit 1; fi
