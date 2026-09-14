import fs from "node:fs";
import path from "node:path";
import { findManifest, loadManifest, ManifestError, type LoadedManifest } from "./config/load";
import { buildDoctorReport, type DoctorHome, type DoctorItem } from "./core/doctor";
import { buildLaunch, LaunchError, quoteArg as shellQuote, resolveLaunchTarget, runLaunch } from "./core/launch";
import { buildPlan, type Plan } from "./core/plan";
import { applyInstall, applySync, applyUninstall, type ApplyResult } from "./core/apply";
import { allAdapters } from "./adapters/index";
import { availableSkills, availableInstructions } from "./core/content";
import { availableMcp, describeDisk, describeSpec } from "./core/mcp";
import { absPath, tildify } from "./util/paths";
import { contentConfigured, contentIndex } from "./core/content";

/** Injected by the esbuild `--define` in `npm run build`; absent when run via tsx. */
declare const __AWH_VERSION__: string | undefined;
const VERSION = typeof __AWH_VERSION__ === "string" ? __AWH_VERSION__ : "dev";

interface Flags {
  manifest?: string;
  force: boolean;
  dryRun: boolean;
  json: boolean;
  positional: string[];
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { force: false, dryRun: false, json: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--manifest":
      case "-m":
        flags.manifest = argv[++i];
        break;
      case "--force":
      case "-f":
        flags.force = true;
        break;
      case "--dry-run":
      case "-n":
        flags.dryRun = true;
        break;
      case "--json":
        flags.json = true;
        break;
      default:
        flags.positional.push(a);
    }
  }
  return flags;
}

const STATE_GLYPH: Record<string, string> = {
  missing: "·",
  linked: "✓",
  copied: "✓",
  "wrong-link": "~",
  "foreign-link": "!",
  stale: "↻",
  conflict: "✗",
};

const MCP_GLYPH: Record<string, string> = {
  installed: "✓",
  missing: "·",
  mismatch: "~",
  conflict: "✗",
  unsupported: "!",
};

function targetLabel(agent: string, home: string, name?: string): string {
  const h = tildify(home);
  return name ? `${agent} [${name}] (${h})` : `${agent} (${h})`;
}

function loadPlanOrExit(flags: Flags): { plan: Plan; manifestPath: string } {
  const { path: manifestPath, manifest } = loadManifest(flags.manifest);
  const plan = buildPlan(manifest);
  return { plan, manifestPath };
}

function printPlan(plan: Plan): void {
  for (const tp of plan.targets) {
    console.log(`\n${targetLabel(tp.target.agent, tp.homeAbs, tp.target.name)}  [${tp.target.strategy}]`);
    const instr = tp.ops.filter((o) => o.kind === "instruction");
    const skills = tp.ops.filter((o) => o.kind === "skill");
    if (instr.length) {
      console.log("  instructions:");
      for (const op of instr) console.log(`    ${STATE_GLYPH[op.state]} ${op.name.padEnd(24)} ${op.state.padEnd(13)} -> ${tildify(op.dest)}`);
    }
    if (skills.length) {
      console.log("  skills:");
      for (const op of skills) console.log(`    ${STATE_GLYPH[op.state]} ${op.name.padEnd(24)} ${op.state.padEnd(13)} -> ${tildify(op.dest)}`);
    }
    if (tp.mcp.length) {
      console.log("  mcp:");
      for (const op of tp.mcp) {
        console.log(`    ${MCP_GLYPH[op.state]} ${op.name.padEnd(24)} ${op.state.padEnd(13)} -> ${tildify(op.configFile)}`);
        if (op.state === "mismatch" || op.state === "conflict") {
          console.log(`        have: ${describeDisk(op.existing!)}`);
          console.log(`        want: ${describeSpec(op.spec)}`);
        } else if (op.state === "unsupported") {
          console.log(`        ${op.reason}`);
        }
      }
    }
  }
}

