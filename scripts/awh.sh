#!/usr/bin/env bash
# Run the CLI directly from TypeScript via tsx. Forwards all args.
#   scripts/awh.sh status
#   scripts/awh.sh install --dry-run
set -euo pipefail

# Do NOT cd into the repo: the CLI resolves ./.awh.jsonc and relative -m paths
# against the caller's current directory, so it must be preserved.
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$repo_dir/node_modules/tsx" ]]; then
  echo "Dependencies missing; running bootstrap..."
  "$repo_dir/scripts/bootstrap.sh"
fi

exec "$repo_dir/node_modules/.bin/tsx" "$repo_dir/src/cli.ts" "$@"
