# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-09-17

### Changed
- The default instruction fragment is now `base`. It previously carried an
  organisation-specific name, which had no business in a public package — it
  appeared in the schema default, in `doctor`'s suggested starter manifest, in
  the README and in every example.

### Added
- A hygiene test that fails the build if an employer/client name, an internal
  hostname, an AWS account id or a private Atlassian tenant appears in the
  sources, the examples, the README or the bundled CLI.

## [0.3.0] - 2026-09-16

### Added
- `color_output` (boolean, default false) in the manifest: colourises `doctor`
  output by severity. Suppressed when stdout is not a TTY, when `$NO_COLOR` is
  set, and for `--json`.
- MCP servers can be declared inline in the manifest's `mcp` selector as
  `{ "<name>": { ...spec } }` objects, mixed with discovered names, paths and
  `"*"`. Inline wins over a discovered spec of the same name; `doctor` lists
  inline declarations and warns about such shadowing.

### Changed
- First release published to the public npm registry as
  `ai-workspace-hub`; install with `npm install -g ai-workspace-hub`.
- Repository moved to the `WarpDreams` organisation; package `homepage`,
  `bugs` and `repository` URLs updated accordingly.
- The README no longer points at a specific personal content repo; the
  content-repo layout is described in the README itself.

### Development
- Test suite (`npm test`, `node:test` via tsx) covering manifest validation,
  content discovery and shadowing, instruction composition and staleness,
  plan states, the install/uninstall/sync paths that touch disk, MCP spec
  matching and selector resolution, and the bundled CLI end to end. Every
  test runs against a throwaway `$HOME`/`$XDG_STATE_HOME`.
- GitHub Actions CI: typecheck and tests on Node 18/20/22/24 and macOS, plus
  a job that packs the tarball, installs it globally and runs the binary.
- `prepublishOnly` now runs the test suite as well as typecheck and build.

## [0.2.0] - 2026-09-14

### Changed
- `launch`: a target without `name` is now launched by its agent id; launch
  names (`name` ?? `agent`) must be unique, so a manifest with two targets for
  the same agent and no distinguishing `name` is rejected at load time instead
  of failing at launch.
- `commandline` as an array now means a **sequence of commands**: all but the
  last are pre-steps that must exit 0 (e.g. `"aws sso login"`), the last is
  the agent. Previously an array was a single argv.

## [0.1.0] - 2026-09-14

Initial release.

### Added
- `status`, `plan`, `install`, `sync`, `uninstall`: link or copy instruction
  fragments and skills into Claude Code, Codex and Kiro homes from a
  per-machine `.awh.jsonc` manifest, tracked in a ledger so only what awh
  created is ever removed.
- `doctor`: scan agent homes on the machine and report every instruction
  file, skill and user-scope MCP server as managed/unmanaged with sync state.
- `launch <target> [args...]`: run an agent CLI with its home env var set
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `KIRO_HOME`), with optional per-target
  `commandline`.
- MCP server management for public servers, driven exclusively through each
  agent's own `mcp add/remove` CLI so browser OAuth logins complete in the
  foreground; version-agnostic matching.
- Content discovery over `content_search_paths`: skills by `SKILL.md`,
  instructions under `instructions/`, MCP specs under `mcp/`; later paths
  override earlier ones with `doctor` warnings.
- Multi-fragment instruction composition, generated only by `install`/`sync`
  and reported as stale by read-only commands.

[Unreleased]: https://github.com/WarpDreams/ai-workspace-hub/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/WarpDreams/ai-workspace-hub/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/WarpDreams/ai-workspace-hub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/WarpDreams/ai-workspace-hub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/WarpDreams/ai-workspace-hub/releases/tag/v0.1.0
