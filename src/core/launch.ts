import { spawnSync } from "node:child_process";
import os from "node:os";
import type { Manifest, ResolvedTarget } from "../config/schema";
import { resolveTargets, AGENT_IDS } from "../config/schema";
import { getAdapter } from "../adapters/index";
import { absPath } from "../util/paths";

/**
 * `launch`: start an agent CLI with its home directory pointed at a manifest
 * target, so instructions/skills installed there are what the agent sees.
 *
 * Each adapter names the env var its CLI honours (CLAUDE_CONFIG_DIR,
 * CODEX_HOME, KIRO_HOME) and its default executable. A target may override
 * the executable and leading arguments via `commandline`; anything the user
 * types after the target name on `awh launch <name> ...` is appended verbatim.
 */

export class LaunchError extends Error {}

export interface LaunchSpec {
  target: ResolvedTarget;
  /** Executable (argv[0]). */
  command: string;
  /** Arguments from `commandline` followed by the user's pass-through args. */
  args: string[];
  /** Env var name -> absolute home dir. */
  env: Record<string, string>;
}

/** The identifier `launch` accepts for a target: its explicit name. */
export function launchName(t: ResolvedTarget): string | undefined {
  return t.name;
}

/**
 * Find the target to launch. Matches, in order:
 *   1. a target whose `name` equals `id`
 *   2. `id` is an agent id (claude|codex|kiro) and exactly one target uses that agent
 */
export function resolveLaunchTarget(manifest: Manifest, id: string): ResolvedTarget {
  const targets = resolveTargets(manifest);

  const byName = targets.filter((t) => t.name === id);
  if (byName.length === 1) return byName[0];

  if ((AGENT_IDS as readonly string[]).includes(id)) {
    const byAgent = targets.filter((t) => t.agent === id);
    if (byAgent.length === 1) return byAgent[0];
    if (byAgent.length > 1) {
      throw new LaunchError(
        `Several targets use agent "${id}"; give one a "name" and launch by that name.\n` +
          `Launchable targets:\n${describeTargets(targets)}`,
      );
    }
  }

  throw new LaunchError(`No target named "${id}".\nLaunchable targets:\n${describeTargets(targets)}`);
}

function describeTargets(targets: ResolvedTarget[]): string {
  if (targets.length === 0) return "  (none)";
  const perAgent = new Map<string, number>();
  for (const t of targets) perAgent.set(t.agent, (perAgent.get(t.agent) ?? 0) + 1);
  let unnamed = false;
  const rows = targets.map((t) => {
    let id = launchName(t);
    if (id === undefined && perAgent.get(t.agent) === 1) id = t.agent;
    if (id === undefined) {
      id = "(unnamed)";
      unnamed = true;
    }
    return `  ${id.padEnd(16)} ${t.agent.padEnd(7)} ${t.home}`;
  });
  if (unnamed) rows.push('  (unnamed): add "name" to the target in the manifest to make it launchable');
  return rows.join("\n");
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

  let argv: string[];
  if (target.commandline === undefined) {
    argv = [adapter.launch.command];
  } else if (Array.isArray(target.commandline)) {
    argv = [...target.commandline];
  } else {
    argv = splitCommandLine(target.commandline);
  }
  if (argv.length === 0) {
    throw new LaunchError(`Target "${launchName(target) ?? target.agent}" has an empty commandline`);
  }

  return {
    target,
    command: argv[0],
    args: [...argv.slice(1), ...passthrough],
    env: adapter.launch.envFor(homeAbs),
  };
}

/** Run the agent in the foreground, inheriting stdio. Returns its exit code. */
export function runLaunch(spec: LaunchSpec): number {
  const res = spawnSync(spec.command, spec.args, {
    stdio: "inherit",
    env: { ...process.env, ...spec.env },
  });
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new LaunchError(`Command not found: ${spec.command} (is the ${spec.target.agent} CLI installed and on PATH?)`);
    }
    throw res.error;
  }
  if (res.signal) return 128 + (signalNumber(res.signal) ?? 0);
  return res.status ?? 1;
}

function signalNumber(sig: NodeJS.Signals): number | undefined {
  return os.constants.signals[sig];
}
