import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestSchema, McpSpecSchema, resolveTargets } from "../src/config/schema";

const base = { targets: [{ agent: "claude", home: "~/.claude" }] };

function parse(m: unknown) {
  return ManifestSchema.safeParse(m);
}

function errText(m: unknown): string {
  const r = parse(m);
  assert.equal(r.success, false, "expected the manifest to be rejected");
  return r.success ? "" : r.error.issues.map((i) => i.message).join("\n");
}

describe("ManifestSchema", () => {
  test("applies documented defaults", () => {
    const r = parse(base);
    assert.ok(r.success);
    const m = r.data;
    assert.deepEqual(m.content_search_paths, ["."]);
    assert.equal(m.color_output, false);
    assert.equal(m.defaults.strategy, "symlink");
    assert.equal(m.defaults.skills, "*");
    // MCP installs drive vendor CLIs and may open browser logins: opt-in only.
    assert.deepEqual(m.defaults.mcp, []);
  });

  test("rejects unknown keys (strict) so typos are not silently ignored", () => {
    assert.match(errText({ ...base, targetz: [] }), /[Uu]nrecognized key/);
    assert.match(errText({ targets: [{ agent: "claude", home: "~/.claude", stratgy: "copy" }] }), /[Uu]nrecognized key/);
  });

  test("requires at least one target and a known agent", () => {
    assert.equal(parse({ targets: [] }).success, false);
    assert.equal(parse({ targets: [{ agent: "cursor", home: "~/x" }] }).success, false);
  });

  test("rejects ambiguous launch names", () => {
    // Two targets for one agent with no distinguishing name: `awh launch claude`
    // would be ambiguous, so this must fail at load time, not at launch time.
    const msg = errText({
      targets: [
        { agent: "codex", home: "~/.codex" },
        { agent: "codex", home: "~/.codex-work" },
      ],
    });
    assert.match(msg, /ambiguous/);
    assert.match(msg, /distinct "name"/);
  });

  test("rejects a duplicate explicit name, accepts distinct ones", () => {
    const dup = {
      targets: [
        { agent: "codex", home: "~/.codex", name: "work" },
        { agent: "codex", home: "~/.codex-2", name: "work" },
      ],
    };
    assert.match(errText(dup), /ambiguous/);

    const ok = parse({
      targets: [
        { agent: "codex", home: "~/.codex" },
        { agent: "codex", home: "~/.codex-2", name: "work" },
      ],
    });
    assert.ok(ok.success, "one default name plus one explicit name is unambiguous");
  });

  test("validates the target name charset", () => {
    assert.equal(parse({ targets: [{ agent: "kiro", home: "~/.kiro", name: "-bad" }] }).success, false);
    assert.equal(parse({ targets: [{ agent: "kiro", home: "~/.kiro", name: "has space" }] }).success, false);
    assert.ok(parse({ targets: [{ agent: "kiro", home: "~/.kiro", name: "work-1.2_x" }] }).success);
  });

  test("accepts both commandline shapes", () => {
    assert.ok(parse({ targets: [{ agent: "codex", home: "~/.codex", commandline: "codex -p bedrock" }] }).success);
    assert.ok(parse({ targets: [{ agent: "codex", home: "~/.codex", commandline: ["aws sso login", "codex"] }] }).success);
    assert.equal(parse({ targets: [{ agent: "codex", home: "~/.codex", commandline: [] }] }).success, false);
  });
});

describe("resolveTargets", () => {
  test("merges defaults and records where mcp came from", () => {
    const r = parse({
      defaults: { strategy: "copy", instructions: ["base"], skills: ["a"], mcp: ["ctx7"] },
      targets: [
        { agent: "claude", home: "~/.claude" },
        { agent: "codex", home: "~/.codex", strategy: "symlink", skills: "*", mcp: [] },
      ],
    });
    assert.ok(r.success);
    const [claude, codex] = resolveTargets(r.data);

    assert.equal(claude.strategy, "copy");
    assert.deepEqual(claude.skills, ["a"]);
    assert.deepEqual(claude.mcp, ["ctx7"]);
    assert.equal(claude.mcpOrigin, "defaults");
    assert.equal(claude.disabled, false);

    assert.equal(codex.strategy, "symlink");
    assert.equal(codex.skills, "*");
    assert.deepEqual(codex.mcp, []);
    assert.equal(codex.mcpOrigin, "targets[1]", "inline spec errors must point at the overriding target");
  });

  test("a target without a name is launched by its agent id", () => {
    const r = parse({ targets: [{ agent: "kiro", home: "~/.kiro" }] });
    assert.ok(r.success);
    assert.equal(resolveTargets(r.data)[0].name, undefined);
  });
});

describe("McpSpecSchema", () => {
  test("infers transport and defaults login to true", () => {
    const stdio = McpSpecSchema.parse({ command: "npx", args: ["-y", "pkg"] });
    assert.equal(stdio.type, undefined, "type stays unset; the transport is inferred downstream");
    assert.equal(stdio.login, true);
    assert.deepEqual(stdio.env, {});
  });

  test("stdio needs a command", () => {
    const r = McpSpecSchema.safeParse({ args: ["x"] });
    assert.equal(r.success, false);
    assert.match(r.success ? "" : r.error.issues.map((i) => i.message).join(), /stdio server needs `command`/);
  });

  test("http needs a url and must not carry command/args", () => {
    assert.equal(McpSpecSchema.safeParse({ type: "http" }).success, false);
    const r = McpSpecSchema.safeParse({ type: "http", url: "https://example.com/mcp", command: "npx" });
    assert.equal(r.success, false);
    assert.match(r.success ? "" : r.error.issues.map((i) => i.message).join(), /must not have `command`\/`args`/);
  });

  test("rejects a non-url url", () => {
    assert.equal(McpSpecSchema.safeParse({ type: "http", url: "not-a-url" }).success, false);
  });
});
