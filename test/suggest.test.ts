import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildDoctorReport, suggestManifest } from "../src/core/doctor";
import { ManifestSchema } from "../src/config/schema";
import { makeSandbox, write, type Sandbox } from "./helpers";

/**
 * `doctor`'s starter manifest is the first thing a new user sees, and they
 * save it verbatim — so it must describe what is actually on the machine and
 * it must load without editing.
 */

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.dispose());

const home = (...p: string[]) => path.join(sb.home, ...p);

function suggest() {
  return suggestManifest(buildDoctorReport(undefined));
}

/** The suggestion must always be a manifest the loader accepts. */
function assertLoadable(s: unknown) {
  const r = ManifestSchema.safeParse(s);
  assert.ok(r.success, `suggestion is not a valid manifest:\n${r.success ? "" : JSON.stringify(r.error.issues, null, 2)}`);
  return r.success ? r.data : undefined!;
}

describe("defaults", () => {
  test("defaults.instructions is empty — nothing is claimed globally", () => {
    write(home(".claude", "CLAUDE.md"), "# claude\n");
    const s = suggest();
    assert.deepEqual(s.defaults.instructions, []);
    assert.equal(s.defaults.strategy, "symlink");
    assert.equal(s.defaults.skills, "*");
    assert.deepEqual(s.defaults.mcp, []);
  });

  test("colour is switched on — a starter manifest is for a person at a terminal", () => {
    write(home(".claude", "CLAUDE.md"), "# claude\n");
    const s = suggest();
    assert.equal(s.color_output, true);
    // It must survive a round trip through the schema, where the default is false.
    assert.equal(assertLoadable(s).color_output, true);
  });
});

describe("per-target instructions", () => {
  test("lists the instruction file found in a single-file agent's home", () => {
    write(home(".claude", "CLAUDE.md"), "# claude\n");
    write(home(".codex", "AGENTS.md"), "# codex\n");

    const s = suggest();
    const claude = s.targets.find((t) => t.agent === "claude")!;
    const codex = s.targets.find((t) => t.agent === "codex")!;
    assert.deepEqual(claude.instructions, ["CLAUDE.md"]);
    assert.deepEqual(codex.instructions, ["AGENTS.md"]);
    assertLoadable(s);
  });

  test("lists every steering file for a per-fragment agent, sorted", () => {
    write(home(".kiro", "steering", "product.md"), "# product\n");
    write(home(".kiro", "steering", "base.md"), "# base\n");
    write(home(".kiro", "steering", "notes.txt"), "not markdown\n");

    const kiro = suggest().targets.find((t) => t.agent === "kiro")!;
    assert.deepEqual(kiro.instructions, ["base.md", "product.md"]);
  });

  test("an agent home with no instruction files gets an empty array", () => {
    write(home(".claude", "skills", "gmail", "SKILL.md"), "# gmail\n");
    const claude = suggest().targets.find((t) => t.agent === "claude")!;
    assert.deepEqual(claude.instructions, [], "present but with no instructions");
    assertLoadable(suggest());
  });

  test("every target carries an instructions key, even when empty", () => {
    write(home(".claude", "CLAUDE.md"), "x");
    write(home(".codex", "config.toml"), "");
    for (const t of suggest().targets) {
      assert.ok(Array.isArray(t.instructions), `${t.agent} has no instructions array`);
    }
  });
});

describe("targets", () => {
  test("only homes that exist are suggested", () => {
    write(home(".claude", "CLAUDE.md"), "x");
    const s = suggest();
    assert.deepEqual(s.targets.map((t) => t.agent), ["claude"]);
    assert.match(s.targets[0].home, /^~\/\.claude$/, "homes are written back ~-relative");
  });

  test("a single home per agent needs no explicit name", () => {
    write(home(".claude", "CLAUDE.md"), "x");
    assert.equal(suggest().targets[0].name, undefined);
  });

  test("several homes of one agent each get a distinct name, so the manifest loads", () => {
    // Without names this is rejected at load time: `awh launch codex` would be
    // ambiguous between the two.
    write(home(".codex", "AGENTS.md"), "# main\n");
    write(home(".codex-backup", "AGENTS.md"), "# backup\n");

    const s = suggest();
    const codex = s.targets.filter((t) => t.agent === "codex");
    assert.equal(codex.length, 2);
    const names = codex.map((t) => t.name);
    assert.deepEqual(names, ["codex", "codex-backup"]);
    assert.equal(new Set(names).size, 2, "names must be unique");
    assertLoadable(s);
  });

  test("each of several homes keeps its own instruction list", () => {
    write(home(".codex", "AGENTS.md"), "# main\n");
    write(home(".codex-backup", "config.toml"), "");

    const s = suggest();
    const main = s.targets.find((t) => t.name === "codex")!;
    const backup = s.targets.find((t) => t.name === "codex-backup")!;
    assert.deepEqual(main.instructions, ["AGENTS.md"]);
    assert.deepEqual(backup.instructions, []);
  });

  test("an empty machine suggests no targets", () => {
    const s = suggest();
    assert.deepEqual(s.targets, []);
    // A manifest needs >= 1 target, so this one does NOT load — that is
    // correct: there is nothing to manage yet.
    assert.equal(ManifestSchema.safeParse(s).success, false);
  });
});
