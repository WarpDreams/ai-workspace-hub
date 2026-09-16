import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadManifest } from "../src/config/load";
import { ManifestSchema, canonSearchPaths } from "../src/config/schema";
import { availableSkills, canonConfigured, contentIndex, resolveInstructionSelection, resolveSkillSelection } from "../src/core/content";
import { resolveMcpSpecs } from "../src/core/mcp";
import { makeSandbox, write, writeInstruction, writeManifest, writeMcpSpec, writeSkill, type Sandbox } from "./helpers";

/**
 * Canon roots have NO default. Guessing the manifest's own directory turned a
 * manifest saved in $HOME into a recursive scan of the entire home directory —
 * Library/, cloud-storage mounts, every project — at 100% CPU with no output.
 * Nothing is scanned unless the manifest says what to scan.
 */

let sb: Sandbox;
const warnings: string[] = [];
let realWarn: typeof console.warn;

beforeEach(() => {
  sb = makeSandbox();
  warnings.length = 0;
  realWarn = console.warn;
  console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));
});
afterEach(() => {
  console.warn = realWarn;
  sb.dispose();
});

const claudeTarget = () => ({ agent: "claude", home: path.join(sb.home, ".claude") });

describe("no default canon root", () => {
  test("a manifest with no canon_search_paths scans nothing at all", () => {
    // Previously this defaulted to ["."] — the manifest's own directory.
    writeSkill(sb, "gmail");
    writeManifest(sb, { defaults: { instructions: [], skills: "*" }, targets: [claudeTarget()] });

    const loaded = loadManifest(sb.manifest);
    assert.deepEqual(loaded.searchPaths, [], "no roots, not the manifest's directory");
    assert.equal(canonConfigured(), false);
    assert.deepEqual(availableSkills(), [], "the skill beside the manifest is NOT picked up");
  });

  test("a manifest in $HOME no longer turns the home directory into a canon", () => {
    // The exact shape that hung: a real .awh.jsonc in $HOME.
    const manifest = path.join(sb.home, ".awh.jsonc");
    write(manifest, JSON.stringify({ defaults: { instructions: [], skills: "*" }, targets: [claudeTarget()] }));
    const loaded = loadManifest(manifest);
    assert.deepEqual(loaded.searchPaths, []);
  });

  test("an explicitly empty list is the same as omitting it", () => {
    writeSkill(sb, "gmail");
    writeManifest(sb, { canon_search_paths: [], defaults: { skills: "*" }, targets: [claudeTarget()] });
    loadManifest(sb.manifest);
    assert.equal(canonConfigured(), false);
    assert.deepEqual(availableSkills(), []);
  });

  test("declaring a root opts in, and only then is anything scanned", () => {
    writeSkill(sb, "gmail");
    writeInstruction(sb, "base");
    writeManifest(sb, { canon_search_paths: [sb.content], defaults: { instructions: ["base"], skills: "*" }, targets: [claudeTarget()] });

    loadManifest(sb.manifest);
    assert.ok(canonConfigured());
    assert.deepEqual(availableSkills(), ["gmail"]);
  });

  test('"." still works when asked for explicitly', () => {
    writeSkill(sb, "gmail");
    writeManifest(sb, { canon_search_paths: ["."], defaults: { skills: "*" }, targets: [claudeTarget()] });
    loadManifest(sb.manifest);
    assert.deepEqual(availableSkills(), ["gmail"]);
  });
});

describe("selectors bypass discovery when there is no canon", () => {
  beforeEach(() => {
    writeManifest(sb, { defaults: { instructions: [], skills: [] }, targets: [claudeTarget()] });
    loadManifest(sb.manifest);
  });

  test('"*" selects nothing rather than failing', () => {
    assert.deepEqual(resolveSkillSelection("*"), []);
  });

  test("named entries are skipped with a warning, not an error", () => {
    assert.deepEqual(resolveInstructionSelection(["base"]), []);
    assert.deepEqual(resolveSkillSelection(["gmail"]), []);
    assert.ok(
      warnings.some((w) => /no "canon_search_paths"/.test(w)),
      `expected a warning, got: ${JSON.stringify(warnings)}`,
    );
  });

  test("explicit paths still resolve — they never needed discovery", () => {
    const frag = write(path.join(sb.root, "loose", "notes.md"), "# notes\n");
    const skill = writeSkill(sb, "bypath");
    assert.deepEqual(resolveInstructionSelection([frag]).map((f) => f.file), [frag]);
    assert.deepEqual(resolveSkillSelection([skill]).map((s) => s.dir), [skill]);
  });

  test("MCP: discovered names are skipped, inline declarations still apply", () => {
    const inline = { notion: ManifestSchema.parse({ targets: [claudeTarget()] }) && { url: "https://mcp.notion.com/mcp", args: [], env: {}, login: true } };
    const specs = resolveMcpSpecs(["some-discovered-name", inline as never], sb.manifest, "defaults");
    assert.deepEqual(specs.map((s) => s.name), ["notion"], "inline survives, the name lookup is skipped");
    assert.ok(warnings.some((w) => /skipping MCP server "some-discovered-name"/.test(w)));
  });
});

