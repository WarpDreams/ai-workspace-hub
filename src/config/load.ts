import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";
import { ManifestSchema, type Manifest } from "./schema";
import { configureContent } from "../core/content";
import { absPathFrom } from "../util/paths";

/** Default manifest filename, searched in the current dir then the home dir. */
export const DEFAULT_MANIFEST_NAME = ".awh.jsonc";
/** Env var naming the manifest to use when -m is not given. */
export const MANIFEST_ENV = "AWH_MANIFEST";

export class ManifestError extends Error {}

/**
 * Locate the manifest file.
 *
 * - If `explicit` (from -m/--manifest) or $AWH_MANIFEST is given, that exact
 *   path must exist; otherwise a ManifestError is thrown.
 * - Otherwise look for `.awh.jsonc` in the current working directory, then in
 *   the user's home directory. Returns undefined if neither exists.
 */
export function findManifest(explicit?: string): string | undefined {
  const named = explicit ?? (process.env[MANIFEST_ENV]?.trim() || undefined);
  if (named) {
    const p = absPathFrom(process.cwd(), named);
    if (!fs.existsSync(p)) {
      throw new ManifestError(`Manifest file not found: ${p}${explicit ? "" : ` (from $${MANIFEST_ENV})`}`);
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
  /** Directory of the real manifest file. */
  base: string;
  /** Absolute content search paths, in manifest order. */
  searchPaths: string[];
}

/**
 * Resolve content search paths. Relative paths (and the default ".") are
 * taken from the directory of the REAL manifest file, so ~/.awh.jsonc may be a
 * symlink into a content repo and "." means that repo.
 */
export function searchPathsFor(manifestPath: string, manifest: Manifest): { base: string; searchPaths: string[] } {
  let real = manifestPath;
  try {
    real = fs.realpathSync(manifestPath);
  } catch {
    // keep the given path
  }
  const base = path.dirname(real);
  return { base, searchPaths: manifest.content_search_paths.map((p) => absPathFrom(base, p)) };
}

export function loadManifest(explicit?: string): LoadedManifest {
  const file = findManifest(explicit);
  if (!file) {
    throw new ManifestError(
      `No manifest found. Looked for ${DEFAULT_MANIFEST_NAME} in the current ` +
        `directory (${process.cwd()}) and in your home directory ` +
        `(${path.join(os.homedir(), DEFAULT_MANIFEST_NAME)}), and $${MANIFEST_ENV} is not set. ` +
        `Point ~/.awh.jsonc (or --manifest) at the .awh.jsonc in your content repo.`,
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

  const { base, searchPaths } = searchPathsFor(file, result.data);
  configureContent(base, searchPaths);
  return { path: file, manifest: result.data, base, searchPaths };
}
