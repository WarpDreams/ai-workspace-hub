import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { configureContent } from "../src/core/content";
import {
  describeSpec,
  inlineMcpDeclarations,
  normalizeArg,
  resolveMcpSpecs,
  specMatches,
  type McpServerOnDisk,
  type McpSpec,
} from "../src/core/mcp";
import { ManifestSchema, McpSpecSchema } from "../src/config/schema";
import { getAdapter } from "../src/adapters/index";
import { makeSandbox, write, writeMcpSpec, type Sandbox } from "./helpers";

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox();
  configureContent(sb.content, [sb.content]);
});
afterEach(() => sb.dispose());

/**
 * An inline `{ name: spec }` selector entry as the loader produces it: the
 * manifest is zod-parsed first, so defaults (args/env/login) are already
 * filled in by the time resolveMcpSpecs sees it.
 */
const inline = (name: string, spec: unknown) => ({ [name]: McpSpecSchema.parse(spec) });

const stdio = (over: Partial<McpSpec> = {}): McpSpec => ({
  name: "s",
  type: "stdio",
  command: "npx",
  args: [],
  env: {},
  login: true,
  file: "test",
  inline: false,
  ...over,
});

describe("version-agnostic matching", () => {
  test("normalizeArg strips a version from a package spec, and only that", () => {
    assert.equal(normalizeArg("@scope/pkg@1.2.3"), "@scope/pkg");
    assert.equal(normalizeArg("pkg@latest"), "pkg");
    assert.equal(normalizeArg("pkg@^2"), "pkg");
    assert.equal(normalizeArg("pkg"), "pkg");
    assert.equal(normalizeArg("-y"), "-y");
    assert.equal(normalizeArg("--port=3000"), "--port=3000");
    assert.equal(normalizeArg("/abs/path@thing/x"), "/abs/path@thing/x", "paths are left alone");
  });

  test("a version bump is still the same server", () => {
    const spec = stdio({ args: ["-y", "@upstash/context7-mcp@1.0.0"] });
    const disk: McpServerOnDisk = { type: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp@2.7.1"], raw: {} };
    assert.ok(specMatches(spec, disk));
  });

  test("a different command, arg count or env value is a different server", () => {
    const spec = stdio({ args: ["-y", "pkg"], env: { TOKEN: "a" } });
    assert.equal(specMatches(spec, { type: "stdio", command: "uvx", args: ["-y", "pkg"], env: { TOKEN: "a" }, raw: {} }), false);
    assert.equal(specMatches(spec, { type: "stdio", command: "npx", args: ["pkg"], env: { TOKEN: "a" }, raw: {} }), false);
    assert.equal(specMatches(spec, { type: "stdio", command: "npx", args: ["-y", "pkg"], env: { TOKEN: "b" }, raw: {} }), false);
    assert.equal(specMatches(spec, { type: "stdio", command: "npx", args: ["-y", "pkg"], raw: {} }), false, "missing env differs");
  });

  test("transport must agree", () => {
    assert.equal(specMatches(stdio(), { type: "http", url: "https://x/mcp", raw: {} }), false);
    assert.equal(specMatches(stdio(), { type: "other", raw: {} }), false);
  });

  test("http compares urls modulo a trailing slash", () => {
    const spec = stdio({ type: "http", command: undefined, url: "https://example.com/mcp" });
    assert.ok(specMatches(spec, { type: "http", url: "https://example.com/mcp/", raw: {} }));
    assert.equal(specMatches(spec, { type: "http", url: "https://example.com/other", raw: {} }), false);
  });

  test("a server the agent has disabled does not count as installed", () => {
    const spec = stdio({ args: ["-y", "pkg"] });
    const disk: McpServerOnDisk = { type: "stdio", command: "npx", args: ["-y", "pkg"], disabled: true, raw: {} };
    assert.equal(specMatches(spec, disk), false, "a disabled server should be re-added, not reported in sync");
  });
});

describe("selector resolution", () => {
  test('"*" loads every discovered spec', () => {
    writeMcpSpec(sb, "ctx7", { command: "npx", args: ["-y", "ctx7"] });
    writeMcpSpec(sb, "fetch", { command: "uvx", args: ["mcp-fetch"] });
    configureContent(sb.content, [sb.content]);

    const specs = resolveMcpSpecs("*", sb.manifest, "defaults");
    assert.deepEqual(specs.map((s) => s.name).sort(), ["ctx7", "fetch"]);
    assert.equal(specs[0].inline, false);
    assert.equal(specs.find((s) => s.name === "ctx7")!.type, "stdio", "transport inferred from command");
  });

  test("an inline declaration beats a discovered spec of the same name", () => {
    writeMcpSpec(sb, "ctx7", { command: "npx", args: ["-y", "from-file"] });
    configureContent(sb.content, [sb.content]);

    const specs = resolveMcpSpecs(["ctx7", inline("ctx7", { command: "npx", args: ["-y", "from-inline"] })], sb.manifest, "targets[0]");
    assert.equal(specs.length, 1);
    assert.deepEqual(specs[0].args, ["-y", "from-inline"]);
    assert.ok(specs[0].inline);
    assert.equal(specs[0].file, `${sb.manifest}#targets[0].mcp.ctx7`, "origin is traceable for error messages");
  });

  test("inline wins regardless of order", () => {
    writeMcpSpec(sb, "ctx7", { command: "npx", args: ["-y", "from-file"] });
    configureContent(sb.content, [sb.content]);

    const specs = resolveMcpSpecs([inline("ctx7", { command: "npx", args: ["-y", "from-inline"] }), "ctx7"], sb.manifest, "defaults");
    assert.equal(specs.length, 1);
    assert.deepEqual(specs[0].args, ["-y", "from-inline"]);
  });

  test("declaring one name inline twice is an error", () => {
    assert.throws(
      () =>
        resolveMcpSpecs(
          [inline("dup", { command: "a" }), inline("dup", { command: "b" })],
          sb.manifest,
          "defaults",
        ),
      /declared inline more than once in defaults\.mcp/,
    );
  });

  test("a named spec that does not exist fails with what is available", () => {
    writeMcpSpec(sb, "ctx7", { command: "npx" });
    configureContent(sb.content, [sb.content]);
    assert.throws(() => resolveMcpSpecs(["nope"], sb.manifest, "defaults"), /not found[\s\S]*ctx7/);
  });

  test("a selector entry may be a path to a spec file", () => {
    const file = write(path.join(sb.root, "loose", "thing.jsonc"), JSON.stringify({ command: "npx", args: ["thing"] }));
    configureContent(sb.content, [sb.content]);
    const specs = resolveMcpSpecs([file], sb.manifest, "defaults");
    assert.equal(specs[0].name, "thing");
    assert.equal(specs[0].file, file);
  });

  test("inlineMcpDeclarations reports every inline server with its origin", () => {
    const parsed = ManifestSchema.parse({
      defaults: { mcp: [{ a: { command: "x" } }] },
      targets: [
        { agent: "claude", home: "~/.claude" },
        { agent: "codex", home: "~/.codex", mcp: ["disk-one", { b: { type: "http", url: "https://e.com/mcp" } }] },
      ],
    });
    const decls = inlineMcpDeclarations(parsed, "/m/.awh.jsonc");
    assert.deepEqual(decls.map((d) => d.name), ["a", "b"]);
    assert.equal(decls[0].file, "/m/.awh.jsonc#defaults.mcp.a");
    assert.equal(decls[1].file, "/m/.awh.jsonc#targets[1].mcp.b");
    assert.equal(describeSpec(decls[1]), "http https://e.com/mcp");
  });
});

describe("adapters read agent config without writing it", () => {
  test("Claude reads mcpServers from .claude.json", () => {
    const home = path.join(sb.home, ".claude-alt");
    write(
      path.join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { ctx7: { command: "npx", args: ["-y", "ctx7"] }, api: { type: "http", url: "https://e.com/mcp" } } }),
    );
    const got = getAdapter("claude").mcp.readServers(home);
    assert.equal(got.ctx7.type, "stdio");
    assert.equal(got.api.type, "http");
    assert.equal(got.api.url, "https://e.com/mcp");
  });

  test("Claude's default home reads ~/.claude.json, not ~/.claude/.claude.json", () => {
    // CLAUDE_CONFIG_DIR=~/.claude changes where Claude looks, so awh must
    // special-case the default home.
    write(path.join(os.homedir(), ".claude.json"), JSON.stringify({ mcpServers: { top: { command: "x" } } }));
    const got = getAdapter("claude").mcp.readServers(path.join(os.homedir(), ".claude"));
    assert.deepEqual(Object.keys(got), ["top"]);
    assert.equal(getAdapter("claude").mcp.configFile(path.join(os.homedir(), ".claude")), path.join(os.homedir(), ".claude.json"));
  });

  test("Codex reads mcp_servers tables from config.toml and honours enabled = false", () => {
    const home = path.join(sb.home, ".codex");
    write(
      path.join(home, "config.toml"),
      ['[mcp_servers.ctx7]', 'command = "npx"', 'args = ["-y", "ctx7"]', "", "[mcp_servers.off]", 'command = "x"', "enabled = false", ""].join("\n"),
    );
    const got = getAdapter("codex").mcp.readServers(home);
    assert.deepEqual(got.ctx7.args, ["-y", "ctx7"]);
    assert.equal(got.ctx7.disabled, false);
    assert.equal(got.off.disabled, true);
  });

  test("a malformed or missing agent config yields no servers instead of throwing", () => {
    const home = path.join(sb.home, ".codex-broken");
    write(path.join(home, "config.toml"), "this is not toml {{{");
    assert.deepEqual(getAdapter("codex").mcp.readServers(home), {});
    assert.deepEqual(getAdapter("codex").mcp.readServers(path.join(sb.home, "nonexistent")), {});
    assert.deepEqual(getAdapter("claude").mcp.readServers(path.join(sb.home, "nonexistent")), {});
  });

  test("Kiro cannot add http servers through its CLI", () => {
    const kiro = getAdapter("kiro").mcp;
    assert.equal(kiro.addArgv("x", stdio({ type: "http", command: undefined, url: "https://e.com/mcp" })), undefined);
    assert.ok(kiro.addArgv("x", stdio({ command: "npx", args: ["a"] }))!.includes("--scope"));
  });

  test("add argv shapes are what each vendor CLI expects", () => {
    const spec = stdio({ command: "npx", args: ["-y", "pkg"], env: { TOKEN: "t" } });
    assert.deepEqual(getAdapter("codex").mcp.addArgv("n", spec), [
      "codex", "mcp", "add", "n", "--env", "TOKEN=t", "--", "npx", "-y", "pkg",
    ]);
    const claudeArgv = getAdapter("claude").mcp.addArgv("n", spec)!;
    assert.deepEqual(claudeArgv.slice(0, 6), ["claude", "mcp", "add-json", "-s", "user", "n"]);
    assert.deepEqual(JSON.parse(claudeArgv[6]), { type: "stdio", command: "npx", args: ["-y", "pkg"], env: { TOKEN: "t" } });
  });
});
