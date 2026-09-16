import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadManifest } from "../src/config/load";
import { buildPlan } from "../src/core/plan";
import { applyInstall, applySync, applyUninstall } from "../src/core/apply";
import { loadLedger } from "../src/core/state";
import { exists, homeFor, isSymlinkTo, makeSandbox, write, writeInstruction, writeManifest, writeSkill, type Sandbox } from "./helpers";

/**
 * These cover the paths that can destroy a user's files: install over an
 * existing path, uninstall, and sync's prune. The rule under test throughout
 * is "only ever remove what the ledger says we created".
 */

let sb: Sandbox;
let claudeHome: string;

beforeEach(() => {
  sb = makeSandbox();
  claudeHome = homeFor(sb, "claude");
});
afterEach(() => sb.dispose());

/** Write a manifest (Claude only, no MCP) and return a fresh plan for it. */
function planFor(opts: { instructions?: string[]; skills?: unknown; strategy?: string } = {}) {
  writeManifest(sb, {
    canon_search_paths: [sb.content],
    defaults: {
      instructions: opts.instructions ?? ["base"],
      skills: opts.skills ?? "*",
      ...(opts.strategy ? { strategy: opts.strategy } : {}),
    },
    targets: [{ agent: "claude", home: claudeHome }],
  });
  const loaded = loadManifest(sb.manifest);
  return buildPlan(loaded.manifest, loaded.path);
}

const claudeMd = () => path.join(claudeHome, "CLAUDE.md");
const skillLink = (name: string) => path.join(claudeHome, "skills", name);

describe("install", () => {
  test("creates the home, symlinks content and records the ledger", () => {
    writeInstruction(sb, "base");
    const gmail = writeSkill(sb, "gmail");

    const res = applyInstall(planFor());
    assert.equal(res.installed.length, 2);
    assert.deepEqual(res.skipped, []);

    assert.ok(isSymlinkTo(claudeMd(), path.join(sb.content, "instructions", "base.md")));
    assert.ok(isSymlinkTo(skillLink("gmail"), gmail));

    const dests = loadLedger().entries.map((e) => e.dest).sort();
    assert.deepEqual(dests, [claudeMd(), skillLink("gmail")].sort());
    assert.equal(loadLedger().entries[0].strategy, "symlink");
  });

  test("is idempotent — a second install changes nothing and does not duplicate the ledger", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "gmail");
    applyInstall(planFor());
    const before = fs.readlinkSync(claudeMd());

    const res = applyInstall(planFor());
    assert.deepEqual(res.skipped, []);
    assert.equal(fs.readlinkSync(claudeMd()), before);
    assert.equal(loadLedger().entries.length, 2, "entries are upserted by dest, not appended");
  });

  test("dry run touches nothing at all", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "gmail");

    const res = applyInstall(planFor(), { dryRun: true });
    assert.equal(res.installed.length, 2, "still reports what it would do");
    assert.equal(exists(claudeMd()), false);
    assert.equal(exists(skillLink("gmail")), false);
    assert.deepEqual(loadLedger().entries, [], "no ledger written");
  });

  test("refuses to clobber a hand-written file, and says why", () => {
    writeInstruction(sb, "base");
    write(claudeMd(), "hand-written, precious\n");

    const res = applyInstall(planFor({ skills: [] }));
    assert.deepEqual(res.installed, []);
    assert.equal(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /--force/);
    assert.equal(fs.readFileSync(claudeMd(), "utf8"), "hand-written, precious\n", "file untouched");
    assert.deepEqual(loadLedger().entries, [], "nothing claimed in the ledger");
  });

  test("--force replaces a hand-written file", () => {
    writeInstruction(sb, "base");
    write(claudeMd(), "hand-written\n");

    const res = applyInstall(planFor({ skills: [] }), { force: true });
    assert.equal(res.installed.length, 1);
    assert.ok(isSymlinkTo(claudeMd(), path.join(sb.content, "instructions", "base.md")));
  });

  test("refuses to replace a symlink pointing outside our content without --force", () => {
    writeInstruction(sb, "base");
    const outside = write(path.join(sb.root, "elsewhere", "other.md"), "x");
    fs.mkdirSync(claudeHome, { recursive: true });
    fs.symlinkSync(outside, claudeMd());

    const res = applyInstall(planFor({ skills: [] }));
    assert.equal(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /outside this repo/);
    assert.ok(isSymlinkTo(claudeMd(), outside), "foreign link left alone");

    applyInstall(planFor({ skills: [] }), { force: true });
    assert.ok(isSymlinkTo(claudeMd(), path.join(sb.content, "instructions", "base.md")));
  });

  test("copy strategy materialises real files, not links", () => {
    writeInstruction(sb, "base", "# base\n");
    writeSkill(sb, "gmail", "# gmail skill\n");

    applyInstall(planFor({ strategy: "copy" }));
    assert.equal(fs.lstatSync(claudeMd()).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(claudeMd(), "utf8"), "# base\n");
    assert.equal(fs.readFileSync(path.join(skillLink("gmail"), "SKILL.md"), "utf8"), "# gmail skill\n");
    assert.equal(loadLedger().entries.find((e) => e.dest === claudeMd())!.strategy, "copy");
  });
});

