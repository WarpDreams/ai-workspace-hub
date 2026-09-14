import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";
import { ManifestSchema, type Manifest } from "./schema";
import { repoRoot } from "../util/paths";

export const DEFAULT_MANIFEST_NAMES = [
  "machine.jsonc",
  "machine.json",
  "machine.local.jsonc",
] as const;

export class ManifestError extends Error {}

/** Locate the manifest file; explicit path wins, else search repo root. */
export function findManifest(explicit?: string): string | undefined {
  if (explicit) {
    const p = path.resolve(explicit);
    return fs.existsSync(p) ? p : undefined;
  }
  const root = repoRoot();
  for (const name of DEFAULT_MANIFEST_NAMES) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export interface LoadedManifest {
  path: string;
  manifest: Manifest;
}

export function loadManifest(explicit?: string): LoadedManifest {
  const file = findManifest(explicit);
  if (!file) {
    throw new ManifestError(
      `No manifest found. Create machine.jsonc at the repo root ` +
        `(copy one from examples/), or pass --manifest <path>.`,
    );
  }

  const raw = fs.readFileSync(file, "utf8");
  const errors: ParseError[] = [];
  const data = parseJsonc(raw, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join("\n");
    throw new ManifestError(`Failed to parse ${file} as JSONC:\n${details}`);
  }

  const result = ManifestSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ManifestError(`Invalid manifest ${file}:\n${issues}`);
  }

  return { path: file, manifest: result.data };
}