describe("unreadable canon roots warn and are skipped", () => {
  function loadWith(roots: string[]) {
    writeManifest(sb, { canon_search_paths: roots, defaults: { instructions: [], skills: "*" }, targets: [claudeTarget()] });
    loadManifest(sb.manifest);
    return contentIndex();
  }

  test("a missing directory is skipped, and later roots are still scanned", () => {
    writeSkill(sb, "gmail");
    const idx = loadWith([path.join(sb.root, "does-not-exist"), sb.content]);

    assert.equal(idx.unreadable.length, 1);
    assert.match(idx.unreadable[0].reason, /no such directory/);
    assert.ok(warnings.some((w) => /skipping canon search path/.test(w)));
    assert.deepEqual(availableSkills(), ["gmail"], "the good root still worked");
  });

  test("a file where a directory was expected is skipped", () => {
    const notADir = write(path.join(sb.root, "a-file.txt"), "x");
    const idx = loadWith([notADir]);
    assert.match(idx.unreadable[0].reason, /not a directory/);
  });

  test("an unreadable directory is skipped rather than aborting the run", () => {
    const locked = path.join(sb.root, "locked");
    fs.mkdirSync(locked, { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      const idx = loadWith([locked]);
      // Running as root defeats the permission bits; only assert when it bites.
      if (idx.unreadable.length > 0) assert.match(idx.unreadable[0].reason, /permission denied/);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  test("a dangling symlink is skipped", () => {
    const link = path.join(sb.root, "dangling");
    fs.symlinkSync(path.join(sb.root, "nope"), link);
    const idx = loadWith([link]);
    assert.equal(idx.unreadable.length, 1);
  });
});

describe("content_search_paths is deprecated but still honoured", () => {
  test("the old key works and warns", () => {
    writeSkill(sb, "gmail");
    writeManifest(sb, { content_search_paths: [sb.content], defaults: { skills: "*" }, targets: [claudeTarget()] });

    const loaded = loadManifest(sb.manifest);
    assert.deepEqual(loaded.searchPaths, [sb.content]);
    assert.deepEqual(availableSkills(), ["gmail"]);
    assert.ok(
      warnings.some((w) => /renamed to "canon_search_paths"/.test(w)),
      `expected a deprecation warning, got: ${JSON.stringify(warnings)}`,
    );
  });

  test("the new key wins when both are present, and says so", () => {
    const other = path.join(sb.root, "other");
    write(path.join(other, "instructions", "fromNew.md"), "x");
    writeSkill(sb, "fromOld");
    writeManifest(sb, {
      canon_search_paths: [other],
      content_search_paths: [sb.content],
      defaults: { instructions: [], skills: "*" },
      targets: [claudeTarget()],
    });

    const loaded = loadManifest(sb.manifest);
    assert.deepEqual(loaded.searchPaths, [other]);
    assert.deepEqual(availableSkills(), [], "the old key's root was not scanned");
    assert.ok(warnings.some((w) => /Ignoring it in favour of/.test(w)));
  });

  test("canonSearchPaths resolves the precedence", () => {
    const parse = (o: object) => canonSearchPaths(ManifestSchema.parse({ targets: [claudeTarget()], ...o }));
    assert.deepEqual(parse({}), []);
    assert.deepEqual(parse({ canon_search_paths: ["a"] }), ["a"]);
    assert.deepEqual(parse({ content_search_paths: ["b"] }), ["b"]);
    assert.deepEqual(parse({ canon_search_paths: ["a"], content_search_paths: ["b"] }), ["a"]);
  });
});
