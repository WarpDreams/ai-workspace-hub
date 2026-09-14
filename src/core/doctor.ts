import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentId, Manifest } from "../config/schema";
import { resolveTargets } from "../config/schema";
import { allAdapters, type Adapter } from "../adapters/index";
import { absPath } from "../util/paths";
import { isOurs } from "./link";
import { loadLedger, type Ledger } from "./state";
import { buildPlan, type PlanOp } from "./plan";
import { composedMatches, isComposed } from "./content";

/**
 * `doctor` inspects what is actually deployed on this machine — every agent
 * home it can find, that home's global instruction file(s), and every
 * installed skill — regardless of whether awh manages them. Each item is
 * marked managed/unmanaged, and when a manifest is loaded, managed items are
 * also checked for whether they are in sync with what the manifest wants.
 */

/** How an installed item is managed by awh, or null when it is not ours. */
export type Managed = "symlink" | "copy" | null;

export type SyncStatus =
  | "in-sync" // managed, matches the manifest's desired source
  | "out-of-sync" // managed, but content/link differs from desired source
  | "not-installed" // manifest wants it, nothing on disk
  | "conflict" // manifest wants it, but an unmanaged file/dir is in the way
  | "orphan" // managed by awh, but no longer in the manifest
  | "unmanaged"; // not ours and not wanted by the manifest — left alone

export interface DoctorItem {
  kind: "instruction" | "skill";
  /** Display name: file name for instructions, directory name for skills. */
  name: string;
  dest: string;
  present: boolean;
  managed: Managed;
  /** For symlinks: the resolved link target. */
  linkTarget?: string;
  /** Only set when a manifest was loaded and this home is an enabled target. */
  sync?: SyncStatus;
  detail?: string;
}

export interface DoctorHome {
  agent: AgentId;
  homeAbs: string;
  exists: boolean;
  /**
   * undefined = no manifest loaded; null = not a target in the manifest;
   * otherwise the target's label/disabled flag.
   */
  target?: { label?: string; disabled: boolean } | null;
  instructions: DoctorItem[];
  skills: DoctorItem[];
}

export interface DoctorReport {
  manifestPath?: string;
  homes: DoctorHome[];
}

/**
 * Discover agent homes on this machine for one adapter: the adapter's default
 * candidate(s), any `~/.<agent>-*` sibling directories (e.g. `~/.codex-backup`),
 * and any home the manifest declares for this agent.
 */
function discoverHomes(adapter: Adapter, manifestHomes: string[]): string[] {
  const found = new Set<string>();
  for (const c of adapter.candidateHomes()) found.add(absPath(c));

  const home = os.homedir();
  const pattern = new RegExp(`^\\.${adapter.id}(-[A-Za-z0-9_.-]+)?$`);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    // unreadable home dir — fall through with candidates only
  }
  for (const e of entries) {
    if (!pattern.test(e.name)) continue;
    const abs = path.join(home, e.name);
    try {
      if (fs.statSync(abs).isDirectory()) found.add(abs);
    } catch {
      // dangling symlink etc. — ignore
    }
  }
  for (const h of manifestHomes) found.add(h);
  return [...found].sort();
}

function detectManaged(dest: string, ledger: Ledger): { managed: Managed; linkTarget?: string } {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dest);
  } catch {
    return { managed: null };
  }
  let linkTarget: string | undefined;
  if (st.isSymbolicLink()) {
    linkTarget = path.resolve(path.dirname(dest), fs.readlinkSync(dest));
    if (isOurs(dest)) return { managed: "symlink", linkTarget };
  }
  const entry = ledger.entries.find((e) => e.dest === dest);
  if (entry) return { managed: entry.strategy, linkTarget };
  return { managed: null, linkTarget };
}

