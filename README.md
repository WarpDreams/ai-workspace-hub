# ai-workspace-hub (`awh`)

One command-line tool that installs your canonical agent **instructions**,
**skills** and **MCP servers** into every agent CLI's home directory, in the
format each CLI expects, and launches agents against a chosen home.

Different agent CLIs read the same logical content from different places:

| Logical content     | Claude                      | Codex                          | Kiro                       |
| ------------------- | --------------------------- | ------------------------------ | -------------------------- |
| Global instructions | `~/.claude/CLAUDE.md`       | `~/.codex/AGENTS.md`           | `~/.kiro/steering/*.md`    |
| Skills              | `~/.claude/skills/<name>/`  | `~/.codex/skills/<name>/`      | `~/.kiro/skills/<name>/`   |
| MCP servers (user)  | `~/.claude.json`            | `~/.codex/config.toml`         | `~/.kiro/settings/mcp.json`|

`awh` is only the tool. **Your content lives in a separate repo** (see
[ai-workspace-content](https://github.com/alienbat/ai-workspace-content) for
the layout): instruction fragments, skill directories, MCP specs, and the
per-machine manifest `.awh.jsonc` that says which agents/homes exist and what
each gets.

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

## Point it at your content

`awh` looks for the manifest in this order: `-m/--manifest <path>`,
`$AWH_MANIFEST`, `./.awh.jsonc`, `~/.awh.jsonc`. The usual setup is a symlink:

```bash
git clone git@github.com:alienbat/ai-workspace-content.git ~/works/ai-workspace-content
ln -s ~/works/ai-workspace-content/.awh.jsonc ~/.awh.jsonc
awh doctor
```

Relative paths in a manifest resolve against the directory of the **real**
manifest file, so content sits beside it in the content repo.

## How content is found

The manifest's `content_search_paths` (default `["."]`, i.e. the manifest's
own directory) are scanned recursively. Items are recognised by shape, so no
particular layout is required:

| Kind        | Recognised as                                         | Name                 |
| ----------- | ----------------------------------------------------- | -------------------- |
| skill       | any directory containing `SKILL.md` (not descended into) | directory name    |
| instruction | any `.md` file under a directory named `instructions` | file name sans `.md` |
| MCP spec    | any `.json`/`.jsonc` under a directory named `mcp`    | file name sans ext   |

`.git`, `node_modules` and dot-directories are skipped; symlinked directories
are followed once. Markdown outside an `instructions/` directory (a README, a
skill's reference docs) is never treated as an instruction fragment.

If the same name is found more than once, **the later occurrence wins** —
later search paths override earlier ones, so a personal repo listed after a
shared one can shadow it. `doctor` prints every shadowed item.

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
! foreign-link (outside our content)  ✗ conflict (real file we didn't create)
↻ stale (composed instructions out of date — run install/sync)
```

## The manifest

`.awh.jsonc` (JSON with comments). See `examples/` for templates and
`examples/machine.example.jsonc` for a fully annotated reference.

```jsonc
{
  // Optional. Directories scanned for content: absolute / ~ / relative to this
  // file. Default ["."]. Later entries override earlier ones on name clashes.
  "content_search_paths": [".", "~/works/team-shared-content"],

  // Optional. Colourise `doctor` output. Default false.
  "color_output": true,

  "defaults": {
    "strategy": "symlink",            // symlink (default) | copy
    "instructions": ["applus_base"],  // discovered fragment names, or paths to .md files
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
So `"instructions": ["applus_base", "../shared/security.md"]` and
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

- **symlink** (default): agents read through links into your content repo.
  Editing content updates every agent immediately (except multi-fragment
  composites, which need `install`/`sync`). The content repo must stay at its
  path.
- **copy**: independent materialized copies. Portable and self-contained; run
  `sync` after editing content to refresh them.

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
machine-specific or one-off servers; a spec file in the content repo is the
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
npm run build                # bundles to dist/cli.cjs (also runs on `npm install` via prepare)
npm link                     # make this checkout the global `awh`
npm pack --dry-run           # inspect exactly what a published tarball would contain
```

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Not yet in scope

- Custom/local MCP servers with machine-specific paths or inline secrets; only
  public servers (hosted endpoints, runner-launched packages) are supported.
- Other agent settings (`config.toml` keys, `settings.json`, permissions).

## License

[MIT](LICENSE) © Jian Shen
