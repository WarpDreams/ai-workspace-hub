import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadManifest } from "../src/config/load";
import { availableSkills, configureContent } from "../src/core/content";
import { makeSandbox, write, writeManifest, writeSkill, type Sandbox } from "./helpers";

/**
 * A canon root that is really a home directory turns `awh doctor` into an
 * unbounded walk of Library/, cloud-storage mounts and every project on the
 * machine: 100% CPU, no output, no way to tell what is happening. Both guards
 * here exist to make that fail fast and say what to do.
 */

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  delete process.env.AWH_MAX_SCAN_DIRS;
  sb.dispose();
});

describe("a home directory is never a canon root", () => {
  test("a manifest saved straight into $HOME is rejected, not scanned", () => {
    // The trap: content_search_paths defaults to ["."], resolved against the
    // REAL manifest file's directory — so this makes the canon $HOME.
    const manifest = path.join(sb.home, ".awh.jsonc");
    write(manifest, JSON.stringify({ targets: [{ agent: "claude", home: path.join(sb.home, ".claude") }] }));

    assert.throws(
      () => loadManifest(manifest),
      (e: Error) => {
        assert.match(e.message, /Canon root is your home directory/);
        assert.match(e.message, /look like a hang/);
        assert.match(e.message, /ln -s/, "must show the way out");
        return true;
      },
    );
  });

  test("an explicit content_search_paths of ~ is rejected too", () => {
    writeManifest(sb, {
      content_search_paths: ["~"],
      targets: [{ agent: "claude", home: path.join(sb.home, ".claude") }],
    });
    assert.throws(() => loadManifest(sb.manifest), /Canon root is your home directory/);
  });

  test("the filesystem root is rejected", () => {
    writeManifest(sb, {
      content_search_paths: ["/"],
      targets: [{ agent: "claude", home: path.join(sb.home, ".claude") }],
    });
    assert.throws(() => loadManifest(sb.manifest), /Canon root is the filesystem root/);
  });

  test("a normal canon directory is unaffected", () => {
    writeSkill(sb, "gmail");
    writeManifest(sb, {
      defaults: { instructions: [], skills: "*" },
      targets: [{ agent: "claude", home: path.join(sb.home, ".claude") }],
    });
    const loaded = loadManifest(sb.manifest);
    assert.equal(loaded.searchPaths.length, 1);
    assert.deepEqual(availableSkills(), ["gmail"]);
  });

  test("a canon nested inside the home directory is fine — only $HOME itself is refused", () => {
    const canon = path.join(sb.home, "ai-canon");
    write(path.join(canon, "instructions", "base.md"), "# base\n");
    write(
      path.join(canon, ".awh.jsonc"),
      JSON.stringify({ defaults: { instructions: ["base"], skills: [] }, targets: [{ agent: "claude", home: path.join(sb.home, ".claude") }] }),
    );
    const loaded = loadManifest(path.join(canon, ".awh.jsonc"));
    assert.deepEqual(loaded.searchPaths, [canon]);
  });

  test("a ~/.awh.jsonc that symlinks into a canon is fine — the REAL path decides", () => {
    // This is the documented setup: the manifest lives in the canon, and ~ only
    // holds a symlink to it. The canon root must follow the symlink target.
    const canon = path.join(sb.home, "ai-canon");
    const real = path.join(canon, ".awh.jsonc");
    write(path.join(canon, "instructions", "base.md"), "# base\n");
    write(real, JSON.stringify({ defaults: { instructions: ["base"], skills: [] }, targets: [{ agent: "claude", home: path.join(sb.home, ".claude") }] }));

    const link = path.join(sb.home, ".awh.jsonc");
    fs.symlinkSync(real, link);

    const loaded = loadManifest(link);
    assert.deepEqual(loaded.searchPaths, [canon], "must resolve to the canon, not $HOME");
  });
});

describe("runaway scans give up with a message", () => {
  test("a canon far larger than any real one aborts instead of spinning", () => {
    process.env.AWH_MAX_SCAN_DIRS = "5";
    for (let i = 0; i < 12; i++) write(path.join(sb.content, `dir${i}`, "keep.txt"), "x");
    configureContent(sb.content, [sb.content]);

    assert.throws(
      () => availableSkills(),
      (e: Error) => {
        assert.match(e.message, /Canon scan gave up after 5 directories/);
        assert.match(e.message, /Narrow "content_search_paths"/);
        assert.match(e.message, /AWH_MAX_SCAN_DIRS/, "must name the escape hatch");
        return true;
      },
    );
  });

  test("the limit is generous enough that an ordinary canon never trips it", () => {
    for (let i = 0; i < 40; i++) writeSkill(sb, `skill-${i}`);
    write(path.join(sb.content, "instructions", "base.md"), "# base\n");
    configureContent(sb.content, [sb.content]);
    assert.equal(availableSkills().length, 40);
  });

  test("AWH_MAX_SCAN_DIRS raises the limit for a genuinely large canon", () => {
    process.env.AWH_MAX_SCAN_DIRS = "1000";
    for (let i = 0; i < 12; i++) write(path.join(sb.content, `dir${i}`, "keep.txt"), "x");
    configureContent(sb.content, [sb.content]);
    assert.deepEqual(availableSkills(), [], "scans cleanly, finds no skills");
  });

  test("a bogus AWH_MAX_SCAN_DIRS falls back to the default rather than breaking", () => {
    process.env.AWH_MAX_SCAN_DIRS = "not-a-number";
    writeSkill(sb, "gmail");
    configureContent(sb.content, [sb.content]);
    assert.deepEqual(availableSkills(), ["gmail"]);
  });
});
