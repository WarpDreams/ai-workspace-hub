#!/usr/bin/env bash
# Thin wrapper: run the CLI via tsx.
#   scripts/install.sh                 # awh install
#   scripts/install.sh sync --dry-run  # forward args verbatim
set -euo pipefail

# Do NOT cd into the repo: the CLI resolves ./.awh.jsonc and relative -m paths
# against the caller's current directory, so it must be preserved.
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$repo_dir/node_modules/tsx" ]]; then
  echo "Dependencies missing; running bootstrap..."
  "$repo_dir/scripts/bootstrap.sh"
fi

if [[ $# -eq 0 || "${1:0:1}" == "-" ]]; then
  exec "$repo_dir/node_modules/.bin/tsx" "$repo_dir/src/cli.ts" install "$@"
fi
exec "$repo_dir/node_modules/.bin/tsx" "$repo_dir/src/cli.ts" "$@"
