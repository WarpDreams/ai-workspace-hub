import type { AgentId } from "../config/schema";
import type { McpServerOnDisk, McpSpec } from "../core/mcp";

/**
 * An InstructionMapping tells the planner where a single logical instruction
 * unit should be materialized in an agent home, and how.
 *
 * - "single-file": all selected instruction fragments are composed into ONE
 *   destination file (e.g. Claude's CLAUDE.md, Codex's AGENTS.md).
 * - "per-fragment": each fragment maps to its own destination file
 *   (e.g. Kiro's steering/<name>.md).
 */
export interface InstructionMapping {
  mode: "single-file" | "per-fragment";
  /**
   * For "single-file": the single absolute destination path.
   * For "per-fragment": a function producing the destination for a fragment.
   */
  singleFile?: string;
  perFragment?: (fragmentName: string) => string;
}

export interface LaunchInfo {
  /** Env var the CLI reads to relocate its home/config directory. */
  homeEnvVar: string;
  /** Default executable when a target has no `commandline`. */
  command: string;
  /**
   * Env to set so the CLI uses `homeAbs`. Usually `{ [homeEnvVar]: homeAbs }`,
   * but an adapter may return {} for its default home when setting the var
   * would change behaviour (Claude: CLAUDE_CONFIG_DIR=~/.claude makes it read
   * ~/.claude/.claude.json instead of the normal ~/.claude.json).
   */
  envFor(homeAbs: string): Record<string, string>;
}

/**
 * How an agent's user-scope MCP servers are read (from its config file, read
 * only) and written (never directly — always through the agent's own CLI, run
 * in the foreground with the home env var set so browser-based OAuth logins
 * work and complete before the next server is touched).
 */
export interface McpSupport {
  /** Absolute path of the file holding user-scope MCP servers for this home. */
  configFile(homeAbs: string): string;
  /** Parse that file. Missing file => {}. */
  readServers(homeAbs: string): Record<string, McpServerOnDisk>;
  /** argv (including executable) that adds/overwrites `name` per `spec`, or undefined if unsupported. */
  addArgv(name: string, spec: McpSpec): string[] | undefined;
  /** True when add on an existing name overwrites instead of failing. */
  addOverwrites: boolean;
  /** True when the add itself starts an OAuth login for http servers. */
  addRunsLogin: boolean;
  /** argv that removes `name`. */
  removeArgv(name: string): string[];
  /** argv for an explicit interactive login, when the add does not do it. */
  loginArgv?(name: string, spec: McpSpec): string[];
}

export interface Adapter {
  id: AgentId;
  /** Human-friendly name for output. */
  displayName: string;
  /** How `awh launch` points this CLI at a target home. */
  launch: LaunchInfo;
  /** User-scope MCP server management. */
  mcp: McpSupport;

  /**
   * How this agent consumes global instructions, given an absolute home dir.
   */
  instructionMapping(homeAbs: string): InstructionMapping;

  /**
   * Absolute directory under which each skill is linked/copied as
   * <skillsRoot>/<skillName>.
   */
  skillsRoot(homeAbs: string): string;

  /**
   * Default home directory(ies) for this agent, probed by `doctor`. Values may
   * contain a leading ~. `doctor` additionally discovers `~/.<id>-*` siblings
   * (e.g. ~/.codex-backup) and any home the manifest declares, so only the
   * canonical default belongs here.
   */
  candidateHomes(): string[];
}
