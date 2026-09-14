#!/usr/bin/env bash
# Thin wrapper: run `uninstall` via tsx.
#   scripts/uninstall.sh
#   scripts/uninstall.sh --dry-run
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ ! -d node_modules/tsx ]]; then
  echo "Dependencies missing; running bootstrap..."
  "$repo_dir/scripts/bootstrap.sh"
fi

exec node_modules/.bin/tsx src/cli.ts uninstall "$@"
