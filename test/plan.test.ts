import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadManifest } from "../src/config/load";
import { buildPlan, type PlanOp } from "../src/core/plan";
import { applyInstall } from "../src/core/apply";
import { buildDir } from "../src/util/paths";
import { homeFor, makeSandbox, write, writeInstruction, writeManifest, writeSkill, type Sandbox } from "./helpers";

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.dispose());

/** Manifest with one Claude target, plus whatever overrides the test needs. */
function claudeManifest(over: Record<string, unknown> = {}, defaults: Record<string, unknown> = {}) {
  writeManifest(sb, {
    canon_search_paths: [sb.content],
    defaults: { instructions: ["base"], skills: "*", ...defaults },
    targets: [{ agent: "claude", home: homeFor(sb, "claude"), ...over }],
  });
  return loadManifest(sb.manifest);
}

function plan() {
  const loaded = loadManifest(sb.manifest);
  return buildPlan(loaded.manifest, loaded.path);
}

function op(ops: PlanOp[], kind: PlanOp["kind"], name: string): PlanOp {
  const found = ops.find((o) => o.kind === kind && o.name === name);
  assert.ok(found, `no ${kind} op named ${name} in [${ops.map((o) => `${o.kind}:${o.name}`).join(", ")}]`);
  return found;
}

describe("destination mapping", () => {
  test("Claude: one composed CLAUDE.md plus skills/<name>", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "gmail");
    const p = buildPlan(claudeManifest().manifest, sb.manifest);
    const home = homeFor(sb, "claude");

    assert.equal(p.targets.length, 1);
    assert.equal(op(p.targets[0].ops, "instruction", "base").dest, path.join(home, "CLAUDE.md"));
    assert.equal(op(p.targets[0].ops, "skill", "gmail").dest, path.join(home, "skills", "gmail"));
  });

  test("Kiro: one steering file per fragment", () => {
    writeInstruction(sb, "base");
    writeInstruction(sb, "extra");
    writeManifest(sb, {
      canon_search_paths: [sb.content],
      defaults: { instructions: ["base", "extra"], skills: [] },
      targets: [{ agent: "kiro", home: homeFor(sb, "kiro") }],
    });
    const p = plan();
    const home = homeFor(sb, "kiro");
    const ops = p.targets[0].ops;

    assert.equal(ops.length, 2, "per-fragment mapping does not compose");
    assert.equal(op(ops, "instruction", "base").dest, path.join(home, "steering", "base.md"));
    assert.equal(op(ops, "instruction", "extra").dest, path.join(home, "steering", "extra.md"));
    assert.equal(op(ops, "instruction", "base").source, path.join(sb.content, "instructions", "base.md"));
  });

  test("Codex: AGENTS.md", () => {
    writeInstruction(sb, "base");
    writeManifest(sb, {
      canon_search_paths: [sb.content],
      defaults: { instructions: ["base"], skills: [] },
      targets: [{ agent: "codex", home: homeFor(sb, "codex") }],
    });
    assert.equal(op(plan().targets[0].ops, "instruction", "base").dest, path.join(homeFor(sb, "codex"), "AGENTS.md"));
  });

  test("disabled targets are skipped, empty instructions produce no op", () => {
    writeInstruction(sb, "base");
    writeManifest(sb, {
      canon_search_paths: [sb.content],
      defaults: { instructions: [], skills: [] },
      targets: [
        { agent: "claude", home: homeFor(sb, "claude") },
        { agent: "codex", home: homeFor(sb, "codex"), disabled: true },
      ],
    });
    const p = plan();
    assert.equal(p.targets.length, 1, "disabled target dropped");
    assert.deepEqual(p.targets[0].ops, [], "instructions: [] manages nothing");
  });
});

describe("on-disk state detection", () => {
  test("missing before install, linked after", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "gmail");
    claudeManifest();

    let p = plan();
    assert.equal(op(p.targets[0].ops, "instruction", "base").state, "missing");
    assert.equal(op(p.targets[0].ops, "skill", "gmail").state, "missing");

    applyInstall(p);
    p = plan();
    assert.equal(op(p.targets[0].ops, "instruction", "base").state, "linked");
    assert.equal(op(p.targets[0].ops, "skill", "gmail").state, "linked");
  });

  test("a real file we did not create is a conflict, never silently replaced", () => {
    writeInstruction(sb, "base");
    claudeManifest({}, { skills: [] });
    write(path.join(homeFor(sb, "claude"), "CLAUDE.md"), "hand-written, precious\n");

    assert.equal(op(plan().targets[0].ops, "instruction", "base").state, "conflict");
  });

  test("a symlink pointing outside our content is foreign, not ours to touch", () => {
    writeInstruction(sb, "base");
    claudeManifest({}, { skills: [] });
    const outside = write(path.join(sb.root, "elsewhere", "other.md"), "x");
    const dest = path.join(homeFor(sb, "claude"), "CLAUDE.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(outside, dest);

    assert.equal(op(plan().targets[0].ops, "instruction", "base").state, "foreign-link");
  });

  test("a symlink into our content but at the wrong item is wrong-link", () => {
    writeInstruction(sb, "base");
    writeInstruction(sb, "other");
    claudeManifest({}, { skills: [] });
    const dest = path.join(homeFor(sb, "claude"), "CLAUDE.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(path.join(sb.content, "instructions", "other.md"), dest);

    assert.equal(op(plan().targets[0].ops, "instruction", "base").state, "wrong-link");
  });

  test("copy strategy reports an existing path as copied, not conflict", () => {
    writeInstruction(sb, "base");
    claudeManifest({ strategy: "copy" }, { skills: [] });
    write(path.join(homeFor(sb, "claude"), "CLAUDE.md"), "old copy\n");

    assert.equal(op(plan().targets[0].ops, "instruction", "base").state, "copied");
  });
});

describe("composed instruction staleness", () => {
  test("read-only planning never writes the composite, and reports it stale", () => {
    writeInstruction(sb, "a", "# A\n");
    writeInstruction(sb, "b", "# B\n");
    claudeManifest({}, { instructions: ["a", "b"], skills: [] });

    const first = plan();
    const o = op(first.targets[0].ops, "instruction", "a+b");
    assert.equal(o.source, path.join(buildDir(), "instructions.a+b.md"));
    assert.equal(o.state, "missing");
    assert.equal(fs.existsSync(buildDir()), false, "plan must not touch disk");

    applyInstall(first);
    assert.equal(op(plan().targets[0].ops, "instruction", "a+b").state, "linked");

    // Edit a fragment: the symlink is still correct but the composite is not.
    writeInstruction(sb, "b", "# B changed\n");
    assert.equal(op(plan().targets[0].ops, "instruction", "a+b").state, "stale");

    // install/sync regenerates it.
    applyInstall(plan());
    assert.equal(op(plan().targets[0].ops, "instruction", "a+b").state, "linked");
    assert.match(fs.readFileSync(path.join(buildDir(), "instructions.a+b.md"), "utf8"), /B changed/);
  });
});
