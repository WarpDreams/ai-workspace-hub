import { spawnSync } from "node:child_process";
import { copyPath, makeSymlink, removeIfOurs } from "./link";
import { isComposed, writeComposedInstructions } from "./content";
import {
  forgetEntry,
  hasEntry,
  loadLedger,
  mcpLedgerKey,
  parseMcpLedgerKey,
  recordEntry,
  saveLedger,
  type Ledger,
} from "./state";
import type { McpOp, Plan, PlanOp } from "./plan";
import { getAdapter } from "../adapters/index";
import type { AgentId } from "../config/schema";
import { tildify } from "../util/paths";

export interface ApplyOptions {
  /** Overwrite real (non-symlink) conflicts. Off by default. */
  force?: boolean;
  /** Compute actions but do not touch disk. */
  dryRun?: boolean;
}

export type McpAction = "add" | "readd" | "remove" | "login" | "adopt" | "skip";

export interface McpApplyRecord {
  agent: string;
  home: string;
  name: string;
  action: McpAction;
  /** The vendor command that was (or would be) run. */
  argv?: string[];
  ok: boolean;
  exitCode?: number;
  reason?: string;
}

export interface ApplyResult {
  installed: PlanOp[];
  skipped: { op: PlanOp; reason: string }[];
  removed: string[];
  mcp: McpApplyRecord[];
}

/**
 * Run one vendor MCP command in the foreground with the agent's home env var
 * set. stdio is inherited so the CLI can print an OAuth URL, open the browser
 * and wait on its own callback listener; we block until it exits, so logins
 * for different servers/agents never overlap.
 */
function runVendor(agent: AgentId, homeAbs: string, argv: string[]): { ok: boolean; exitCode?: number; reason?: string } {
  const adapter = getAdapter(agent);
  console.log(`\n▶ ${agent} (${tildify(homeAbs)}): ${argv.join(" ")}`);
  const res = spawnSync(argv[0], argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, ...adapter.launch.envFor(homeAbs) },
  });
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    const reason = code === "ENOENT" ? `command not found: ${argv[0]} (is the ${agent} CLI installed?)` : res.error.message;
    return { ok: false, reason };
  }
  const exitCode = res.status ?? 1;
  return exitCode === 0 ? { ok: true, exitCode } : { ok: false, exitCode, reason: `exited with code ${exitCode}` };
}

function mcpEntry(op: McpOp) {
  return {
    dest: mcpLedgerKey(op.agent, op.home, op.name),
    source: op.spec.file,
    strategy: "cli" as const,
    kind: "mcp" as const,
    agent: op.agent,
    home: op.home,
    createdAt: new Date().toISOString(),
  };
}

/** Install/repair one MCP server through the agent's CLI. */
function applyMcpOp(op: McpOp, ledger: Ledger, opts: ApplyOptions, result: ApplyResult): void {
  const adapter = getAdapter(op.agent);
  const base = { agent: op.agent, home: op.home, name: op.name };
  const rec = (r: Omit<McpApplyRecord, "agent" | "home" | "name">): void => {
    result.mcp.push({ ...base, ...r });
  };

  if (op.state === "unsupported") return rec({ action: "skip", ok: false, reason: op.reason });
  if (op.state === "installed") {
    if (!opts.dryRun) recordEntry(ledger, mcpEntry(op));
    return rec({ action: "adopt", ok: true });
  }
  if (op.state === "conflict" && !opts.force) {
    return rec({ action: "skip", ok: false, reason: `"${op.name}" already configured differently by something else (use --force to replace)` });
  }

  const readd = op.state !== "missing";
  const addArgv = adapter.mcp.addArgv(op.name, op.spec)!;
  const steps: { action: McpAction; argv: string[] }[] = [];
  if (readd && !adapter.mcp.addOverwrites) steps.push({ action: "remove", argv: adapter.mcp.removeArgv(op.name) });
  steps.push({ action: readd ? "readd" : "add", argv: addArgv });
  if (op.spec.type === "http" && op.spec.login && !adapter.mcp.addRunsLogin && adapter.mcp.loginArgv) {
    const l = adapter.mcp.loginArgv(op.name, op.spec);
    if (l) steps.push({ action: "login", argv: l });
  }

  for (const step of steps) {
    if (opts.dryRun) {
      rec({ action: step.action, argv: step.argv, ok: true });
      continue;
    }
    if (step.action === "login" && !process.stdin.isTTY) {
      // Vendor logins need an interactive terminal (they prompt / open a browser
      // and wait). Don't fail the install over it; tell the user what to run.
      rec({
        action: "skip",
        argv: step.argv,
        ok: true,
        reason: `login needs an interactive terminal — run: ${step.argv.join(" ")}`,
      });
      continue;
    }
    const r = runVendor(op.agent, op.home, step.argv);
    rec({ action: step.action, argv: step.argv, ...r });
    if (!r.ok && step.action !== "login") return; // login failure leaves the server added; report and continue
    if ((step.action === "add" || step.action === "readd") && r.ok) recordEntry(ledger, mcpEntry(op));
  }
}

