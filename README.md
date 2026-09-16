# ai-workspace-hub (`awh`)

[![CI](https://github.com/WarpDreams/ai-workspace-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/WarpDreams/ai-workspace-hub/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ai-workspace-hub.svg)](https://www.npmjs.com/package/ai-workspace-hub)

One command-line tool that keeps a single **canon** — your instructions,
skills and MCP servers — and installs it into every agent CLI's home
directory, in the format each one expects.

## Why

Run more than one agent CLI and the same knowledge ends up copied into each
of them, in a different shape every time:

| Kind         | Claude                     | Codex                     | Kiro                        |
| ------------ | -------------------------- | ------------------------- | --------------------------- |
| Instructions | `~/.claude/CLAUDE.md`      | `~/.codex/AGENTS.md`      | `~/.kiro/steering/*.md`     |
| Skills       | `~/.claude/skills/<name>/` | `~/.codex/skills/<name>/` | `~/.kiro/skills/<name>/`    |
| MCP servers  | `~/.claude.json`           | `~/.codex/config.toml`    | `~/.kiro/settings/mcp.json` |

One file per agent, three different formats, three places to forget. Fix a
typo in your coding standards and you fix it three times — or, more likely,
once, and the other two drift.

`awh` inverts that. You keep **one canon in one directory**. `awh install`
projects it into each agent home, as a symlink by default, so editing the
canon updates every agent at once. Nothing is duplicated, nothing drifts, and
`awh doctor` tells you when something has.

The canon is yours and lives wherever you like — a plain directory is enough.
`awh` is only the tool that projects it.

## Install

```bash
npm install -g ai-workspace-hub

awh --version
```

Or run it without installing:

```bash
npx ai-workspace-hub doctor
```

Requires Node.js >= 18 on macOS or Linux and, for MCP management and
`launch`, the agent CLIs themselves (`claude`, `codex`, `kiro-cli`) on PATH.

## Set up your canon

Make a directory anywhere and put your material in it:

```bash
mkdir -p ~/ai-canon/instructions
```

A worked example:

```
~/ai-canon/
├── .awh.jsonc              ← the manifest (next section)
├── instructions/           ← REQUIRED name: .md files here are fragments
│   ├── base.md
│   └── security.md
├── skills/
│   ├── code-review/
│   │   └── SKILL.md        ← a directory with SKILL.md is a skill
│   └── release-notes/
│       └── SKILL.md
└── mcp/                    ← REQUIRED name: .json/.jsonc here are MCP specs
    ├── context7.jsonc
    └── notion.jsonc
```

**The layout is up to you.** `awh` scans the whole canon recursively and
recognises things by shape, not by position. Exactly two directory *names*
are load-bearing — `instructions` and `mcp`:

| What                | Rule                                                        |
| ------------------- | ----------------------------------------------------------- |
| Instruction         | a `.md` file anywhere under a directory named `instructions` |
| MCP server spec     | a `.json`/`.jsonc` anywhere under a directory named `mcp`    |
| Skill               | **any** directory containing a `SKILL.md` — name it anything |

So `skills/` above is a convention, not a requirement, and nesting is free.
This is found exactly as well:

```
~/ai-canon/
├── .awh.jsonc
├── work/
│   ├── instructions/
│   │   └── base.md         ← fragment "base"
│   └── my-review-helper/
│       └── SKILL.md        ← skill "my-review-helper"
└── personal/
    └── mcp/
        └── notion.jsonc    ← MCP spec "notion"
```

Names come from the file or directory: `base.md` → `base`,
`my-review-helper/` → `my-review-helper`, `notion.jsonc` → `notion`.
`.git`, `node_modules` and dot-directories are skipped, so a README or a
skill's own reference docs are never mistaken for instruction fragments.

Already have instructions sitting in your agent homes? Move them into
`instructions/` — `awh doctor` lists exactly what it found and where, and its
suggested manifest names those files for you.

## Point awh at your canon

The canon needs one `.awh.jsonc` manifest saying which agent homes exist on
this machine and what each one gets. Let `awh` write the first draft:

```bash
awh doctor                      # scans the machine, prints a starter manifest
$EDITOR ~/ai-canon/.awh.jsonc   # paste the suggestion in, then adjust
```

With no manifest anywhere, `doctor` reports every agent home it can find and
what is already installed in each, then suggests a manifest with one target
per home, listing the instruction files it found there.

`awh` looks for the manifest in this order:

1. `-m` / `--manifest <path>`
2. `$AWH_MANIFEST`
3. `./.awh.jsonc` in the current directory
4. `~/.awh.jsonc`

Keeping the manifest in the canon and symlinking it into your home means it
is found from anywhere:

```bash
ln -s ~/ai-canon/.awh.jsonc ~/.awh.jsonc
```

> **Save the manifest in your canon, not directly in `~`.** A real
> `~/.awh.jsonc` makes the default `"content_search_paths": ["."]` resolve to
> your whole home directory, and the scan would then walk `~/Library`, any
> cloud-storage mount and every project you own. `awh` refuses this outright
> with instructions, rather than appearing to hang — but the symlink above is
> the setup to use.

Relative paths inside a manifest resolve against the directory of the **real**
file, not the symlink — so `"."` means the canon, and everything can sit
beside it.

Then check and apply:

```bash
awh doctor      # what is on this machine, and how it compares to the canon
awh plan        # what install would do — touches nothing
awh install     # do it
```

## How your canon is found

The manifest's `content_search_paths` (default `["."]`, i.e. the manifest's
own directory) are the roots scanned for canon material. Several roots are
allowed — a shared team canon plus a personal one, for instance:

```jsonc
"content_search_paths": [".", "~/team-canon"]
```

Recognition, again, is by shape:

| Kind        | Recognised as                                            | Name                 |
| ----------- | -------------------------------------------------------- | -------------------- |
| skill       | any directory containing `SKILL.md` (not descended into)  | directory name       |
| instruction | any `.md` file under a directory named `instructions`     | file name sans `.md` |
| MCP spec    | any `.json`/`.jsonc` under a directory named `mcp`        | file name sans ext   |

`.git`, `node_modules` and dot-directories are skipped; symlinked directories
are followed once. Markdown outside an `instructions/` directory (a README, a
skill's reference docs) is never treated as an instruction fragment.

If the same name is found more than once, **the later occurrence wins** —
later search paths override earlier ones, so a personal canon listed after a
shared one can shadow it. `doctor` prints every shadowed item.

A canon is small, so the scan gives up after 5000 directories rather than
walking something it should not. If yours genuinely is larger, raise the
limit with `AWH_MAX_SCAN_DIRS`.

## Commands

| Command                     | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `status`                    | Show every target and its current on-disk state                        |
| `plan`                      | Dry-run: print operations without touching disk                        |
| `install`                   | Create symlinks/copies; add MCP servers through each agent's CLI       |
| `sync`                      | Reconcile disk to manifest (install new, **prune removed**)             |
| `uninstall`                 | Remove links/copies and MCP servers this tool created                  |
| `doctor`                    | Scan agent homes on this machine; show every instruction file, skill and MCP server, managed or not, and sync state |
| `add-skill <name>`          | Scaffold a new skill under `skills/` beside the manifest               |
| `launch <target> [args...]` | Run a target's agent CLI with its home env var set; `args` pass through |

Common flags: `-m/--manifest <path>`, `-f/--force` (replace real files,
foreign symlinks or foreign MCP entries), `-n/--dry-run`, `--json` (for
`status`/`plan`/`doctor`).

Set `"color_output": true` in the manifest to colourise `doctor` output
(green in sync, yellow needs a `sync`, red needs a decision, dim for
unmanaged). It is off by default, and suppressed anyway when stdout is not a
terminal or `$NO_COLOR` is set, so piped and `--json` output stays plain.

`doctor` lists every agent home it finds (`~/.claude`, `~/.codex`, `~/.kiro`,
any `~/.<agent>-*` sibling such as `~/.codex-backup`, and any home the manifest
names), then every global instruction file, installed skill and user-scope MCP
server in each, marked `managed (symlink|copy|cli)` or `unmanaged`. With a
manifest it also reports sync state: `in sync`, `OUT OF SYNC`, `not installed`,
`CONFLICT` (unmanaged item where the manifest wants ours) or `ORPHAN` (ours,
but no longer in the manifest). Without a manifest the sync check is skipped
and a starter `.awh.jsonc` is suggested.

State glyphs in `status`/`plan`:

```
✓ linked/copied   · missing   ~ wrong-link (ours, elsewhere)
! foreign-link (outside your canon)   ✗ conflict (real file we didn't create)
↻ stale (composed instructions out of date — run install/sync)
```

## The manifest

`.awh.jsonc` (JSON with comments). See `examples/` for templates and
`examples/machine.example.jsonc` for a fully annotated reference.

```jsonc
{
  // Optional. Canon roots to scan: absolute / ~ / relative to this file.
  // Default ["."]. Later entries override earlier ones on name clashes.
  "content_search_paths": [".", "~/team-canon"],

  // Optional. Colourise `doctor` output. Default false.
  "color_output": true,

  "defaults": {
    "strategy": "symlink",            // symlink (default) | copy
    "instructions": ["base"],  // discovered fragment names, or paths to .md files
    "skills": "*",                    // "*" = every discovered skill, or names / paths to skill dirs
    "mcp": []                         // MCP specs: names, paths, or inline { name: spec }; default []
  },
  "targets": [
    { "agent": "codex",  "home": "~/.codex", "name": "codex" },
    { "agent": "codex",  "home": "~/.codex-backup", "name": "codex_backup", "skills": ["confluence-upload"] },
    { "agent": "claude", "home": "~/.claude", "name": "claude" },
    { "agent": "kiro",   "home": "~/.kiro", "name": "kiro" }
  ]
}
```

Selector entries are **names** (as discovered by the scan) or **paths** —
anything with a `/`, a leading `~` or `.`, or a `.md`/`.jsonc` extension —
resolved against the manifest's directory, which bypasses discovery entirely.
So `"instructions": ["base", "../shared/security.md"]` and
`"skills": ["~/other-repo/skills/foo"]` both work; the installed name is the
file/directory basename.

Any `defaults` field can be overridden per target. `disabled: true` parses but
skips a target for install/sync. Two more optional per-target fields exist for
`launch`: `name` (a unique handle, also shown in output) and `commandline`.

`instructions`, `skills` and `mcp` may be omitted (the defaults above apply) or
set to an empty array `[]`, at the top level or per target. An empty array is
valid and means "manage none".

## How install works

- **Instructions**
  - Single-file agents (Claude → `CLAUDE.md`, Codex → `AGENTS.md`): one
    fragment → symlink straight to it, so edits are live immediately. Multiple
    fragments → concatenated in manifest order (blank line between, no added
    headings) into `<state>/build/instructions.<a>+<b>.md` and linked/copied.
    That composite is written **only by `install` and `sync`**; after editing a
    fragment, run one of them. `plan`, `status` and `doctor` are read-only and
    flag the composite as `stale` (↻ / OUT OF SYNC) when it differs.
  - Kiro: each fragment maps to its own `steering/<name>.md`.
- **Skills**: each selected skill is linked/copied to `<home>/skills/<name>`.
- **MCP servers**: see below — never by editing config files.

`<state>` is `${XDG_STATE_HOME:-~/.local/state}/ai-workspace-hub`.

## Strategies

- **symlink** (default): agents read through links into your canon. Editing
  the canon updates every agent immediately (except multi-fragment composites,
  which need `install`/`sync`). The canon must stay at its path.
- **copy**: independent materialized copies. Portable and self-contained; run
  `sync` after editing the canon to refresh them.

## MCP servers

Each `<name>.jsonc` under an `mcp/` directory holds one public MCP server, in the standard
`mcpServers` entry shape — a hosted endpoint or a package run via a runner:

```jsonc
// mcp/notion.jsonc
{ "type": "http", "url": "https://mcp.notion.com/mcp" }

// mcp/playwright.jsonc
{ "type": "stdio", "command": "npx", "args": ["@playwright/mcp@latest"] }
```

Optional fields: `env` (stdio), `agents: ["claude", ...]` to restrict which
agents get it, `login: false` to skip the post-add login for an http server.

Select servers with the manifest's `mcp` selector, at the top level or per
target. It is `"*"` (every discovered spec) or an array mixing:

```jsonc
"mcp": [
  "*",                                                            // every discovered spec
  "context7",                                                     // a discovered spec by name
  "../shared/mcp/notion.jsonc",                                   // a spec file by path
  { "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] } },  // inline
  { "notion": { "url": "https://mcp.notion.com/mcp" }, "other": { "url": "…" } }
]
```

An inline entry is `{ "<name>": { …spec } }` with the same fields as a spec
file; one object may declare several servers. Inline declarations win over a
discovered or path entry of the same name (`doctor` warns), and declaring one
name inline twice in the same list is an error. Inline is handy for
machine-specific or one-off servers; a spec file in the canon is the
form to reuse across machines.

**awh never edits an agent's config file for MCP.** `install`/`sync`/
`uninstall` drive each agent's own CLI, in the foreground, one command at a
time, with the target's home env var set:

| Agent  | Add                                   | Remove                        | Login                                 |
| ------ | ------------------------------------- | ----------------------------- | ------------------------------------- |
| claude | `claude mcp add-json -s user`         | `claude mcp remove -s user`   | `claude mcp login <name>` (run after add for http) |
| codex  | `codex mcp add`                       | `codex mcp remove`            | started by `codex mcp add` itself for OAuth servers |
| kiro   | `kiro-cli mcp add --scope global`     | `kiro-cli mcp remove`         | none (stdio only; untested)           |

Hosted servers usually need a browser login. Because each vendor command runs
in the foreground and awh waits for it to exit, the CLI's own OAuth callback
listener stays alive until you finish in the browser, and logins for different
servers or agents never overlap. Expect `install` to pause on each http server
until you complete (or cancel) its login. Claude's login needs an interactive
terminal; when there is none, awh skips it and prints the command to run.

Matching is by *what* is configured, not which version: `@playwright/mcp@latest`
and `@playwright/mcp@1.2.3` count as the same server. `status`/`plan` show
each selected server as `installed`, `missing`, `mismatch` (ours, differs),
`conflict` (someone else's entry under the same name — skipped unless
`--force`) or `unsupported`. Servers awh added are recorded in the ledger, so
`uninstall` and `sync` only ever remove those.

## Launching an agent against a target

Agent CLIs each read an environment variable that relocates their home
directory. `awh launch` sets it for you and starts the CLI:

| Agent  | Env var             | Default command |
| ------ | ------------------- | --------------- |
| claude | `CLAUDE_CONFIG_DIR` | `claude`        |
| codex  | `CODEX_HOME`        | `codex`         |
| kiro   | `KIRO_HOME`         | `kiro-cli`      |

```jsonc
"targets": [
  { "agent": "claude", "home": "~/.claude" },                       // launch name: claude
  { "agent": "codex",  "home": "~/.codex", "name": "codex" },
  { "agent": "codex",  "home": "~/.codex-bedrock", "name": "codex_bedrock",
    "commandline": ["aws sso login --profile bedrock", "codex -p bedrock"] }
]
```

```bash
awh launch claude --model opus          # claude --model opus
awh launch codex_bedrock exec "fix it"  # aws sso login --profile bedrock, then
                                        # CODEX_HOME=~/.codex-bedrock codex -p bedrock exec "fix it"
awh launch -n codex_bedrock             # dry run: print the env + every command, run nothing
```

- `<target>` is the target's `name`; a target without one is named after its
  agent (`claude`, `codex`, `kiro`). Launch names must be unique, so two
  targets for the same agent need at least one explicit, distinct `name` —
  the manifest is rejected otherwise.
- `commandline` replaces the default executable and may carry leading flags.
  It is a shell-style string (quotes honoured; no globbing, variables or
  pipes) or an **array of such strings run in order**: every entry but the
  last is a pre-step that must exit 0, the last is the agent. A failing
  pre-step aborts the launch with its exit code. All of them get the home env
  var.
- Everything after `<target>` is passed to the agent verbatim. `awh`'s own
  flags (`-m`, `-n`) are only recognised *before* the target name; a leading
  `--` after the target is dropped.
- The agent's exit code is returned.
- For Claude's default home `~/.claude` no variable is set at all: with
  `CLAUDE_CONFIG_DIR=~/.claude` Claude would look for `~/.claude/.claude.json`
  instead of its normal `~/.claude.json`. Any other Claude home gets the
  variable, and its `.claude.json` lives inside that directory.

## Safe & reversible

Every path or MCP entry the tool creates is recorded in a ledger at
`<state>/ledger.json`. `uninstall` and `sync` remove **only what this tool
created** and prune orphans left behind when you drop a target, skill or server
from the manifest. Real files you created yourself are never touched unless
you pass `--force`.

## Developing

```bash
npm install
npm run awh -- status        # run from TypeScript via tsx
npm run typecheck
npm test                     # builds, then runs the suite (node:test via tsx)
npm run build                # bundles to dist/cli.cjs (also runs on `npm install` via prepare)
npm link                     # make this checkout the global `awh`
npm pack --dry-run           # inspect exactly what a published tarball would contain
```

Tests live in `test/`. Every test runs against a throwaway `$HOME` and
`$XDG_STATE_HOME`, so the suite never reads or writes your real agent homes or
ledger. `test/cli.test.ts` drives the bundled `dist/cli.cjs` rather than the
TypeScript sources, so it catches bundling regressions too. Run one file with
`npx tsx --test test/apply.test.ts`.

CI runs typecheck and tests on Node 18/20/22/24 (plus macOS), and separately
packs the tarball, installs it globally and runs the installed binary.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Not yet in scope

- Custom/local MCP servers with machine-specific paths or inline secrets; only
  public servers (hosted endpoints, runner-launched packages) are supported.
- Other agent settings (`config.toml` keys, `settings.json`, permissions).

## License

[MIT](LICENSE) © Jian Shen
