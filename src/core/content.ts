import fs from "node:fs";
import path from "node:path";
import { absPathFrom, buildDir, isUnder } from "../util/paths";
import type { SkillSelector } from "../config/schema";

/**
 * Canonical content lives outside this tool. The manifest's
 * `content_search_paths` (default ["."] = the manifest's own directory) are
 * scanned recursively and items are recognised by shape:
 *
 *   skill        any directory containing SKILL.md (not descended into)
 *   instruction  any .md file under a directory named `instructions`
 *   mcp spec     any .json/.jsonc file under a directory named `mcp`
 *
 * `.git`, `node_modules` and dot-directories are skipped; symlinked directories
 * are followed once (by real path). When the same name is found more than
 * once, the LATER occurrence wins (later search paths override earlier ones);
 * every shadowed item is recorded so `doctor` can warn about it.
 *
 * Selector entries may also be paths (absolute, ~, or relative to the manifest
 * directory) straight to a fragment file / skill directory / spec file.
 */

export interface ContentItem {
  name: string;
  /** Absolute path: .md file, skill directory, or spec file. */
  path: string;
  /** Which search path it was found under. */
  searchPath: string;
}

export interface Shadowed {
  kind: "instruction" | "skill" | "mcp";
  name: string;
  /** The item that was overridden. */
  loser: ContentItem;
  /** The item that took effect. */
  winner: ContentItem;
}

export interface ContentIndex {
  /** Directory of the (real) manifest file; relative paths resolve here. */
  base: string;
  searchPaths: string[];
  instructions: Map<string, ContentItem>;
  skills: Map<string, ContentItem>;
  mcp: Map<string, ContentItem>;
  shadowed: Shadowed[];
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

let config: { base: string; searchPaths: string[] } | undefined;
let index: ContentIndex | undefined;

export function configureContent(base: string, searchPaths: string[]): void {
  config = { base, searchPaths };
  index = undefined;
}

export function contentConfigured(): boolean {
  return config !== undefined;
}

export function contentIndex(): ContentIndex {
  if (!config) throw new Error("Content not configured (no manifest loaded)");
  if (!index) index = scan(config.base, config.searchPaths);
  return index;
}

function scan(base: string, searchPaths: string[]): ContentIndex {
  const idx: ContentIndex = { base, searchPaths, instructions: new Map(), skills: new Map(), mcp: new Map(), shadowed: [] };
  const visited = new Set<string>();

  const put = (kind: Shadowed["kind"], map: Map<string, ContentItem>, item: ContentItem) => {
    const prev = map.get(item.name);
    if (prev && prev.path !== item.path) idx.shadowed.push({ kind, name: item.name, loser: prev, winner: item });
    map.set(item.name, item);
  };

  const walk = (dir: string, searchPath: string, inInstructions: boolean, inMcp: boolean): void => {
    let real: string;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // A directory with SKILL.md is a skill and a leaf.
    if (entries.some((e) => e.name === "SKILL.md" && e.isFile())) {
      put("skill", idx.skills, { name: path.basename(dir), path: dir, searchPath });
      return;
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(full, searchPath, inInstructions || e.name === "instructions", inMcp || e.name === "mcp");
        continue;
      }
      if (inInstructions && e.name.endsWith(".md")) {
        put("instruction", idx.instructions, { name: e.name.slice(0, -3), path: full, searchPath });
      } else if (inMcp && /\.jsonc?$/.test(e.name)) {
        put("mcp", idx.mcp, { name: e.name.replace(/\.jsonc?$/, ""), path: full, searchPath });
      }
    }
  };

  for (const sp of searchPaths) {
    if (!fs.existsSync(sp)) continue;
    walk(sp, sp, path.basename(sp) === "instructions", path.basename(sp) === "mcp");
  }
  return idx;
}

/** Directories a symlink may point into for us to consider it ours. */
export function ownedRoots(): string[] {
  const out = [buildDir()];
  if (config) out.push(...config.searchPaths);
  return out;
}

export function isOwnedPath(p: string): boolean {
  return ownedRoots().some((r) => isUnder(p, r));
}

/** A selector entry is a path (not a bare name) when it has a separator, a ~, a leading dot, or an extension. */
export function looksLikePath(s: string): boolean {
  return s.includes("/") || s.startsWith("~") || s.startsWith(".") || /\.(md|jsonc?)$/.test(s);
}

// ---------------------------------------------------------------- instructions

