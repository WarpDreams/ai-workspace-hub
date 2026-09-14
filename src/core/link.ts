import fs from "node:fs";
import path from "node:path";
import { isOwnedPath } from "./content";

/**
 * State of a destination path relative to a desired source, for a given
 * strategy. Used by planner and status.
 */
export type LinkState =
  | "missing" // nothing at destination
  | "linked" // symlink pointing at the expected source (symlink strategy)
  | "copied" // regular file/dir matching source (copy strategy — best-effort)
  | "wrong-link" // symlink to a different place, but still into our content
  | "foreign-link" // symlink to somewhere outside our content
  | "stale" // link/copy is in place, but the composed source is missing or out of date
  | "conflict"; // a real file/dir we did not create

export interface InspectResult {
  state: LinkState;
  /** For symlinks: the resolved link target. */
  linkTarget?: string;
}

/** True when `p` is a symlink whose target is inside our content roots or build dir. */
export function isOurs(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    if (!st.isSymbolicLink()) return false;
    const target = path.resolve(path.dirname(p), fs.readlinkSync(p));
    return isOwnedPath(target);
  } catch {
    return false;
  }
}

/**
 * Inspect a destination against the source we intend to install there.
 */
export function inspect(dest: string, source: string, strategy: "symlink" | "copy"): InspectResult {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dest);
  } catch {
    return { state: "missing" };
  }

  if (st.isSymbolicLink()) {
    const rawTarget = fs.readlinkSync(dest);
    const resolved = path.resolve(path.dirname(dest), rawTarget);
    if (strategy === "symlink") {
      if (resolved === path.resolve(source)) return { state: "linked", linkTarget: resolved };
    }
    if (isOurs(dest)) return { state: "wrong-link", linkTarget: resolved };
    return { state: "foreign-link", linkTarget: resolved };
  }

  // Regular file or directory.
  if (strategy === "copy") {
    // Best-effort: treat any existing regular path as a prior copy we can refresh.
    return { state: "copied" };
  }
  return { state: "conflict" };
}

/** Ensure the parent directory of `p` exists. */
export function ensureParent(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

/**
 * Create a symlink at `dest` pointing to `source`, replacing any existing
 * symlink we own. Never overwrites a real file/dir unless `force`.
 */
export function makeSymlink(dest: string, source: string, force = false): void {
  ensureParent(dest);
  let st: fs.Stats | undefined;
  try {
    st = fs.lstatSync(dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (st) {
    if (st.isSymbolicLink()) {
      fs.unlinkSync(dest);
    } else if (force) {
      fs.rmSync(dest, { recursive: true, force: true });
    } else {
      throw new Error(`Refusing to overwrite non-symlink path: ${dest}`);
    }
  }
  fs.symlinkSync(source, dest);
}

/** Recursively copy a file or directory from `source` to `dest`. */
export function copyPath(dest: string, source: string, force = false): void {
  ensureParent(dest);
  if (fs.existsSync(dest)) {
    if (!force && isOurs(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    } else if (force) {
      fs.rmSync(dest, { recursive: true, force: true });
    } else {
      // Refresh copy in place.
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }
  fs.cpSync(source, dest, { recursive: true });
}

/**
 * Remove a destination only if we own it (a symlink into the repo), or if it
 * is recorded in the ledger (caller decides via `ownedByLedger`).
 * Returns true if removed.
 */
export function removeIfOurs(dest: string, ownedByLedger = false): boolean {
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink()) {
      if (isOurs(dest) || ownedByLedger) {
        fs.unlinkSync(dest);
        return true;
      }
      return false;
    }
    // Regular path: only remove when the ledger says we created it (copy mode).
    if (ownedByLedger) {
      fs.rmSync(dest, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
