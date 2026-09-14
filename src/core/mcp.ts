import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";
import { AGENT_IDS, type AgentId, type SkillSelector } from "../config/schema";
import { absPathFrom } from "../util/paths";
import { contentIndex, looksLikePath } from "./content";

/**
 * Canonical MCP server definitions are <name>.jsonc files under a directory
 * named `mcp` in a content search path, in the
 * de-facto standard `mcpServers` entry shape (command/args/env or url).
 * Only "public" servers are in scope: hosted HTTP endpoints, or packages run
 * through a runner such as npx/uvx. Nothing here is written to agent config
 * files directly — install/sync drive each agent's own `mcp add/remove` CLI.
 */

export type McpTransport = "stdio" | "http";

const McpSpecSchema = z
  .object({
    type: z.enum(["stdio", "http"]).optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    url: z.string().url().optional(),
    /** Restrict to these agents; default: every agent. */
    agents: z.array(z.enum(AGENT_IDS)).optional(),
    /**
     * For http servers: run the agent's interactive login after adding, where
     * the add itself does not already do so. Default true.
     */
    login: z.boolean().default(true),
    description: z.string().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const type = s.type ?? (s.url ? "http" : "stdio");
    if (type === "stdio" && !s.command) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stdio server needs `command`" });
    if (type === "http" && !s.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "http server needs `url`" });
    if (type === "http" && (s.command || s.args.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "http server must not have `command`/`args`" });
    }
  });

export interface McpSpec {
  name: string;
  type: McpTransport;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  agents?: AgentId[];
  login: boolean;
  description?: string;
  /** Absolute path of the .jsonc this came from. */
  file: string;
}

/** Names of discovered MCP specs. */
export function availableMcp(): string[] {
  return [...contentIndex().mcp.keys()].sort();
}

export function mcpSpecPath(entry: string): string {
  const idx = contentIndex();
  if (looksLikePath(entry)) return absPathFrom(idx.base, entry);
  const item = idx.mcp.get(entry);
  return item ? item.path : path.join(idx.base, "mcp", `${entry}.jsonc`);
}

export function loadMcpSpec(entry: string): McpSpec {
  const file = mcpSpecPath(entry);
  const name = path.basename(file).replace(/\.jsonc?$/, "");
  const raw = fs.readFileSync(file, "utf8");
  const errors: ParseError[] = [];
  const data = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length) {
    const d = errors.map((e) => `  - ${printParseErrorCode(e.error)} at offset ${e.offset}`).join("\n");
    throw new Error(`Failed to parse ${file} as JSONC:\n${d}`);
  }
  const res = McpSpecSchema.safeParse(data);
  if (!res.success) {
    const d = res.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid MCP spec ${file}:\n${d}`);
  }
  const s = res.data;
  return {
    name,
    type: s.type ?? (s.url ? "http" : "stdio"),
    command: s.command,
    args: s.args,
    env: s.env,
    url: s.url,
    agents: s.agents,
    login: s.login,
    description: s.description,
    file,
  };
}

/** Resolve a manifest `mcp` selector ("*" | [names/paths]) against the mcp root. */
export function resolveMcpSelection(sel: SkillSelector): string[] {
  if (sel === "*") return availableMcp();
  const missing = sel.filter((s) => !fs.existsSync(mcpSpecPath(s)));
  if (missing.length) {
    throw new Error(
      `MCP spec(s) not found: ${missing.map(mcpSpecPath).join(", ")}. Discovered (under mcp/ dirs in the search paths): ${availableMcp().join(", ") || "(none)"}`,
    );
  }
  return sel;
}

/** What an agent currently has configured for one server, normalized. */
export interface McpServerOnDisk {
  type: McpTransport | "other";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** Whether the agent has it disabled (Codex `enabled = false`, Kiro `disabled: true`). */
  disabled?: boolean;
  raw: unknown;
}

/**
 * Version-agnostic argument normalization: `@scope/pkg@1.2.3`, `pkg@latest`,
 * `pkg@^2` all collapse to the bare package name. We do not track versions,
 * only whether the same server is configured.
 */
export function normalizeArg(a: string): string {
  const m = /^(@?[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)?)@[^/\s]+$/.exec(a);
  return m ? m[1] : a;
}

/** True when what is on disk is "the same server" as the spec (ignoring versions). */
export function specMatches(spec: McpSpec, disk: McpServerOnDisk): boolean {
  if (disk.type !== spec.type) return false;
  if (disk.disabled) return false;
  if (spec.type === "http") return (disk.url ?? "").replace(/\/+$/, "") === (spec.url ?? "").replace(/\/+$/, "");
  if ((disk.command ?? "") !== (spec.command ?? "")) return false;
  const a = (disk.args ?? []).map(normalizeArg);
  const b = spec.args.map(normalizeArg);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return false;
  const de = disk.env ?? {};
  const se = spec.env;
  const keys = new Set([...Object.keys(de), ...Object.keys(se)]);
  for (const k of keys) if (de[k] !== se[k]) return false;
  return true;
}

/** One-line summary of a spec for output. */
export function describeSpec(spec: McpSpec): string {
  return spec.type === "http" ? `http ${spec.url}` : `stdio ${[spec.command, ...spec.args].join(" ")}`;
}

/** One-line summary of an on-disk entry for output. */
export function describeDisk(d: McpServerOnDisk): string {
  if (d.type === "http") return `http ${d.url ?? "?"}`;
  if (d.type === "stdio") return `stdio ${[d.command ?? "?", ...(d.args ?? [])].join(" ")}`;
  return "other";
}