function printApplyResult(result: ApplyResult, verb: string): void {
  for (const op of result.installed) {
    console.log(`  ${verb} ${op.kind.padEnd(11)} ${op.name.padEnd(24)} -> ${tildify(op.dest)}`);
  }
  for (const dest of result.removed) {
    console.log(`  removed  ${tildify(dest)}`);
  }
  for (const s of result.skipped) {
    console.log(`  skipped  ${tildify(s.op.dest)} — ${s.reason}`);
  }
  if (result.mcp.length) {
    console.log("  mcp:");
    for (const r of result.mcp) {
      const where = `${r.agent} (${tildify(r.home)})`;
      const cmd = r.argv ? `  $ ${r.argv.join(" ")}` : "";
      const status = r.ok ? (r.reason ? `  (${r.reason})` : "") : `  FAILED${r.reason ? `: ${r.reason}` : ""}`;
      console.log(`    ${r.action.padEnd(7)} ${r.name.padEnd(20)} ${where}${cmd}${status}`);
    }
  }
  const mcpOk = result.mcp.filter((r) => r.ok && r.action !== "skip").length;
  const mcpFailed = result.mcp.filter((r) => !r.ok).length;
  const mcpNotes = result.mcp.filter((r) => r.ok && r.action === "skip").length;
  const mcpPart = result.mcp.length
    ? `, mcp: ${mcpOk} ok / ${mcpFailed} failed or skipped${mcpNotes ? ` / ${mcpNotes} needs manual login` : ""}`
    : "";
  console.log(
    `\n${result.installed.length} applied, ${result.removed.length} removed, ${result.skipped.length} skipped${mcpPart}.`,
  );
}

function applyExitCode(result: ApplyResult): number {
  return result.skipped.length > 0 || result.mcp.some((r) => !r.ok) ? 1 : 0;
}

function cmdStatus(flags: Flags): number {
  const { plan, manifestPath } = loadPlanOrExit(flags);
  if (flags.json) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  console.log(`Manifest: ${tildify(manifestPath)}`);
  printPlan(plan);
  const conflicts =
    plan.targets.flatMap((t) => t.ops).filter((o) => o.state === "conflict" || o.state === "foreign-link").length +
    plan.targets.flatMap((t) => t.mcp).filter((o) => o.state === "conflict").length;
  if (conflicts) {
    console.log(`\n${conflicts} conflict(s). Resolve manually or re-run install with --force.`);
  }
  return 0;
}

function cmdPlan(flags: Flags): number {
  const { plan, manifestPath } = loadPlanOrExit(flags);
  if (flags.json) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  console.log(`Manifest: ${tildify(manifestPath)}  (dry run — no changes made)`);
  printPlan(plan);
  return 0;
}

function cmdInstall(flags: Flags): number {
  const { plan } = loadPlanOrExit(flags);
  const result = applyInstall(plan, { force: flags.force, dryRun: flags.dryRun });
  console.log(flags.dryRun ? "Install (dry run):" : "Install:");
  printApplyResult(result, flags.dryRun ? "would" : "linked");
  return applyExitCode(result);
}

function cmdSync(flags: Flags): number {
  const { plan } = loadPlanOrExit(flags);
  const result = applySync(plan, { force: flags.force, dryRun: flags.dryRun });
  console.log(flags.dryRun ? "Sync (dry run):" : "Sync:");
  printApplyResult(result, flags.dryRun ? "would" : "linked");
  return applyExitCode(result);
}

function cmdUninstall(flags: Flags): number {
  const { plan } = loadPlanOrExit(flags);
  const result = applyUninstall(plan, { force: flags.force, dryRun: flags.dryRun });
  console.log(flags.dryRun ? "Uninstall (dry run):" : "Uninstall:");
  printApplyResult(result, "removed");
  return 0;
}

const SYNC_GLYPH: Record<string, string> = {
  "in-sync": "✓",
  "out-of-sync": "~",
  "not-installed": "·",
  conflict: "✗",
  orphan: "!",
  unmanaged: "-",
};

const SYNC_TEXT: Record<string, string> = {
  "in-sync": "in sync",
  "out-of-sync": "OUT OF SYNC",
  "not-installed": "not installed",
  conflict: "CONFLICT",
  orphan: "ORPHAN",
  unmanaged: "",
};

function printDoctorItem(item: DoctorItem): void {
  const managed = !item.present ? "missing" : item.managed ? `managed (${item.managed})` : "unmanaged";
  const glyph = item.sync ? SYNC_GLYPH[item.sync] : item.managed ? "✓" : "-";
  const sync = item.sync ? SYNC_TEXT[item.sync] : "";
  let line = `    ${glyph} ${item.name.padEnd(26)} ${managed.padEnd(18)} ${sync}`.trimEnd();
  if (item.detail) line += `\n        ${item.detail}`;
  console.log(line);
}

