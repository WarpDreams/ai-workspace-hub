# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/alienbat/ai-workspace-hub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alienbat/ai-workspace-hub/releases/tag/v0.1.0
