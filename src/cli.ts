#!/usr/bin/env -S npx tsx
import fs from "node:fs";
import path from "node:path";
import { findManifest, loadManifest, ManifestError, type LoadedManifest } from "./config/load";
import { buildDoctorReport, type DoctorHome, type DoctorItem } from "./core/doctor";
import { buildPlan, type Plan } from "./core/plan";
import { applyInstall, applySync, applyUninstall, type ApplyResult } from "./core/apply";
import { allAdapters } from "./adapters/index";
import { availableSkills, availableInstructions } from "./core/content";
import { absPath, tildify, skillsDir } from "./util/paths";

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
  conflict: "✗",
};

function targetLabel(agent: string, home: string, label?: string): string {
  const h = tildify(home);
  return label ? `${agent} [${label}] (${h})` : `${agent} (${h})`;
}

function loadPlanOrExit(flags: Flags): { plan: Plan; manifestPath: string } {
  const { path: manifestPath, manifest } = loadManifest(flags.manifest);
  const plan = buildPlan(manifest);
  return { plan, manifestPath };
}

function printPlan(plan: Plan): void {
  for (const tp of plan.targets) {
    console.log(`\n${targetLabel(tp.target.agent, tp.homeAbs, tp.target.label)}  [${tp.target.strategy}]`);
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
  console.log(
    `\n${result.installed.length} applied, ${result.removed.length} removed, ${result.skipped.length} skipped.`,
  );
}

function cmdStatus(flags: Flags): number {
  const { plan, manifestPath } = loadPlanOrExit(flags);
  if (flags.json) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  console.log(`Manifest: ${tildify(manifestPath)}`);
  printPlan(plan);
  const conflicts = plan.targets.flatMap((t) => t.ops).filter((o) => o.state === "conflict" || o.state === "foreign-link");
  if (conflicts.length) {
    console.log(`\n${conflicts.length} conflict(s). Resolve manually or re-run install with --force.`);
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
  return result.skipped.length > 0 ? 1 : 0;
}

function cmdSync(flags: Flags): number {
  const { plan } = loadPlanOrExit(flags);
  const result = applySync(plan, { force: flags.force, dryRun: flags.dryRun });
  console.log(flags.dryRun ? "Sync (dry run):" : "Sync:");
  printApplyResult(result, flags.dryRun ? "would" : "linked");
  return result.skipped.length > 0 ? 1 : 0;
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
  else tag = `in manifest${h.target.label ? ` [${h.target.label}]` : ""}${h.target.disabled ? " (disabled)" : ""}`;

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

  console.log("\nAvailable content in this repo:");
  console.log(`  instructions: ${availableInstructions().join(", ") || "(none)"}`);
  console.log(`  skills:       ${availableSkills().join(", ") || "(none)"}`);

  if (loaded) {
    const items = report.homes.flatMap((h) => [...h.instructions, ...h.skills]);
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
      defaults: { strategy: "symlink", instructions: ["base"], skills: "*" },
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
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error("Skill name must be kebab-case (lowercase letters, digits, hyphens).");
    return 2;
  }
  const dir = path.join(skillsDir(), name);
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

function usage(): void {
  console.log(`ai-workspace-hub (awh) — install agent instructions & skills across CLIs

Usage:
  awh <command> [options]

Commands:
  status              Show every target and its current on-disk state
  plan                Dry-run: print operations without touching disk
  install             Create symlinks/copies per the manifest
  sync                Reconcile disk to manifest (install new, prune removed)
  uninstall           Remove links/copies this tool created
  doctor              Scan agent deployments; show managed/unmanaged & sync state
  add-skill <name>    Scaffold a new skill under content/skills/

Options:
  -m, --manifest <p>  Path to manifest (default: ./.awh.jsonc, then ~/.awh.jsonc)
  -f, --force         Replace real files / foreign symlinks on conflict
  -n, --dry-run       Compute actions without writing
      --json          Machine-readable output (status/plan/doctor)
  -h, --help          Show this help
`);
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    usage();
    return 0;
  }
  const command = argv[0];
  const flags = parseFlags(argv.slice(1));

  try {
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
    if (e instanceof ManifestError) {
      console.error(`\n${e.message}\n`);
      return 2;
    }
    console.error(`Error: ${(e as Error).message}`);
    return 1;
  }
}

process.exit(main());
