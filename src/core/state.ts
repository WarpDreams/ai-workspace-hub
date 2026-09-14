import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The ledger records every destination path this tool created, so uninstall
 * and sync can remove exactly what we own — including copy-mode files that are
 * not self-identifying like symlinks are.
 */

export interface LedgerEntry {
  /** Filesystem path we created, or for MCP servers a key `mcp:<agent>:<home>:<name>`. */
  dest: string;
  source: string;
  strategy: "symlink" | "copy" | "cli";
  kind: "instruction" | "skill" | "mcp";
  agent: string;
  home: string;
  createdAt: string;
}

export interface Ledger {
  version: 1;
  entries: LedgerEntry[];
}

function stateDir(): string {
  const base =
    process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim() !== ""
      ? process.env.XDG_STATE_HOME
      : path.join(os.homedir(), ".local", "state");
  return path.join(base, "ai-workspace-hub");
}

export function ledgerPath(): string {
  return path.join(stateDir(), "ledger.json");
}

export function loadLedger(): Ledger {
  const p = ledgerPath();
  if (!fs.existsSync(p)) return { version: 1, entries: [] };
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (data && data.version === 1 && Array.isArray(data.entries)) return data as Ledger;
  } catch {
    // Corrupt ledger — start fresh rather than block operations.
  }
  return { version: 1, entries: [] };
}

export function saveLedger(ledger: Ledger): void {
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

/** Upsert an entry keyed by dest. */
export function recordEntry(ledger: Ledger, entry: LedgerEntry): void {
  const idx = ledger.entries.findIndex((e) => e.dest === entry.dest);
  if (idx >= 0) ledger.entries[idx] = entry;
  else ledger.entries.push(entry);
}

/** Remove an entry by dest. Returns true if present. */
export function forgetEntry(ledger: Ledger, dest: string): boolean {
  const before = ledger.entries.length;
  ledger.entries = ledger.entries.filter((e) => e.dest !== dest);
  return ledger.entries.length !== before;
}

export function hasEntry(ledger: Ledger, dest: string): boolean {
  return ledger.entries.some((e) => e.dest === dest);
}

/** Ledger key for an MCP server managed through an agent's CLI. */
export function mcpLedgerKey(agent: string, homeAbs: string, name: string): string {
  return `mcp:${agent}:${homeAbs}:${name}`;
}

export function parseMcpLedgerKey(key: string): { agent: string; homeAbs: string; name: string } | undefined {
  const m = /^mcp:([^:]+):(.+):([^:]+)$/.exec(key);
  return m ? { agent: m[1], homeAbs: m[2], name: m[3] } : undefined;
}
