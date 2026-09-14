import os from "node:os";
import path from "node:path";

/** Expand a leading ~ or ~/ to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Absolute, tilde-expanded, normalized path (relative paths against cwd). */
export function absPath(p: string): string {
  return path.resolve(expandHome(p));
}

/** Absolute path, resolving a relative `p` against `base` instead of cwd. */
export function absPathFrom(base: string, p: string): string {
  const e = expandHome(p);
  return path.isAbsolute(e) ? path.normalize(e) : path.resolve(base, e);
}

/** Per-user state directory: $XDG_STATE_HOME/ai-workspace-hub or ~/.local/state/ai-workspace-hub. */
export function stateDir(): string {
  const base =
    process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim() !== ""
      ? process.env.XDG_STATE_HOME
      : path.join(os.homedir(), ".local", "state");
  return path.join(base, "ai-workspace-hub");
}

/** Where composed (multi-fragment) instruction files are generated. */
export function buildDir(): string {
  return path.join(stateDir(), "build");
}

/** Render an absolute path back to ~-relative for display. */
export function tildify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

/** True when `p` is `root` or lies beneath it. */
export function isUnder(p: string, root: string): boolean {
  const a = path.resolve(p);
  const r = path.resolve(root);
  return a === r || a.startsWith(r + path.sep);
}
