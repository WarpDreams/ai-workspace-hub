import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Expand a leading ~ or ~/ to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Absolute, tilde-expanded, normalized path. */
export function absPath(p: string): string {
  return path.resolve(expandHome(p));
}

/**
 * Repo root = two levels up from this module (src/util/paths.ts -> repo root).
 * Run directly from TypeScript via tsx, so import.meta.url points at source.
 */
export function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/util -> src -> repo root
  return path.resolve(here, "..", "..");
}

export function contentDir(): string {
  return path.join(repoRoot(), "content");
}

export function instructionsDir(): string {
  return path.join(contentDir(), "instructions");
}

export function skillsDir(): string {
  return path.join(contentDir(), "skills");
}

export function buildDir(): string {
  return path.join(repoRoot(), "build");
}

/** Render an absolute path back to ~-relative for display. */
export function tildify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}
