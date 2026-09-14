#!/usr/bin/env bash
# Bootstrap: install Node dependencies. No build step — the CLI runs directly
# from TypeScript via tsx.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but not found on PATH." >&2
  exit 1
fi

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "Bootstrap complete. Run: scripts/awh.sh status"