function printDoctorHome(h: DoctorHome): void {
  let tag = "";
  if (h.target === undefined) tag = "";
  else if (h.target === null) tag = "not in manifest";
  else tag = `in manifest${h.target.name ? ` [${h.target.name}]` : ""}${h.target.disabled ? " (disabled)" : ""}`;

  console.log(`\n${h.agent} (${tildify(h.homeAbs)})  ${tag}`.trimEnd());
  if (!h.exists) {
    console.log("    ! home directory does not exist");
    return;
  }
  console.log("  instructions:");
  if (h.instructions.length === 0) console.log("    (none)");
  for (const it of h.instructions) printDoctorItem(it);
  console.log("  skills:");
  if (h.skills.length === 0) console.log("    (none)");
  for (const it of h.skills) printDoctorItem(it);
  console.log("  mcp servers:");
  if (h.mcp.length === 0) console.log("    (none)");
  for (const it of h.mcp) printDoctorItem(it);
}

function cmdDoctor(flags: Flags): number {
  // Honour -m/--manifest exactly like every other command; otherwise fall back
  // to the usual lookup (cwd, then home). A missing manifest is not an error
  // for doctor — sync checks are simply skipped.
  let loaded: LoadedManifest | undefined;
  const manifestPath = findManifest(flags.manifest);
  if (manifestPath) loaded = loadManifest(manifestPath);

  const report = buildDoctorReport(loaded);

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(loaded ? `Manifest: ${tildify(loaded.path)}` : "Manifest: (none found — sync checks skipped)");
  console.log("\nAgent deployments on this machine:");
  if (report.homes.length === 0) console.log("  (none found)");
  for (const h of report.homes) printDoctorHome(h);

  if (contentConfigured()) {
    const idx = contentIndex();
    console.log(`\nContent search paths: ${idx.searchPaths.map(tildify).join(", ")}`);
    console.log(`  instructions: ${availableInstructions().join(", ") || "(none)"}`);
    console.log(`  skills:       ${availableSkills().join(", ") || "(none)"}`);
    console.log(`  mcp:          ${availableMcp().join(", ") || "(none)"}`);
    if (idx.shadowed.length) {
      console.log("  ! name collisions (the later occurrence wins):");
      for (const s of idx.shadowed) {
        console.log(`    ${s.kind.padEnd(11)} ${s.name.padEnd(24)} using ${tildify(s.winner.path)}`);
        console.log(`    ${"".padEnd(11)} ${"".padEnd(24)} shadows ${tildify(s.loser.path)}`);
      }
    }
  }

  if (loaded) {
    const items = report.homes.flatMap((h) => [...h.instructions, ...h.skills, ...h.mcp]);
    const count = (s: string) => items.filter((i) => i.sync === s).length;
    const missingHomes = report.homes.filter((h) => h.target && !h.target.disabled && !h.exists).length;
    const problems = count("out-of-sync") + count("conflict") + count("orphan") + missingHomes;
    const parts = [
      `${count("in-sync")} in sync`,
      `${count("not-installed")} not installed`,
      `${count("out-of-sync")} out of sync`,
      `${count("conflict")} conflict(s)`,
      `${count("orphan")} orphan(s)`,
    ];
    if (missingHomes) parts.push(`${missingHomes} missing home dir(s)`);
    console.log(`\nSummary: ${parts.join(", ")}.`);
    if (count("not-installed") > 0) console.log("  run `install` to add missing items");
    if (problems > 0) console.log("  run `status` / `sync` to reconcile, or fix the manifest");
  } else {
    const suggested = {
      defaults: { strategy: "symlink", instructions: ["applus_base"], skills: "*", mcp: [] as string[] },
      targets: report.homes.filter((h) => h.exists).map((h) => ({ agent: h.agent, home: tildify(h.homeAbs) })),
    };
    console.log("\nSuggested .awh.jsonc (save as ./.awh.jsonc or ~/.awh.jsonc):");
    console.log(JSON.stringify(suggested, null, 2));
  }
  return 0;
}

function cmdAddSkill(flags: Flags): number {
  const name = flags.positional[0];
  if (!name) {
    console.error("Usage: awh add-skill <name>");
    return 2;
  }
  loadManifest(flags.manifest); // establishes the content roots
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error("Skill name must be kebab-case (lowercase letters, digits, hyphens).");
    return 2;
  }
  const dir = path.join(contentIndex().base, "skills", name);
  if (fs.existsSync(dir)) {
    console.error(`Skill already exists: ${tildify(dir)}`);
    return 1;
  }
  fs.mkdirSync(dir, { recursive: true });
  const skillMd = `---
name: ${name}
description: Use when ... (describe the trigger conditions for this skill).
---

# ${name}

Describe what this skill does and when to use it.

## Steps

1. ...
`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd, "utf8");
  console.log(`Created skill scaffold at ${tildify(path.join(dir, "SKILL.md"))}`);
  return 0;
}

