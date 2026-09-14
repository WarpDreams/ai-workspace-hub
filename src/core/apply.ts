import { copyPath, makeSymlink, removeIfOurs } from "./link";
import { isComposed, writeComposedInstructions } from "./content";
import {
  forgetEntry,
  hasEntry,
  loadLedger,
  recordEntry,
  saveLedger,
} from "./state";
import type { Plan, PlanOp } from "./plan";

export interface ApplyOptions {
  /** Overwrite real (non-symlink) conflicts. Off by default. */
  force?: boolean;
  /** Compute actions but do not touch disk. */
  dryRun?: boolean;
}

export interface ApplyResult {
  installed: PlanOp[];
  skipped: { op: PlanOp; reason: string }[];
  removed: string[];
}

/** Install every op in the plan. */
export function applyInstall(plan: Plan, opts: ApplyOptions = {}): ApplyResult {
  const ledger = loadLedger();
  const result: ApplyResult = { installed: [], skipped: [], removed: [] };

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

  if (!opts.dryRun) saveLedger(ledger);
  return result;
}

/** Uninstall every op in the plan (only removes paths we own / tracked). */
export function applyUninstall(plan: Plan, opts: ApplyOptions = {}): ApplyResult {
  const ledger = loadLedger();
  const result: ApplyResult = { installed: [], skipped: [], removed: [] };

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
  for (const tp of plan.targets) for (const op of tp.ops) desired.add(op.dest);

  const ledger = loadLedger();
  const orphans = ledger.entries.filter((e) => !desired.has(e.dest));
  for (const orphan of orphans) {
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
