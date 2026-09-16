import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every test runs against a throwaway HOME and XDG_STATE_HOME so nothing ever
 * touches the developer's real agent homes or ledger. `node --test` gives each
 * test FILE its own process, so mutating process.env here is contained.
 */

const SAVED_ENV_KEYS = ["HOME", "XDG_STATE_HOME", "AWH_MANIFEST"] as const;

export interface Sandbox {
  /** Temp root (realpath'd — on macOS /var is a symlink to /private/var). */
  root: string;
  /** Fake $HOME; agent homes are created beneath it. */
  home: string;
  /** Content repo: instructions/, skills/, mcp/ and .awh.jsonc live here. */
  content: string;
  /** Path of the manifest written by `writeManifest`. */
  manifest: string;
  dispose(): void;
}

export function makeSandbox(): Sandbox {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "awh-test-")));
  const home = path.join(root, "home");
  const content = path.join(root, "content");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(content, { recursive: true });

  const saved = new Map<string, string | undefined>();
  for (const k of SAVED_ENV_KEYS) saved.set(k, process.env[k]);
  process.env.HOME = home;
  process.env.XDG_STATE_HOME = path.join(root, "state");
  delete process.env.AWH_MANIFEST;

  return {
    root,
    home,
    content,
    manifest: path.join(content, ".awh.jsonc"),
    dispose() {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function write(file: string, body: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
  return file;
}

/** An instruction fragment at <content>/instructions/<name>.md. */
export function writeInstruction(sb: Sandbox, name: string, body = `# ${name}\n`): string {
  return write(path.join(sb.content, "instructions", `${name}.md`), body);
}

/** A skill directory at <content>/skills/<name>/SKILL.md. */
export function writeSkill(sb: Sandbox, name: string, body = `# ${name}\n`): string {
  const dir = path.join(sb.content, "skills", name);
  write(path.join(dir, "SKILL.md"), body);
  return dir;
}

/** An MCP spec at <content>/mcp/<name>.jsonc. */
export function writeMcpSpec(sb: Sandbox, name: string, spec: unknown): string {
  return write(path.join(sb.content, "mcp", `${name}.jsonc`), JSON.stringify(spec, null, 2));
}

/** Write the manifest and return its path. */
export function writeManifest(sb: Sandbox, manifest: unknown): string {
  return write(sb.manifest, JSON.stringify(manifest, null, 2));
}

/** An agent home inside the sandbox (not created — the tool should create it). */
export function homeFor(sb: Sandbox, agent: string): string {
  return path.join(sb.home, `.${agent}`);
}

export function isSymlinkTo(p: string, target: string): boolean {
  try {
    const st = fs.lstatSync(p);
    if (!st.isSymbolicLink()) return false;
    return path.resolve(path.dirname(p), fs.readlinkSync(p)) === path.resolve(target);
  } catch {
    return false;
  }
}

export function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}