/**
 * `awh launch [-m <manifest>] [-n] <target> [args...]`
 * Flags are only recognised BEFORE the target name; everything after it is
 * passed to the agent verbatim (a literal `--` right after the name is dropped).
 */
function cmdLaunch(argv: string[]): number {
  let manifest: string | undefined;
  let dryRun = false;
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-m" || a === "--manifest") manifest = argv[++i];
    else if (a === "-n" || a === "--dry-run") dryRun = true;
    else if (a === "-h" || a === "--help") {
      launchUsage();
      return 0;
    } else if (a.startsWith("-")) {
      console.error(`Unknown launch option: ${a}\n`);
      launchUsage();
      return 2;
    } else break;
  }
  const id = argv[i];
  if (!id) {
    launchUsage();
    return 2;
  }
  let passthrough = argv.slice(i + 1);
  if (passthrough[0] === "--") passthrough = passthrough.slice(1);

  const { manifest: m } = loadManifest(manifest);
  const target = resolveLaunchTarget(m, id);
  const spec = buildLaunch(target, passthrough);

  if (dryRun) {
    const envStr = Object.entries(spec.env)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    const prefix = envStr ? envStr + " " : "";
    for (const argv of spec.pre) console.log(`${prefix}${argv.map(shellQuote).join(" ")}`);
    console.log(`${prefix}${[spec.command, ...spec.args].map(shellQuote).join(" ")}`);
    return 0;
  }
  return runLaunch(spec);
}

function launchUsage(): void {
  console.log(`Usage: awh launch [-m <manifest>] [-n] <target> [agent args...]

Starts the target's agent CLI with its home directory env var set
(CLAUDE_CONFIG_DIR / CODEX_HOME / KIRO_HOME). <target> is a target's "name";
a target without one is named after its agent (claude / codex / kiro).
If "commandline" is an array, every entry but the last runs first as a
pre-step (e.g. "aws sso login") and must succeed. Everything after <target>
is passed to the agent unchanged.

  -m, --manifest <p>  Manifest to read (default: ./.awh.jsonc, then ~/.awh.jsonc)
  -n, --dry-run       Print the env and command instead of running it
`);
}

function usage(): void {
  console.log(`ai-workspace-hub (awh) ${VERSION} — install agent instructions, skills & MCP servers across CLIs

Usage:
  awh <command> [options]

Commands:
  status              Show every target and its current on-disk state
  plan                Dry-run: print operations without touching disk
  install             Create symlinks/copies per the manifest; add MCP servers via agent CLIs
  sync                Reconcile disk to manifest (install new, prune removed)
  uninstall           Remove links/copies and MCP servers this tool created
  doctor              Scan agent deployments; show managed/unmanaged & sync state
  add-skill <name>    Scaffold a new skill under skills/ beside the manifest
  launch <target> [args...]
                      Run the target's agent CLI with its home env var set;
                      args after <target> are passed through verbatim

Options:
  -m, --manifest <p>  Path to manifest (default: $AWH_MANIFEST, ./.awh.jsonc, ~/.awh.jsonc)
  -f, --force         Replace real files / foreign symlinks / foreign MCP entries on conflict
  -n, --dry-run       Compute actions without writing
      --json          Machine-readable output (status/plan/doctor)
  -h, --help          Show this help
  -v, --version       Show version
`);
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    usage();
    return 0;
  }
  if (argv[0] === "-v" || argv[0] === "--version") {
    console.log(`awh ${VERSION}`);
    return 0;
  }
  const command = argv[0];

  try {
    // `launch` owns its argv: agent flags after the target must not be parsed as ours.
    if (command === "launch") return cmdLaunch(argv.slice(1));

    const flags = parseFlags(argv.slice(1));
    switch (command) {
      case "status":
        return cmdStatus(flags);
      case "plan":
        return cmdPlan(flags);
      case "install":
        return cmdInstall(flags);
      case "sync":
        return cmdSync(flags);
      case "uninstall":
        return cmdUninstall(flags);
      case "doctor":
        return cmdDoctor(flags);
      case "add-skill":
        return cmdAddSkill(flags);
      default:
        console.error(`Unknown command: ${command}\n`);
        usage();
        return 2;
    }
  } catch (e) {
    if (e instanceof ManifestError || e instanceof LaunchError) {
      console.error(`\n${e.message}\n`);
      return 2;
    }
    console.error(`Error: ${(e as Error).message}`);
    return 1;
  }
}

process.exit(main());
