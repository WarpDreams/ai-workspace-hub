import fs from "node:fs";
import path from "node:path";
import { instructionsDir, skillsDir, buildDir } from "../util/paths";
import type { SkillSelector } from "../config/schema";

/** List available instruction fragment names (files under content/instructions, sans .md). */
export function availableInstructions(): string[] {
  const dir = instructionsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** Absolute path to an instruction fragment source file. */
export function instructionFragmentPath(name: string): string {
  return path.join(instructionsDir(), `${name}.md`);
}

/** List available skill names (directories under content/skills containing SKILL.md). */
export function availableSkills(): string[] {
  const dir = skillsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

/** Absolute path to a skill source directory. */
export function skillPath(name: string): string {
  return path.join(skillsDir(), name);
}

/** Resolve a skill selector against what's available on disk. */
export function resolveSkillSelection(sel: SkillSelector): string[] {
  const all = availableSkills();
  if (sel === "*") return all;
  const missing = sel.filter((s) => !all.includes(s));
  if (missing.length > 0) {
    throw new Error(`Unknown skill(s): ${missing.join(", ")}. Available: ${all.join(", ") || "(none)"}`);
  }
  return sel;
}

/** Validate that requested instruction fragments exist. */
export function resolveInstructionSelection(names: string[]): string[] {
  const all = availableInstructions();
  const missing = names.filter((n) => !all.includes(n));
  if (missing.length > 0) {
    throw new Error(
      `Unknown instruction fragment(s): ${missing.join(", ")}. Available: ${all.join(", ") || "(none)"}`,
    );
  }
  return names;
}

/**
 * Composition for single-file agents (Claude's CLAUDE.md, Codex's AGENTS.md).
 *
 * - Exactly one fragment: the agent file links straight to the canonical
 *   fragment; nothing is generated.
 * - Several fragments: they are concatenated (manifest order, blank line
 *   between) into build/instructions.<a>+<b>.md, and the agent file links to
 *   or copies that. The composed file is ONLY written by install/sync;
 *   plan/status/doctor never touch disk and instead report it as stale when
 *   it is missing or differs from a fresh in-memory composition.
 */

/** Path the agent file should point at for this fragment selection. Pure. */
export function composedInstructionPath(fragments: string[]): string {
  if (fragments.length === 0) {
    throw new Error("composedInstructionPath requires at least one fragment");
  }
  if (fragments.length === 1) {
    return instructionFragmentPath(fragments[0]);
  }
  return path.join(buildDir(), `instructions.${fragments.join("+")}.md`);
}

/** True when this selection needs a generated composite (2+ fragments). */
export function isComposed(fragments: string[]): boolean {
  return fragments.length > 1;
}

/** The composed body for a fragment selection, computed in memory. */
export function composeInstructions(fragments: string[]): string {
  const body = fragments
    .map((name) => fs.readFileSync(instructionFragmentPath(name), "utf8").trimEnd())
    .join("\n\n");
  return body + "\n";
}

/** True when `filePath` holds exactly the current composition of `fragments`. */
export function composedMatches(fragments: string[], filePath: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf8") === composeInstructions(fragments);
  } catch {
    return false;
  }
}

/**
 * Materialize the composite under build/ (idempotent). Returns its path.
 * Called by install/sync only.
 */
export function writeComposedInstructions(fragments: string[]): string {
  const outPath = composedInstructionPath(fragments);
  if (!isComposed(fragments)) return outPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const body = composeInstructions(fragments);
  if (!composedMatches(fragments, outPath)) fs.writeFileSync(outPath, body, "utf8");
  return outPath;
}
