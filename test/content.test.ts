import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  availableInstructions,
  availableSkills,
  composeInstructions,
  composedInstructionPath,
  composedMatches,
  configureContent,
  contentIndex,
  isComposed,
  isOwnedPath,
  looksLikePath,
  resolveInstructionSelection,
  resolveSkillSelection,
  writeComposedInstructions,
} from "../src/core/content";
import { availableMcp } from "../src/core/mcp";
import { buildDir } from "../src/util/paths";
import { makeSandbox, write, writeInstruction, writeMcpSpec, writeSkill, type Sandbox } from "./helpers";

let sb: Sandbox;

// A fresh sandbox per test: the content index is a module-level singleton and
// discovery is order-sensitive, so tests must not inherit each other's trees.
beforeEach(() => {
  sb = makeSandbox();
  configureContent(sb.content, [sb.content]);
});
afterEach(() => sb.dispose());

describe("discovery by shape", () => {
  test("finds skills, instructions and mcp specs", () => {
    writeInstruction(sb, "base");
    writeInstruction(sb, "extra");
    writeSkill(sb, "gmail");
    writeMcpSpec(sb, "ctx7", { command: "npx", args: ["-y", "ctx7"] });
    configureContent(sb.content, [sb.content]);

    assert.deepEqual(availableInstructions(), ["base", "extra"]);
    assert.deepEqual(availableSkills(), ["gmail"]);
    assert.deepEqual(availableMcp(), ["ctx7"]);
  });

  test("a skill directory is a leaf — nested content inside it is not indexed", () => {
    const skill = writeSkill(sb, "outer");
    write(path.join(skill, "instructions", "buried.md"), "x");
    writeSkill(sb, path.join("outer", "inner"));
    configureContent(sb.content, [sb.content]);

    assert.ok(availableSkills().includes("outer"));
    assert.equal(availableSkills().includes("inner"), false, "must not descend into a skill");
    assert.equal(availableInstructions().includes("buried"), false);
  });

  test("skips .git, node_modules and dot-directories", () => {
    write(path.join(sb.content, ".git", "instructions", "git.md"), "x");
    write(path.join(sb.content, "node_modules", "pkg", "instructions", "dep.md"), "x");
    write(path.join(sb.content, ".hidden", "instructions", "secret.md"), "x");
    configureContent(sb.content, [sb.content]);

    const found = availableInstructions();
    for (const name of ["git", "dep", "secret"]) {
      assert.equal(found.includes(name), false, `${name} should not be indexed`);
    }
  });

  test("a later search path wins and the shadowing is recorded for doctor", () => {
    const a = path.join(sb.root, "pathA");
    const b = path.join(sb.root, "pathB");
    write(path.join(a, "instructions", "base.md"), "from A\n");
    write(path.join(b, "instructions", "base.md"), "from B\n");
    configureContent(sb.content, [a, b]);

    const idx = contentIndex();
    assert.equal(idx.instructions.get("base")!.path, path.join(b, "instructions", "base.md"));
    assert.equal(idx.shadowed.length, 1);
    assert.equal(idx.shadowed[0].kind, "instruction");
    assert.equal(idx.shadowed[0].name, "base");
    assert.equal(idx.shadowed[0].loser.searchPath, a);
    assert.equal(idx.shadowed[0].winner.searchPath, b);
  });

  test("a missing search path is ignored rather than fatal", () => {
    configureContent(sb.content, [path.join(sb.root, "does-not-exist")]);
    assert.deepEqual(availableInstructions(), []);
  });
});

