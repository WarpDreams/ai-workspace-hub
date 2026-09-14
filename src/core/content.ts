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
 * For single-file agents that compose multiple fragments, we cannot symlink a
 * single source. Materialize a composed file under build/ and return its path,
 * preserving the "one source of truth" property (regenerated from fragments).
 *
 * When exactly one fragment is selected, we return the fragment source itself
 * so a symlink points straight at the canonical file.
 */
export function composedInstructionSource(fragments: string[]): string {
  if (fragments.length === 1) {
    return instructionFragmentPath(fragments[0]);
  }
  const outDir = buildDir();
  fs.mkdirSync(outDir, { recursive: true });
  const key = fragments.join("+");
  const outPath = path.join(outDir, `instructions.${key}.md`);
  const body = fragments
    .map((name) => fs.readFileSync(instructionFragmentPath(name), "utf8").trimEnd())
    .join("\n\n");
  fs.writeFileSync(outPath, body + "\n", "utf8");
  return outPath;
}