export interface ResolvedFragment {
  /** Display / composite-key / Kiro steering name. */
  name: string;
  /** Absolute path of the .md file. */
  file: string;
}

export function availableInstructions(): string[] {
  return [...contentIndex().instructions.keys()].sort();
}

export function resolveFragment(entry: string): ResolvedFragment {
  const idx = contentIndex();
  if (looksLikePath(entry)) {
    const file = absPathFrom(idx.base, entry);
    return { name: path.basename(file).replace(/\.md$/, ""), file };
  }
  const item = idx.instructions.get(entry);
  return { name: entry, file: item ? item.path : path.join(idx.base, "instructions", `${entry}.md`) };
}

/** Validate that requested instruction fragments exist. */
export function resolveInstructionSelection(entries: string[]): ResolvedFragment[] {
  const out = entries.map(resolveFragment);
  const missing = out.filter((f) => !fs.existsSync(f.file));
  if (missing.length > 0) {
    throw new Error(
      `Instruction fragment(s) not found: ${missing.map((m) => m.file).join(", ")}. ` +
        `Discovered (under instructions/ dirs in the search paths): ${availableInstructions().join(", ") || "(none)"}`,
    );
  }
  return out;
}

// ---------------------------------------------------------------- skills

export interface ResolvedSkill {
  name: string;
  /** Absolute path of the skill directory (contains SKILL.md). */
  dir: string;
}

export function availableSkills(): string[] {
  return [...contentIndex().skills.keys()].sort();
}

export function resolveSkill(entry: string): ResolvedSkill {
  const idx = contentIndex();
  if (looksLikePath(entry)) {
    const dir = absPathFrom(idx.base, entry);
    return { name: path.basename(dir), dir };
  }
  const item = idx.skills.get(entry);
  return { name: entry, dir: item ? item.path : path.join(idx.base, "skills", entry) };
}

/** Resolve a skill selector ("*" | names/paths) against what's on disk. */
export function resolveSkillSelection(sel: SkillSelector): ResolvedSkill[] {
  if (sel === "*") return availableSkills().map(resolveSkill);
  const out = sel.map(resolveSkill);
  const missing = out.filter((s) => !fs.existsSync(path.join(s.dir, "SKILL.md")));
  if (missing.length > 0) {
    throw new Error(
      `Skill(s) not found (need <dir>/SKILL.md): ${missing.map((m) => m.dir).join(", ")}. ` +
        `Discovered: ${availableSkills().join(", ") || "(none)"}`,
    );
  }
  return out;
}

// ---------------------------------------------------------------- composition

/**
 * Composition for single-file agents (Claude's CLAUDE.md, Codex's AGENTS.md).
 *
 * - Exactly one fragment: the agent file links straight to the canonical
 *   fragment; nothing is generated.
 * - Several fragments: they are concatenated (manifest order, blank line
 *   between) into <state>/build/instructions.<a>+<b>.md, and the agent file
 *   links to or copies that. The composed file is ONLY written by
 *   install/sync; plan/status/doctor never touch disk and instead report it
 *   as stale when it is missing or differs from a fresh in-memory composition.
 */

/** Path the agent file should point at for this fragment selection. Pure. */
export function composedInstructionPath(fragments: ResolvedFragment[]): string {
  if (fragments.length === 0) {
    throw new Error("composedInstructionPath requires at least one fragment");
  }
  if (fragments.length === 1) return fragments[0].file;
  return path.join(buildDir(), `instructions.${fragments.map((f) => f.name).join("+")}.md`);
}

/** True when this selection needs a generated composite (2+ fragments). */
export function isComposed(fragments: ResolvedFragment[]): boolean {
  return fragments.length > 1;
}

/** The composed body for a fragment selection, computed in memory. */
export function composeInstructions(fragments: ResolvedFragment[]): string {
  const body = fragments.map((f) => fs.readFileSync(f.file, "utf8").trimEnd()).join("\n\n");
  return body + "\n";
}

/** True when `filePath` holds exactly the current composition of `fragments`. */
export function composedMatches(fragments: ResolvedFragment[], filePath: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf8") === composeInstructions(fragments);
  } catch {
    return false;
  }
}

/** Materialize the composite under the build dir (idempotent). Called by install/sync only. */
export function writeComposedInstructions(fragments: ResolvedFragment[]): string {
  const outPath = composedInstructionPath(fragments);
  if (!isComposed(fragments)) return outPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (!composedMatches(fragments, outPath)) fs.writeFileSync(outPath, composeInstructions(fragments), "utf8");
  return outPath;
}