/** Best-effort recursive content comparison for copy-mode sync checks. */
function sameContent(a: string, b: string): boolean {
  let sa: fs.Stats, sb: fs.Stats;
  try {
    sa = fs.statSync(a);
    sb = fs.statSync(b);
  } catch {
    return false;
  }
  if (sa.isDirectory() !== sb.isDirectory()) return false;
  if (sa.isDirectory()) {
    const la = fs.readdirSync(a).sort();
    const lb = fs.readdirSync(b).sort();
    if (la.length !== lb.length || la.some((n, i) => n !== lb[i])) return false;
    return la.every((n) => sameContent(path.join(a, n), path.join(b, n)));
  }
  if (sa.size !== sb.size) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

function syncFor(item: DoctorItem, op: PlanOp | undefined): { sync: SyncStatus; detail?: string } {
  if (!op) {
    if (item.managed) return { sync: "orphan", detail: "managed by awh but not in the manifest; `sync` would remove it" };
    return { sync: "unmanaged" };
  }
  if (!item.present) return { sync: "not-installed" };
  if (!item.managed) return { sync: "conflict", detail: "unmanaged path is in the way; `install --force` would replace it" };

  const composite = op.fragments !== undefined && isComposed(op.fragments);
  if (op.strategy === "symlink") {
    if (op.state === "linked") return { sync: "in-sync" };
    if (op.state === "stale") {
      return { sync: "out-of-sync", detail: "composed instructions are stale; run `install` or `sync` to regenerate" };
    }
    if (item.managed === "copy") return { sync: "out-of-sync", detail: "is a copy, manifest wants a symlink" };
    return { sync: "out-of-sync", detail: `links to ${item.linkTarget ?? "?"}, manifest wants ${op.source}` };
  }
  // copy strategy
  if (item.managed === "symlink") return { sync: "out-of-sync", detail: "is a symlink, manifest wants a copy" };
  const matches = composite ? composedMatches(op.fragments!, op.dest) : sameContent(op.dest, op.source);
  return matches
    ? { sync: "in-sync" }
    : { sync: "out-of-sync", detail: "copy differs from repo content; run `sync` to refresh" };
}

function listInstructions(adapter: Adapter, homeAbs: string): string[] {
  const mapping = adapter.instructionMapping(homeAbs);
  if (mapping.mode === "single-file") {
    return fs.existsSync(mapping.singleFile!) ? [mapping.singleFile!] : [];
  }
  // per-fragment: everything under the steering dir. Derive the dir from a probe path.
  const dir = path.dirname(mapping.perFragment!("probe"));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => path.join(dir, f));
}

function listSkills(adapter: Adapter, homeAbs: string): string[] {
  const root = adapter.skillsRoot(homeAbs);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    // Skip dot-entries: agent-internal dirs like Codex's skills/.system, never user skills.
    .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith("."))
    .map((d) => path.join(root, d.name))
    .sort();
}

export function buildDoctorReport(loaded?: { path: string; manifest: Manifest }): DoctorReport {
  const ledger = loadLedger();

  // Manifest-derived lookups.
  const targets = loaded ? resolveTargets(loaded.manifest) : [];
  const targetKey = (agent: string, homeAbs: string) => `${agent}:${homeAbs}`;
  const targetInfo = new Map<string, { label?: string; disabled: boolean }>();
  for (const t of targets) targetInfo.set(targetKey(t.agent, absPath(t.home)), { label: t.label, disabled: t.disabled });

  const opsByHome = new Map<string, Map<string, PlanOp>>();
  if (loaded) {
    for (const tp of buildPlan(loaded.manifest).targets) {
      const m = new Map<string, PlanOp>();
      for (const op of tp.ops) m.set(op.dest, op);
      opsByHome.set(targetKey(tp.target.agent, tp.homeAbs), m);
    }
  }

  const homes: DoctorHome[] = [];
  for (const adapter of allAdapters()) {
    const manifestHomes = targets.filter((t) => t.agent === adapter.id).map((t) => absPath(t.home));
    for (const homeAbs of discoverHomes(adapter, manifestHomes)) {
      const key = targetKey(adapter.id, homeAbs);
      const exists = fs.existsSync(homeAbs);
      const target = loaded ? (targetInfo.get(key) ?? null) : undefined;
      // Only report homes that exist, or that the manifest expects to exist.
      if (!exists && !target) continue;

      const ops = opsByHome.get(key);
      const checkSync = Boolean(loaded && target && !target.disabled);

      const makeItem = (kind: DoctorItem["kind"], dest: string): DoctorItem => {
        const present = fs.existsSync(dest) || isSymlink(dest);
        const { managed, linkTarget } = detectManaged(dest, ledger);
        const item: DoctorItem = { kind, name: path.basename(dest), dest, present, managed, linkTarget };
        if (checkSync) {
          const { sync, detail } = syncFor(item, ops?.get(dest));
          item.sync = sync;
          item.detail = detail;
        } else if (loaded && managed) {
          // Home is not an (enabled) target: anything we manage here is an orphan.
          item.sync = "orphan";
          item.detail = "managed by awh but this home is not an enabled manifest target";
        }
        return item;
      };

      // Union of what is on disk and what the manifest wants, keyed by dest.
      const instrDests = new Set<string>(exists ? listInstructions(adapter, homeAbs) : []);
      const skillDests = new Set<string>(exists ? listSkills(adapter, homeAbs) : []);
      if (checkSync && ops) {
        for (const op of ops.values()) (op.kind === "instruction" ? instrDests : skillDests).add(op.dest);
      }

      homes.push({
        agent: adapter.id,
        homeAbs,
        exists,
        target,
        instructions: [...instrDests].sort().map((d) => makeItem("instruction", d)),
        skills: [...skillDests].sort().map((d) => makeItem("skill", d)),
      });
    }
  }

  return { manifestPath: loaded?.path, homes };
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
