import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This is a public package. Nothing shipped in it — and nothing in the sources
 * it is built from — may carry an employer's or client's name, internal
 * infrastructure identifiers, or private hostnames. Defaults in particular are
 * easy to forget: they end up in the schema, in `doctor`'s suggested manifest,
 * in the README and in every example.
 *
 * Add a pattern here whenever a new organisation or internal system comes up.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Built from fragments so this file does not itself contain the literals. */
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: "employer name", re: new RegExp(["app", "lus"].join(""), "i") },
  { label: "employer domain", re: new RegExp(["auspay", "plus"].join(""), "i") },
  { label: "employer long name", re: /australian\s+payment/i },
  { label: "corporate proxy vendor", re: /netskope/i },
  { label: "AWS account id", re: /\b\d{12}\b/ },
  { label: "private Atlassian tenant", re: /[a-z0-9-]+\.atlassian\.net/i },
];

/** Files that ship in the tarball, plus the sources they are built from. */
function filesToScan(): string[] {
  const out: string[] = [];
  const roots = ["src", "examples", "test"];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  for (const r of roots) walk(path.join(repoRoot, r));
  for (const f of ["README.md", "CHANGELOG.md", "package.json", "LICENSE"]) {
    out.push(path.join(repoRoot, f));
  }
  const bundle = path.join(repoRoot, "dist", "cli.cjs");
  if (fs.existsSync(bundle)) out.push(bundle);
  return out;
}

describe("no organisation-specific identifiers leak into a public package", () => {
  for (const { label, re } of FORBIDDEN) {
    test(`no ${label}`, () => {
      const hits: string[] = [];
      for (const file of filesToScan()) {
        const rel = path.relative(repoRoot, file);
        // This file legitimately contains the patterns that define the rule.
        if (rel === path.join("test", "hygiene.test.ts")) continue;
        const body = fs.readFileSync(file, "utf8");
        body.split("\n").forEach((line, i) => {
          if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
      }
      assert.deepEqual(hits, [], `found ${label} in a public artifact:\n${hits.join("\n")}`);
    });
  }
});

describe("the shipped default instruction fragment is generic", () => {
  test("schema default is a neutral name", async () => {
    const { ManifestSchema } = await import("../src/config/schema");
    const parsed = ManifestSchema.parse({ targets: [{ agent: "claude", home: "~/.claude" }] });
    assert.deepEqual(parsed.defaults.instructions, ["base"]);
  });
});
