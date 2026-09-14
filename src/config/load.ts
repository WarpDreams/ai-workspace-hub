import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";
import { ManifestSchema, type Manifest } from "./schema";

/** Default manifest filename, searched in the current dir then the home dir. */
export const DEFAULT_MANIFEST_NAME = ".awh.jsonc";

export class ManifestError extends Error {}

/**
 * Locate the manifest file.
 *
 * - If `explicit` (from -m/--manifest) is given, that exact path must exist;
 *   otherwise a ManifestError is thrown.
 * - Otherwise look for `.awh.jsonc` in the current working directory, then in
 *   the user's home directory. Returns undefined if neither exists.
 */
export function findManifest(explicit?: string): string | undefined {
  if (explicit) {
    const p = path.resolve(explicit);
    if (!fs.existsSync(p)) {
      throw new ManifestError(`Manifest file not found: ${p}`);
    }
    return p;
  }

  const candidates = [
    path.resolve(process.cwd(), DEFAULT_MANIFEST_NAME),
    path.join(os.homedir(), DEFAULT_MANIFEST_NAME),
  ];
  for (const p of candidates) {
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
      `No manifest found. Looked for ${DEFAULT_MANIFEST_NAME} in the current ` +
        `directory (${process.cwd()}) and in your home directory ` +
        `(${path.join(os.homedir(), DEFAULT_MANIFEST_NAME)}). ` +
        `Create one (copy a template from examples/) or pass --manifest <path>.`,
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
