import fs from "node:fs";
import path from "node:path";
import type { Adapter, InstructionMapping } from "./types";
import type { McpServerOnDisk, McpSpec } from "../core/mcp";

/**
 * Kiro CLI:
 *   - global instructions: <home>/steering/<fragment>.md  (one file per fragment)
 *   - skills:              <home>/skills/<name>
 */
export const kiroAdapter: Adapter = {
  id: "kiro",
  displayName: "Kiro CLI",

  // KIRO_HOME overrides ~/.kiro (agents, steering, skills, settings, sessions).
  launch: { homeEnvVar: "KIRO_HOME", command: "kiro-cli", envFor: (homeAbs) => ({ KIRO_HOME: homeAbs }) },

  instructionMapping(homeAbs: string): InstructionMapping {
    return {
      mode: "per-fragment",
      perFragment: (fragmentName: string) =>
        path.join(homeAbs, "steering", `${fragmentName}.md`),
    };
  },

  skillsRoot(homeAbs: string): string {
    return path.join(homeAbs, "skills");
  },

  candidateHomes(): string[] {
    return ["~/.kiro"];
  },

  // User-scope MCP servers: <home>/settings/mcp.json (`mcpServers`). Writes go
  // through `kiro-cli mcp add/remove --scope global`. UNTESTED: kiro-cli is
  // not installed on the machine this was developed on; stdio only for now.
  mcp: {
    configFile(homeAbs) {
      return path.join(homeAbs, "settings", "mcp.json");
    },
    readServers(homeAbs) {
      const file = path.join(homeAbs, "settings", "mcp.json");
      if (!fs.existsSync(file)) return {};
      let data: any;
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        return {};
      }
      const out: Record<string, McpServerOnDisk> = {};
      for (const [name, v] of Object.entries<any>(data?.mcpServers ?? {})) {
        const type = v?.url ? "http" : v?.command ? "stdio" : "other";
        out[name] = { type, command: v?.command, args: v?.args, env: v?.env, url: v?.url, disabled: v?.disabled === true, raw: v };
      }
      return out;
    },
    addArgv(name: string, spec: McpSpec) {
      if (spec.type !== "stdio") return undefined;
      const args = spec.args.flatMap((a) => ["--args", a]);
      const env = Object.entries(spec.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
      return ["kiro-cli", "mcp", "add", "--name", name, "--command", spec.command!, ...args, ...env, "--scope", "global", "--force"];
    },
    addOverwrites: true, // --force
    addRunsLogin: false,
    removeArgv(name: string) {
      return ["kiro-cli", "mcp", "remove", "--name", name, "--scope", "global"];
    },
  },
};
