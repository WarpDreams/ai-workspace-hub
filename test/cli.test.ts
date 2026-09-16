import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, homeFor, makeSandbox, write, writeInstruction, writeManifest, writeSkill, type Sandbox } from "./helpers";

/**
 * End-to-end against the BUNDLED cli.cjs — the exact artifact that ships to
 * npm. Catches bundling regressions (a dependency that does not survive
 * esbuild, a broken shebang) that unit tests on src/ cannot see.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(repoRoot, "dist", "cli.cjs");

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.dispose());

function awh(args: string[], opts: { cwd?: string } = {}) {
  const res = spawnSync(process.execPath, [bundle, ...args], {
    cwd: opts.cwd ?? sb.root,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: sb.home,
      XDG_STATE_HOME: path.join(sb.root, "state"),
      NO_COLOR: "1",
      AWH_MANIFEST: "",
    },
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", all: (res.stdout ?? "") + (res.stderr ?? "") };
}

function seedContent() {
  writeInstruction(sb, "base", "# base\n");
  writeSkill(sb, "gmail");
  writeManifest(sb, {
    defaults: { instructions: ["base"], skills: "*" },
    targets: [{ agent: "claude", home: homeFor(sb, "claude") }],
  });
}

test("the bundle exists — run `npm run build` first", () => {
  assert.ok(fs.existsSync(bundle), `missing ${bundle}`);
  assert.match(fs.readFileSync(bundle, "utf8").slice(0, 30), /^#!\/usr\/bin\/env node/, "shebang must survive bundling");
});

describe("argument handling", () => {
  test("--version prints the package version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const r = awh(["--version"]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), `awh ${pkg.version}`, "the --define'd version must match package.json");
  });

  test("no args and --help print usage, exit 0", () => {
    for (const args of [[], ["--help"], ["-h"]]) {
      const r = awh(args);
      assert.equal(r.code, 0, `exit code for ${JSON.stringify(args)}`);
      assert.match(r.stdout, /Usage:\s+awh <command>/);
      for (const cmd of ["status", "plan", "install", "sync", "uninstall", "doctor", "launch"]) {
        assert.match(r.stdout, new RegExp(`\\b${cmd}\\b`), `usage should mention ${cmd}`);
      }
    }
  });

  test("an unknown command exits 2 with usage", () => {
    const r = awh(["frobnicate"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Unknown command: frobnicate/);
  });

  test("a missing manifest exits 2 and explains where it looked", () => {
    const r = awh(["status"]);
    assert.equal(r.code, 2);
    assert.match(r.all, /No manifest found/);
    assert.match(r.all, /\.awh\.jsonc/);
  });

  test("an explicit --manifest that does not exist exits 2", () => {
    const r = awh(["status", "-m", path.join(sb.root, "nope.jsonc")]);
    assert.equal(r.code, 2);
    assert.match(r.all, /not found/i);
  });

  test("an invalid manifest exits 2 naming the offending field", () => {
    write(sb.manifest, JSON.stringify({ targets: [{ agent: "nope", home: "~/x" }] }));
    const r = awh(["status", "-m", sb.manifest]);
    assert.equal(r.code, 2);
    assert.match(r.all, /Invalid manifest/);
    assert.match(r.all, /agent/);
  });

  test("JSONC comments and trailing commas are accepted", () => {
    writeInstruction(sb, "base");
    write(
      sb.manifest,
      ['{', '  // a comment', '  "defaults": { "instructions": ["base"], "skills": [] },', `  "targets": [{ "agent": "claude", "home": ${JSON.stringify(homeFor(sb, "claude"))} },],`, "}"].join("\n"),
    );
    const r = awh(["status", "-m", sb.manifest]);
    assert.equal(r.code, 0, r.all);
  });
});

describe("read-only commands", () => {
  test("status --json is machine readable and touches nothing", () => {
    seedContent();
    const r = awh(["status", "-m", sb.manifest, "--json"]);
    assert.equal(r.code, 0, r.all);
    const data = JSON.parse(r.stdout);
    assert.ok(data, "parses as JSON");
    assert.equal(exists(path.join(homeFor(sb, "claude"), "CLAUDE.md")), false, "status must not install");
  });

  test("plan --json is machine readable and touches nothing", () => {
    seedContent();
    const r = awh(["plan", "-m", sb.manifest, "--json"]);
    assert.equal(r.code, 0, r.all);
    JSON.parse(r.stdout);
    assert.equal(exists(path.join(homeFor(sb, "claude"), "CLAUDE.md")), false, "plan must not install");
  });

  test("doctor works with no manifest at all and suggests a starter", () => {
    const r = awh(["doctor"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /Suggested \.awh\.jsonc/);
  });

  test("the suggested starter manifest is valid and describes the machine", () => {
    // What doctor prints, a new user saves verbatim — so run it back through
    // the CLI and require that it loads.
    write(path.join(sb.home, ".claude", "CLAUDE.md"), "# claude\n");
    write(path.join(sb.home, ".codex", "AGENTS.md"), "# codex\n");
    write(path.join(sb.home, ".codex-backup", "AGENTS.md"), "# backup\n");

    const r = awh(["doctor"]);
    assert.equal(r.code, 0, r.all);

    const start = r.stdout.indexOf("{", r.stdout.indexOf("Suggested .awh.jsonc"));
    const json = r.stdout.slice(start, r.stdout.lastIndexOf("}") + 1);
    const suggested = JSON.parse(json);

    assert.deepEqual(suggested.defaults.instructions, []);
    assert.equal(suggested.color_output, true);
    const byAgent = (a: string) => suggested.targets.filter((t: any) => t.agent === a);
    assert.deepEqual(byAgent("claude")[0].instructions, ["CLAUDE.md"]);
    assert.equal(byAgent("codex").length, 2, "both codex homes are discovered");
    assert.equal(new Set(byAgent("codex").map((t: any) => t.name)).size, 2, "distinct launch names");

    // The listed files live in the agent homes, not in the content repo, so
    // doctor must say how to adopt them.
    assert.match(r.stdout, /Move them into your canon beside this manifest/);

    // Save it exactly as a user would. Once the named fragments exist in the
    // content repo beside the manifest, it must work unedited.
    const saved = path.join(sb.content, ".awh.jsonc");
    write(saved, json);
    write(path.join(sb.content, "CLAUDE.md"), "# adopted\n");
    write(path.join(sb.content, "AGENTS.md"), "# adopted\n");
    const status = awh(["status", "-m", saved, "--json"]);
    assert.equal(status.code, 0, `the suggested manifest must load:\n${status.all}`);
    JSON.parse(status.stdout);
  });

  test("doctor --json emits JSON", () => {
    seedContent();
    const r = awh(["doctor", "-m", sb.manifest, "--json"]);
    assert.equal(r.code, 0, r.all);
    JSON.parse(r.stdout);
  });
});

describe("install lifecycle through the CLI", () => {
  test("install, then uninstall, leaving nothing behind", () => {
    seedContent();
    const claudeMd = path.join(homeFor(sb, "claude"), "CLAUDE.md");
    const skill = path.join(homeFor(sb, "claude"), "skills", "gmail");

    assert.equal(awh(["install", "-m", sb.manifest]).code, 0);
    assert.ok(fs.lstatSync(claudeMd).isSymbolicLink());
    assert.ok(exists(skill));

    assert.equal(awh(["uninstall", "-m", sb.manifest]).code, 0);
    assert.equal(exists(claudeMd), false);
    assert.equal(exists(skill), false);
  });

  test("--dry-run installs nothing", () => {
    seedContent();
    const r = awh(["install", "-m", sb.manifest, "--dry-run"]);
    assert.equal(r.code, 0, r.all);
    assert.equal(exists(path.join(homeFor(sb, "claude"), "CLAUDE.md")), false);
  });

  test("$AWH_MANIFEST is honoured when -m is absent", () => {
    seedContent();
    const res = spawnSync(process.execPath, [bundle, "status", "--json"], {
      cwd: sb.root,
      encoding: "utf8",
      env: { ...process.env, HOME: sb.home, XDG_STATE_HOME: path.join(sb.root, "state"), AWH_MANIFEST: sb.manifest },
    });
    assert.equal(res.status, 0, (res.stdout ?? "") + (res.stderr ?? ""));
    JSON.parse(res.stdout);
  });

  test("a manifest in the cwd is found without -m", () => {
    seedContent();
    const r = awh(["status", "--json"], { cwd: sb.content });
    assert.equal(r.code, 0, r.all);
  });

  test("add-skill scaffolds a skill next to the manifest", () => {
    seedContent();
    const r = awh(["add-skill", "brand-new", "-m", sb.manifest]);
    assert.equal(r.code, 0, r.all);
    const created = path.join(sb.content, "skills", "brand-new", "SKILL.md");
    assert.ok(exists(created), `expected ${created}`);
    assert.match(fs.readFileSync(created, "utf8"), /brand-new/);
  });
});

describe("launch", () => {
  // `launch` owns its argv: its own flags come BEFORE the target, and
  // everything after the target is the agent's.
  test("a target that does not exist fails, listing the launchable ones", () => {
    seedContent();
    const r = awh(["launch", "-m", sb.manifest, "nosuchtarget"]);
    assert.equal(r.code, 2);
    assert.match(r.all, /No target named "nosuchtarget"/);
    assert.match(r.all, /Launchable targets:[\s\S]*claude/);
  });

  test("--dry-run on Claude's default home does NOT set CLAUDE_CONFIG_DIR", () => {
    // Setting CLAUDE_CONFIG_DIR=~/.claude makes Claude read
    // ~/.claude/.claude.json instead of the real ~/.claude.json, so the
    // adapter must leave it unset for the default home.
    seedContent(); // home is $HOME/.claude
    const r = awh(["launch", "-m", sb.manifest, "-n", "claude"]);
    assert.equal(r.code, 0, r.all);
    assert.equal(r.stdout.trim(), "claude");
  });

  test("--dry-run on a non-default home sets the home env var", () => {
    writeInstruction(sb, "base");
    const alt = path.join(sb.home, ".claude-work");
    writeManifest(sb, {
      defaults: { instructions: ["base"], skills: [] },
      targets: [
        { agent: "claude", home: alt, name: "work" },
        { agent: "codex", home: homeFor(sb, "codex") },
      ],
    });
    const claude = awh(["launch", "-m", sb.manifest, "-n", "work"]);
    assert.equal(claude.code, 0, claude.all);
    assert.match(claude.stdout, new RegExp(`CLAUDE_CONFIG_DIR=${alt}\\s+claude`));

    // Codex has no such special case: CODEX_HOME is always set.
    const codex = awh(["launch", "-m", sb.manifest, "-n", "codex"]);
    assert.equal(codex.code, 0, codex.all);
    assert.match(codex.stdout, new RegExp(`CODEX_HOME=${homeFor(sb, "codex")}\\s+codex`));
  });

  test("args after the target are passed to the agent verbatim", () => {
    seedContent();
    const r = awh(["launch", "-m", sb.manifest, "-n", "claude", "--model", "opus", "-p", "hi there"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /--model opus/);
    assert.match(r.stdout, /'hi there'/, "arguments needing quoting are shell-quoted, not split");
  });

  test("a pre-step commandline runs before the agent", () => {
    writeInstruction(sb, "base");
    writeManifest(sb, {
      defaults: { instructions: ["base"], skills: [] },
      targets: [{ agent: "codex", home: homeFor(sb, "codex"), commandline: ["echo pre-step", "codex -p bedrock"] }],
    });
    const r = awh(["launch", "-m", sb.manifest, "-n", "codex"]);
    assert.equal(r.code, 0, r.all);
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines.length, 2, "one line per pre-step plus the agent");
    assert.match(lines[0], /echo pre-step/);
    assert.match(lines[1], /codex -p bedrock/);
  });

  test("an unknown launch flag before the target exits 2", () => {
    seedContent();
    const r = awh(["launch", "-m", sb.manifest, "--bogus", "claude"]);
    assert.equal(r.code, 2);
    assert.match(r.all, /Unknown launch option: --bogus/);
  });

  test("launch with no target prints usage", () => {
    seedContent();
    const r = awh(["launch"]);
    assert.equal(r.code, 2);
    assert.match(r.all, /Usage: awh launch/);
  });
});
