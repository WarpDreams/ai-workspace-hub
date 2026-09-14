# ai-workspace-hub

One source of truth for your agent **instructions** and **skills**, installed
into every agent CLI's home directory in the format that CLI expects.

Different agent CLIs read the same logical content from different physical
locations:

| Logical content     | Claude                      | Codex                     | Kiro                       |
| ------------------- | --------------------------- | ------------------------- | -------------------------- |
| Global instructions | `~/.claude/CLAUDE.md`       | `~/.codex/AGENTS.md`      | `~/.kiro/steering/*.md`    |
| Skills              | `~/.claude/skills/<name>/`  | `~/.codex/skills/<name>/` | `~/.kiro/skills/<name>/`   |

Each tool can also run under multiple home directories (e.g. `~/.codex` and
`~/.codex-backup`). This project keeps a single canonical copy of each
instruction and skill, and installs them into each agent home — by default via
symlinks, so editing the repo updates every agent at once. A per-machine
manifest (git-ignored) declares which agents/homes exist and what each gets.

## Layout

```
content/
  instructions/applus_base.md  # canonical global instruction(s)
  skills/<name>/SKILL.md        # canonical skills
examples/                      # committed, shareable manifest templates
.awh.jsonc                     # your per-machine config (git-ignored)
src/                           # TypeScript CLI
scripts/                       # bash wrappers (bootstrap/install/uninstall)
```

## Quick start

```bash
# 1. Install dependencies (no build step — the CLI runs from TS via tsx)
scripts/bootstrap.sh

# 2. Discover agent homes on this machine and get a starter manifest
scripts/awh.sh doctor

# 3. Create your per-machine manifest (git-ignored)
cp examples/machine.macos-multi-codex.jsonc .awh.jsonc
#   ...edit to taste...

# 4. Preview, then install
scripts/awh.sh status        # or: scripts/awh.sh plan
scripts/install.sh           # == scripts/awh.sh install
```

Any subcommand can also be run with `npm run awh -- <command>` or, from the repo
root, `node_modules/.bin/tsx src/cli.ts <command>`.

## Commands

| Command            | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `status`           | Show every target and its current on-disk state                 |
| `plan`             | Dry-run: print operations without touching disk                 |
| `install`          | Create symlinks/copies per the manifest                         |
| `sync`             | Reconcile disk to manifest (install new, **prune removed**)      |
| `uninstall`        | Remove links/copies this tool created                           |
| `doctor`           | Scan agent homes on this machine; show every instruction file and skill, managed or not, and sync state |
| `add-skill <name>` | Scaffold a new skill under `content/skills/`                    |

Common flags: `-m/--manifest <path>`, `-f/--force` (replace real files or
foreign symlinks), `-n/--dry-run`, `--json` (for `status`/`plan`/`doctor`).

`doctor` lists every agent home it finds (`~/.claude`, `~/.codex`, `~/.kiro`,
any `~/.<agent>-*` sibling such as `~/.codex-backup`, and any home the manifest
names), then every global instruction file and installed skill in each, marked
`managed (symlink|copy)` or `unmanaged`. With a manifest it also reports sync
state: `in sync`, `OUT OF SYNC`, `not installed`, `CONFLICT` (unmanaged path
where the manifest wants ours) or `ORPHAN` (ours, but no longer in the
manifest). Without a manifest the sync check is skipped and a starter
`.awh.jsonc` is suggested.

State glyphs in `status`/`plan`:

```
✓ linked/copied   · missing   ~ wrong-link (ours, elsewhere)
! foreign-link (outside repo)  ✗ conflict (real file we didn't create)
↻ stale (composed instructions out of date — run install/sync)
```

## The manifest

Git-ignored `.awh.jsonc`, resolved from the current directory first, then your
home directory (`~/.awh.jsonc`). Pass `-m/--manifest <path>` to use a specific
file. See `examples/` for templates and `examples/machine.example.jsonc` for a
fully annotated reference.

```jsonc
{
  "defaults": {
    "strategy": "symlink",     // symlink (default) | copy
    "instructions": ["applus_base"],  // files under content/instructions (sans .md)
    "skills": "*"              // "*" = all, or ["name", ...]
  },
  "targets": [
    { "agent": "codex",  "home": "~/.codex", "label": "primary" },
    { "agent": "codex",  "home": "~/.codex-backup", "skills": ["confluence-upload"] },
    { "agent": "claude", "home": "~/.claude" },
    { "agent": "kiro",   "home": "~/.kiro" }
  ]
}
```

Any `defaults` field can be overridden per target. `disabled: true` parses but
skips a target.

Both `instructions` and `skills` may be omitted (the defaults above apply) or
set to an empty array `[]`, at the top level or per target. An empty array is
valid and means "manage none": the target's instruction file(s) and/or skills
directory are left entirely alone.

## How install works

- **Instructions**
  - Single-file agents (Claude → `CLAUDE.md`, Codex → `AGENTS.md`): the selected
    fragments are the source. One fragment → symlink straight to it, so edits in
    the repo are live immediately. Multiple fragments → concatenated in manifest
    order (blank line between, no added headings) into
    `build/instructions.<a>+<b>.md` and linked/copied. That composite is written
    **only by `install` and `sync`**; after editing a fragment, run one of them.
    `plan`, `status` and `doctor` are read-only and flag the composite as
    `stale` (↻ / OUT OF SYNC) when it is missing or differs from the fragments.
  - Kiro: each fragment maps to its own `steering/<name>.md`.
- **Skills**: each selected skill is linked/copied to `<home>/skills/<name>`
  (direct links per agent home — no shared bridge directory).

## Strategies

- **symlink** (default): a single on-disk copy in this repo; agents read through
  the link. Editing repo content updates every agent immediately (except
  multi-fragment composites, which need `install`/`sync` to regenerate). The
  agent needs the repo present at its path to resolve links.
- **copy**: independent materialized copies. Portable and self-contained; run
  `sync` after editing content to refresh them.

## Safe & reversible

Every path the tool creates is recorded in a ledger at
`${XDG_STATE_HOME:-~/.local/state}/ai-workspace-hub/ledger.json`. This lets
`uninstall` and `sync` remove **only what this tool created** and prune orphans
left behind when you drop a target or skill from the manifest. Real files you
created yourself are never touched unless you pass `--force`.

## Requirements

Node.js >= 18. macOS/Linux (bash wrappers).

## Not yet in scope

Managing agent config files (MCP servers, `config.toml`, `settings.json`) is
intentionally deferred. This tool currently manages instructions and skills
only.