/** Remove one managed MCP server through the agent's CLI. */
function removeMcp(agent: AgentId, homeAbs: string, name: string, ledger: Ledger, opts: ApplyOptions, result: ApplyResult): void {
  const argv = getAdapter(agent).mcp.removeArgv(name);
  const key = mcpLedgerKey(agent, homeAbs, name);
  if (opts.dryRun) {
    result.mcp.push({ agent, home: homeAbs, name, action: "remove", argv, ok: true });
    return;
  }
  const r = runVendor(agent, homeAbs, argv);
  result.mcp.push({ agent, home: homeAbs, name, action: "remove", argv, ...r });
  if (r.ok) forgetEntry(ledger, key);
}

/** Install every op in the plan. */
export function applyInstall(plan: Plan, opts: ApplyOptions = {}): ApplyResult {
  const ledger = loadLedger();
  const result: ApplyResult = { installed: [], skipped: [], removed: [], mcp: [] };

  for (const tp of plan.targets) {
    for (const op of tp.ops) {
      if (op.state === "conflict" && !opts.force) {
        result.skipped.push({
          op,
          reason: `real file/dir already exists at ${op.dest} (use --force to replace)`,
        });
        continue;
      }
      if (op.state === "foreign-link" && !opts.force) {
        result.skipped.push({
          op,
          reason: `symlink points outside this repo (${op.dest}); use --force to replace`,
        });
        continue;
      }
      // Composite instructions are only materialized here (never by plan/status).
      const composite = op.fragments !== undefined && isComposed(op.fragments);
      if (composite && !opts.dryRun) writeComposedInstructions(op.fragments!);

      if (op.state === "linked" || (op.state === "stale" && op.strategy === "symlink")) {
        // Link already correct (and, for stale, the composite was just
        // refreshed above); ensure it is tracked, then move on.
        if (!opts.dryRun) {
          recordEntry(ledger, entryFor(op));
        }
        result.installed.push(op);
        continue;
      }

      if (!opts.dryRun) {
        if (op.strategy === "symlink") {
          makeSymlink(op.dest, op.source, opts.force ?? false);
        } else {
          copyPath(op.dest, op.source, opts.force ?? false);
        }
        recordEntry(ledger, entryFor(op));
      }
      result.installed.push(op);
    }
  }

  // MCP servers: sequential, foreground, one vendor command at a time.
  for (const tp of plan.targets) {
    for (const op of tp.mcp) {
      applyMcpOp(op, ledger, opts, result);
      if (!opts.dryRun) saveLedger(ledger); // persist after each so an interrupted login doesn't lose earlier adds
    }
  }

  if (!opts.dryRun) saveLedger(ledger);
  return result;
}

/** Uninstall every op in the plan (only removes paths we own / tracked). */
export function applyUninstall(plan: Plan, opts: ApplyOptions = {}): ApplyResult {
  const ledger = loadLedger();
  const result: ApplyResult = { installed: [], skipped: [], removed: [], mcp: [] };

  for (const tp of plan.targets) {
    for (const op of tp.ops) {
      const owned = hasEntry(ledger, op.dest);
      if (opts.dryRun) {
        if (op.state === "linked" || op.state === "wrong-link" || owned) {
          result.removed.push(op.dest);
        } else {
          result.skipped.push({ op, reason: `not owned by this tool: ${op.dest}` });
        }
        continue;
      }
      const removed = removeIfOurs(op.dest, owned);
      if (removed) {
        forgetEntry(ledger, op.dest);
        result.removed.push(op.dest);
      } else {
        result.skipped.push({ op, reason: `not owned by this tool: ${op.dest}` });
      }
    }
    for (const op of tp.mcp) {
      if (op.managed) removeMcp(op.agent, op.home, op.name, ledger, opts, result);
      else result.mcp.push({ agent: op.agent, home: op.home, name: op.name, action: "skip", ok: false, reason: "not managed by this tool" });
    }
  }

  if (!opts.dryRun) saveLedger(ledger);
  return result;
}

/**
 * Sync = install the current plan, then prune ledger entries that are no longer
 * part of the plan (orphans left by removed targets/skills).
 */
export function applySync(plan: Plan, opts: ApplyOptions = {}): ApplyResult {
  const result = applyInstall(plan, opts);

  const desired = new Set<string>();
  for (const tp of plan.targets) {
    for (const op of tp.ops) desired.add(op.dest);
    for (const op of tp.mcp) desired.add(mcpLedgerKey(op.agent, op.home, op.name));
  }

  const ledger = loadLedger();
  const orphans = ledger.entries.filter((e) => !desired.has(e.dest));
  for (const orphan of orphans) {
    if (orphan.kind === "mcp") {
      const k = parseMcpLedgerKey(orphan.dest);
      if (k) removeMcp(k.agent as AgentId, k.homeAbs, k.name, ledger, opts, result);
      continue;
    }
    if (opts.dryRun) {
      result.removed.push(orphan.dest);
      continue;
    }
    const removed = removeIfOurs(orphan.dest, true);
    if (removed) {
      forgetEntry(ledger, orphan.dest);
      result.removed.push(orphan.dest);
    }
  }
  if (!opts.dryRun) saveLedger(ledger);
  return result;
}

function entryFor(op: PlanOp) {
  return {
    dest: op.dest,
    source: op.source,
    strategy: op.strategy,
    kind: op.kind,
    agent: op.agent,
    home: op.home,
    createdAt: new Date().toISOString(),
  };
}
