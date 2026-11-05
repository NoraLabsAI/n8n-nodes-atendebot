#!/bin/bash
# Builds the package from a ref of the bare repo and leaves the tarball in work/pack/.
# Run on the server: e2e/pack.sh [ref]   (default: main)
set -euo pipefail
BASE="$HOME/n8n-nodes-atendebot"
export PATH="$BASE/node/bin:$PATH"
REF="${1:-main}"
SRC="$BASE/work/pack-src"
rm -rf "$SRC" "$BASE/work/pack"
mkdir -p "$SRC" "$BASE/work/pack"
git --git-dir="$BASE/repo.git" archive "$REF" | tar -x -C "$SRC"
cd "$SRC"
timeout 600 npm ci --no-audit --no-fund >/dev/null
timeout 300 npm run build >/dev/null
npm pack --silent --pack-destination "$BASE/work/pack"
rm -rf "$SRC"
