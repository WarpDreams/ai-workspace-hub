import { spawnSync } from "node:child_process";
import os from "node:os";
import type { Manifest, ResolvedTarget } from "../config/schema";
import { resolveTargets } from "../config/schema";
import { getAdapter } from "../adapters/index";
import { absPath } from "../util/paths";

/**
 * `launch`: start an agent CLI with its home directory pointed at a manifest
 * target, so instructions/skills installed there are what the agent sees.
 *
 * Each adapter names the env var its CLI honours (CLAUDE_CONFIG_DIR,
 * CODEX_HOME, KIRO_HOME) and its default executable. A target may override
 * the executable and leading arguments via `commandline`, and may prefix
 * pre-steps (an array: all but the last entry run first and must succeed).
 * Anything the user types after the target name on `awh launch <name> ...`
 * is appended verbatim to the final (agent) command.
 */

export class LaunchError extends Error {}

export interface LaunchSpec {
  target: ResolvedTarget;
  /** Pre-steps (argv each) to run in order before the agent; each must exit 0. */
  pre: string[][];
  /** Agent executable (argv[0]). */
  command: string;
  /** Arguments from `commandline` followed by the user's pass-through args. */
  args: string[];
  /** Env var name -> absolute home dir (applied to pre-steps and the agent). */
  env: Record<string, string>;
}

/** The identifier `launch` accepts for a target: its `name`, else its agent id. */
export function launchName(t: ResolvedTarget): string {
  return t.name ?? t.agent;
}

/** Find the target whose launch name equals `id` (uniqueness is enforced by the schema). */
export function resolveLaunchTarget(manifest: Manifest, id: string): ResolvedTarget {
  const targets = resolveTargets(manifest);
  const hit = targets.find((t) => launchName(t) === id);
  if (hit) return hit;
  throw new LaunchError(`No target named "${id}".\nLaunchable targets:\n${describeTargets(targets)}`);
}

function describeTargets(targets: ResolvedTarget[]): string {
  if (targets.length === 0) return "  (none)";
  return targets.map((t) => `  ${launchName(t).padEnd(16)} ${t.agent.padEnd(7)} ${t.home}`).join("\n");
}

/**
 * Split a command line into argv the way a POSIX shell would for the simple
 * cases: whitespace separates words; single quotes are literal; double quotes
 * allow backslash escapes; a backslash outside quotes escapes the next char.
 * No globbing, variables or redirections.
 */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) {
        out.push(cur);
        cur = "";
        inWord = false;
      }
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (quote) throw new LaunchError(`Unterminated ${quote} quote in commandline: ${line}`);
  if (inWord) out.push(cur);
  return out;
}

export function buildLaunch(target: ResolvedTarget, passthrough: string[]): LaunchSpec {
  const adapter = getAdapter(target.agent);
  const homeAbs = absPath(target.home);

  const lines: string[] =
    target.commandline === undefined
      ? [adapter.launch.command]
      : Array.isArray(target.commandline)
        ? target.commandline
        : [target.commandline];
  const argvs = lines.map((line, i) => {
    const argv = splitCommandLine(line);
    if (argv.length === 0) throw new LaunchError(`Target "${launchName(target)}": commandline[${i}] is empty`);
    return argv;
  });
  const last = argvs[argvs.length - 1];

  return {
    target,
    pre: argvs.slice(0, -1),
    command: last[0],
    args: [...last.slice(1), ...passthrough],
    env: adapter.launch.envFor(homeAbs),
  };
}

function runOne(argv: string[], env: Record<string, string>, what: string): number {
  const res = spawnSync(argv[0], argv.slice(1), { stdio: "inherit", env: { ...process.env, ...env } });
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new LaunchError(`Command not found: ${argv[0]} (${what})`);
    throw res.error;
  }
  if (res.signal) return 128 + (signalNumber(res.signal) ?? 0);
  return res.status ?? 1;
}

/**
 * Run the pre-steps then the agent, all in the foreground with inherited
 * stdio. A pre-step that exits non-zero aborts the launch with its exit code.
 */
export function runLaunch(spec: LaunchSpec): number {
  const name = launchName(spec.target);
  for (const argv of spec.pre) {
    const code = runOne(argv, spec.env, `pre-step of target "${name}"`);
    if (code !== 0) {
      console.error(`awh launch: pre-step \`${argv.map(quoteArg).join(" ")}\` exited with code ${code}; not launching ${spec.command}`);
      return code;
    }
  }
  return runOne([spec.command, ...spec.args], spec.env, `is the ${spec.target.agent} CLI installed and on PATH?`);
}

/** Quote an argv word for display the way a POSIX shell would need it. */
export function quoteArg(a: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`;
}

function signalNumber(sig: NodeJS.Signals): number | undefined {
  return os.constants.signals[sig];
}
