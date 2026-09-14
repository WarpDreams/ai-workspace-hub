#!/usr/bin/env bash
# Thin wrapper: run the CLI via tsx.
#   scripts/install.sh                 # awh install
#   scripts/install.sh sync --dry-run  # forward args verbatim
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ ! -d node_modules/tsx ]]; then
  echo "Dependencies missing; running bootstrap..."
  "$repo_dir/scripts/bootstrap.sh"
fi

if [[ $# -eq 0 || "${1:0:1}" == "-" ]]; then
  exec node_modules/.bin/tsx src/cli.ts install "$@"
fi
exec node_modules/.bin/tsx src/cli.ts "$@"