describe("selector resolution", () => {
  test("looksLikePath distinguishes names from paths", () => {
    for (const p of ["./x", "a/b", "~/x", ".awh.jsonc", "foo.md", "s.json"]) {
      assert.ok(looksLikePath(p), `${p} should look like a path`);
    }
    for (const n of ["base", "gmail-manager", "ctx7"]) {
      assert.equal(looksLikePath(n), false, `${n} should look like a name`);
    }
  });

  test("resolves selections by name and by path", () => {
    writeInstruction(sb, "base");
    const skill = writeSkill(sb, "gmail");
    const loose = write(path.join(sb.root, "loose", "notes.md"), "x");
    configureContent(sb.content, [sb.content]);

    assert.equal(resolveInstructionSelection(["base"])[0].file, path.join(sb.content, "instructions", "base.md"));
    const byPath = resolveInstructionSelection([loose])[0];
    assert.equal(byPath.name, "notes", "a path entry is named after its file");
    assert.equal(byPath.file, loose);
    assert.equal(resolveSkillSelection(["gmail"])[0].dir, skill);
    assert.deepEqual(
      resolveSkillSelection("*").map((s) => s.name),
      ["gmail"],
    );
  });

  test("a missing fragment or skill fails loudly, listing what was discovered", () => {
    writeInstruction(sb, "base");
    writeSkill(sb, "gmail");
    configureContent(sb.content, [sb.content]);

    assert.throws(() => resolveInstructionSelection(["nope"]), /not found[\s\S]*base/);
    assert.throws(() => resolveSkillSelection(["nope"]), /SKILL\.md[\s\S]*gmail/);
  });

  test("a directory without SKILL.md is not a skill", () => {
    fs.mkdirSync(path.join(sb.content, "skills", "empty"), { recursive: true });
    configureContent(sb.content, [sb.content]);
    assert.equal(availableSkills().includes("empty"), false);
    assert.throws(() => resolveSkillSelection(["empty"]), /SKILL\.md/);
  });
});

describe("instruction composition", () => {
  test("a single fragment is linked directly — nothing is generated", () => {
    writeInstruction(sb, "solo", "# solo\n");
    configureContent(sb.content, [sb.content]);
    const frags = resolveInstructionSelection(["solo"]);

    assert.equal(isComposed(frags), false);
    assert.equal(composedInstructionPath(frags), path.join(sb.content, "instructions", "solo.md"));
    assert.equal(writeComposedInstructions(frags), composedInstructionPath(frags));
    assert.equal(fs.existsSync(buildDir()), false, "no build dir for a single fragment");
  });

  test("several fragments compose into the build dir, in manifest order", () => {
    writeInstruction(sb, "a", "# A\n\n");
    writeInstruction(sb, "b", "# B\n");
    configureContent(sb.content, [sb.content]);
    const frags = resolveInstructionSelection(["a", "b"]);

    assert.ok(isComposed(frags));
    assert.equal(composedInstructionPath(frags), path.join(buildDir(), "instructions.a+b.md"));
    assert.equal(composeInstructions(frags), "# A\n\n# B\n", "trailing blank lines trimmed, one blank line between");

    const out = writeComposedInstructions(frags);
    assert.equal(fs.readFileSync(out, "utf8"), "# A\n\n# B\n");
    assert.ok(composedMatches(frags, out));
  });

  test("editing a fragment makes the existing composite stale", () => {
    writeInstruction(sb, "a", "# A\n");
    writeInstruction(sb, "b", "# B\n");
    configureContent(sb.content, [sb.content]);
    const frags = resolveInstructionSelection(["a", "b"]);
    const out = writeComposedInstructions(frags);
    assert.ok(composedMatches(frags, out));

    writeInstruction(sb, "b", "# B changed\n");
    assert.equal(composedMatches(frags, out), false, "plan/status must see this as stale");

    writeComposedInstructions(frags);
    assert.ok(composedMatches(frags, out), "install/sync refreshes it");
  });

  test("composedInstructionPath rejects an empty selection", () => {
    assert.throws(() => composedInstructionPath([]), /at least one fragment/);
  });
});

describe("ownership", () => {
  test("only the search paths and the build dir count as ours", () => {
    configureContent(sb.content, [sb.content]);
    assert.ok(isOwnedPath(path.join(sb.content, "skills", "x")));
    assert.ok(isOwnedPath(path.join(buildDir(), "instructions.a+b.md")));
    assert.equal(isOwnedPath(path.join(sb.root, "elsewhere", "x")), false);
  });
});
