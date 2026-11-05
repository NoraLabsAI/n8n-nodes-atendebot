#!/bin/bash
# Runs the hml end-to-end proofs on servidor-noralabs from what is committed on <ref> (default: main).
#   ~/n8n-nodes-atendebot/work/e2e/run.sh [ref] [--only actions|trigger|examples]
# Needs ~/n8n-nodes-atendebot/work/e2e.env (mode 600, from e2e/setup-account.mjs).
set -euo pipefail
BASE="$HOME/n8n-nodes-atendebot"
export PATH="$BASE/node/bin:$PATH"
REF="${1:-main}"; shift || true
RUN="$BASE/work/e2e-run"
rm -rf "$RUN"; mkdir -p "$RUN"
git --git-dir="$BASE/repo.git" archive "$REF" e2e examples | tar -x -C "$RUN"
cleanup() {
  docker rm -f n8n-nodes-atendebot-n8n >/dev/null 2>&1 || true
  docker network rm n8n-nodes-atendebot-net >/dev/null 2>&1 || true
}
trap cleanup EXIT
bash "$RUN/e2e/pack.sh" "$REF" >/dev/null 2>&1
timeout 3000 node "$RUN/e2e/run.mjs" "$@"
