import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Adapter, InstructionMapping } from "./types";
import type { McpServerOnDisk, McpSpec } from "../core/mcp";

/**
 * Codex CLI:
 *   - global instructions: <home>/AGENTS.md  (single composed file)
 *   - skills:              <home>/skills/<name>
 */
export const codexAdapter: Adapter = {
  id: "codex",
  displayName: "Codex CLI",

  // CODEX_HOME overrides ~/.codex (config.toml, AGENTS.md, skills).
  launch: { homeEnvVar: "CODEX_HOME", command: "codex", envFor: (homeAbs) => ({ CODEX_HOME: homeAbs }) },

  instructionMapping(homeAbs: string): InstructionMapping {
    return {
      mode: "single-file",
      singleFile: path.join(homeAbs, "AGENTS.md"),
    };
  },

  skillsRoot(homeAbs: string): string {
    return path.join(homeAbs, "skills");
  },

  candidateHomes(): string[] {
    return ["~/.codex"];
  },

  // User-scope MCP servers are `[mcp_servers.<name>]` tables in config.toml,
  // which also holds model/profile/sandbox settings. Read only here; writes go
  // through `codex mcp add/remove`, which overwrites an existing name and, for
  // http servers with OAuth support, starts the browser login itself.
  mcp: {
    configFile(homeAbs) {
      return path.join(homeAbs, "config.toml");
    },
    readServers(homeAbs) {
      const file = path.join(homeAbs, "config.toml");
      if (!fs.existsSync(file)) return {};
      let data: any;
      try {
        data = parseToml(fs.readFileSync(file, "utf8"));
      } catch {
        return {};
      }
      const out: Record<string, McpServerOnDisk> = {};
      for (const [name, v] of Object.entries<any>(data?.mcp_servers ?? {})) {
        const type = v?.url ? "http" : v?.command ? "stdio" : "other";
        out[name] = {
          type,
          command: v?.command,
          args: v?.args,
          env: v?.env,
          url: v?.url,
          disabled: v?.enabled === false,
          raw: v,
        };
      }
      return out;
    },
    addArgv(name: string, spec: McpSpec) {
      if (spec.type === "http") return ["codex", "mcp", "add", name, "--url", spec.url!];
      const env = Object.entries(spec.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
      return ["codex", "mcp", "add", name, ...env, "--", spec.command!, ...spec.args];
    },
    addOverwrites: true,
    addRunsLogin: true,
    removeArgv(name: string) {
      return ["codex", "mcp", "remove", name];
    },
  },
};