describe("uninstall", () => {
  test("removes what we created and forgets it", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "gmail");
    applyInstall(planFor());

    const res = applyUninstall(planFor());
    assert.equal(res.removed.length, 2);
    assert.equal(exists(claudeMd()), false);
    assert.equal(exists(skillLink("gmail")), false);
    assert.deepEqual(loadLedger().entries, []);
  });

  test("leaves the user's own files alone", () => {
    writeInstruction(sb, "base");
    write(claudeMd(), "hand-written, precious\n");

    const res = applyUninstall(planFor({ skills: [] }));
    assert.deepEqual(res.removed, []);
    assert.equal(res.skipped.length, 1);
    assert.match(res.skipped[0].reason, /not owned by this tool/);
    assert.equal(fs.readFileSync(claudeMd(), "utf8"), "hand-written, precious\n");
  });

  test("leaves a copy it did not make alone, even at a path it manages", () => {
    // Copy strategy: the destination is a plain file, so ownership can only
    // come from the ledger. Without an entry, it must survive uninstall.
    writeInstruction(sb, "base");
    write(claudeMd(), "someone else's copy\n");

    const res = applyUninstall(planFor({ skills: [], strategy: "copy" }));
    assert.deepEqual(res.removed, []);
    assert.equal(fs.readFileSync(claudeMd(), "utf8"), "someone else's copy\n");
  });

  test("does remove a copy it made", () => {
    writeInstruction(sb, "base");
    applyInstall(planFor({ skills: [], strategy: "copy" }));
    assert.ok(exists(claudeMd()));

    applyUninstall(planFor({ skills: [], strategy: "copy" }));
    assert.equal(exists(claudeMd()), false);
    assert.deepEqual(loadLedger().entries, []);
  });

  test("dry run reports removals without performing them", () => {
    writeInstruction(sb, "base");
    applyInstall(planFor({ skills: [] }));

    const res = applyUninstall(planFor({ skills: [] }), { dryRun: true });
    assert.deepEqual(res.removed, [claudeMd()]);
    assert.ok(exists(claudeMd()), "still there");
    assert.equal(loadLedger().entries.length, 1, "still tracked");
  });
});

describe("sync", () => {
  test("prunes the link for a skill dropped from the manifest", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "keep");
    writeSkill(sb, "drop");
    applyInstall(planFor({ skills: ["keep", "drop"] }));
    assert.ok(exists(skillLink("drop")));

    const res = applySync(planFor({ skills: ["keep"] }));
    assert.deepEqual(res.removed, [skillLink("drop")]);
    assert.ok(exists(skillLink("keep")), "kept skill untouched");
    assert.equal(exists(skillLink("drop")), false);
    assert.deepEqual(
      loadLedger().entries.map((e) => e.dest).sort(),
      [claudeMd(), skillLink("keep")].sort(),
    );
  });

  test("installs a newly added skill and prunes in the same pass", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "old");
    applyInstall(planFor({ skills: ["old"] }));
    writeSkill(sb, "new");

    const res = applySync(planFor({ skills: ["new"] }));
    assert.ok(exists(skillLink("new")));
    assert.equal(exists(skillLink("old")), false);
    assert.deepEqual(res.removed, [skillLink("old")]);
  });

  test("never prunes something it does not own", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "keep");
    applyInstall(planFor({ skills: ["keep"] }));
    // A skill installed by hand, unknown to the ledger.
    write(path.join(skillLink("byhand"), "SKILL.md"), "not ours\n");

    applySync(planFor({ skills: ["keep"] }));
    assert.ok(exists(path.join(skillLink("byhand"), "SKILL.md")), "hand-installed skill survives prune");
  });

  test("dry run prunes nothing", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "drop");
    applyInstall(planFor({ skills: ["drop"] }));

    const res = applySync(planFor({ skills: [] }), { dryRun: true });
    assert.deepEqual(res.removed, [skillLink("drop")]);
    assert.ok(exists(skillLink("drop")));
    assert.equal(loadLedger().entries.length, 2);
  });
});
