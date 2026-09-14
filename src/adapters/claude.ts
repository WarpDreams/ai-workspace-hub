import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Adapter, InstructionMapping } from "./types";
import type { McpServerOnDisk, McpSpec } from "../core/mcp";

function isDefaultClaudeHome(homeAbs: string): boolean {
  return path.resolve(homeAbs) === path.join(os.homedir(), ".claude");
}

/** `.claude.json`: ~/.claude.json for the default home, else inside the config dir. */
function claudeStateFile(homeAbs: string): string {
  return isDefaultClaudeHome(homeAbs) ? path.join(os.homedir(), ".claude.json") : path.join(homeAbs, ".claude.json");
}

/**
 * Claude Code:
 *   - global instructions: <home>/CLAUDE.md  (single composed file)
 *   - skills:              <home>/skills/<name>
 */
export const claudeAdapter: Adapter = {
  id: "claude",
  displayName: "Claude Code",

  // CLAUDE_CONFIG_DIR overrides ~/.claude (settings, sessions, plugins, skills).
  // For the default home we must NOT set it: Claude then looks for
  // ~/.claude/.claude.json instead of the real ~/.claude.json.
  launch: {
    homeEnvVar: "CLAUDE_CONFIG_DIR",
    command: "claude",
    envFor(homeAbs): Record<string, string> {
      return isDefaultClaudeHome(homeAbs) ? {} : { CLAUDE_CONFIG_DIR: homeAbs };
    },
  },

  instructionMapping(homeAbs: string): InstructionMapping {
    return {
      mode: "single-file",
      singleFile: path.join(homeAbs, "CLAUDE.md"),
    };
  },

  skillsRoot(homeAbs: string): string {
    return path.join(homeAbs, "skills");
  },

  candidateHomes(): string[] {
    return ["~/.claude"];
  },

  // User-scope MCP servers live in `.claude.json` INSIDE the config dir
  // (~/.claude.json by default, $CLAUDE_CONFIG_DIR/.claude.json otherwise).
  // That file also holds account/state data, so it is only ever read here;
  // writes go through `claude mcp add-json/remove -s user`.
  mcp: {
    configFile(homeAbs) {
      return claudeStateFile(homeAbs);
    },
    readServers(homeAbs) {
      const file = claudeStateFile(homeAbs);
      if (!fs.existsSync(file)) return {};
      let data: any;
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        return {};
      }
      const out: Record<string, McpServerOnDisk> = {};
      for (const [name, v] of Object.entries<any>(data?.mcpServers ?? {})) {
        const type = v?.type ?? (v?.url ? "http" : "stdio");
        out[name] = {
          type: type === "stdio" || type === "http" ? type : "other",
          command: v?.command,
          args: v?.args,
          env: v?.env,
          url: v?.url,
          raw: v,
        };
      }
      return out;
    },
    addArgv(name: string, spec: McpSpec) {
      const json =
        spec.type === "http"
          ? { type: "http", url: spec.url }
          : { type: "stdio", command: spec.command, args: spec.args, ...(Object.keys(spec.env).length ? { env: spec.env } : {}) };
      return ["claude", "mcp", "add-json", "-s", "user", name, JSON.stringify(json)];
    },
    addOverwrites: false, // "already exists in user config" -> remove first
    addRunsLogin: false,
    removeArgv(name: string) {
      return ["claude", "mcp", "remove", "-s", "user", name];
    },
    loginArgv(name: string, spec: McpSpec) {
      return spec.type === "http" ? ["claude", "mcp", "login", name] : undefined!;
    },
  },
};
