/**
 * Paths whose contents the ledger notes the change of but never keeps.
 *
 * The floor below is fixed in code rather than configured: a denylist a user can
 * shrink is a suggestion, and settings may only add to this one. That direction
 * also makes a malformed user pattern harmless — the worst it can do is redact
 * something it did not need to.
 */

import { raw } from "./settings";

const ENV_TEMPLATE_SUFFIXES = [".sample", ".example", ".template", ".dist", ".defaults"];

/** Matched whole: `id_*` would catch `id_generator.ts`, `credentials*` a test file. */
const SECRET_FILENAMES = new Set([
  ".npmrc",
  ".netrc",
  "_netrc",
  ".pgpass",
  ".htpasswd",
  ".envrc",
  "credentials",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ecdsa_sk",
  "id_ed25519",
  "id_ed25519_sk",
]);

const SECRET_EXTENSIONS = [
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".keystore",
  ".jks",
  ".asc",
  ".gpg",
  ".kdbx",
];

const SECRET_DIRECTORIES = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".docker",
  ".kube",
  ".gcloud",
  ".azure",
]);

const SECRET_DIRECTORY_PAIRS = [
  [".config", "gh"],
  [".config", "gcloud"],
  [".local", "share/keyrings"],
];

function segmentsOf(path: string): string[] {
  return path.split(/[/\\]/).filter(Boolean);
}

function isLiveDotenv(name: string): boolean {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return !ENV_TEMPLATE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isSecretFilename(name: string): boolean {
  return SECRET_FILENAMES.has(name);
}

function hasSecretExtension(name: string): boolean {
  return SECRET_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

function inSecretDirectory(dirs: string[]): boolean {
  if (dirs.some((dir) => SECRET_DIRECTORIES.has(dir))) return true;
  return SECRET_DIRECTORY_PAIRS.some(([parent, child]) =>
    dirs.some(
      (dir, i) =>
        dir === parent &&
        dirs
          .slice(i + 1)
          .join("/")
          .startsWith(child)
    )
  );
}

function userPatterns(): string[] {
  const configured = raw().ledger?.redactPaths;
  if (!Array.isArray(configured)) return [];
  return configured.filter(
    (pattern) => typeof pattern === "string" && pattern.length > 0
  );
}

function matchesUserPattern(path: string, name: string): boolean {
  return userPatterns().some((pattern) => {
    const glob = new Bun.Glob(pattern);
    return glob.match(path) || glob.match(name);
  });
}

/** Should this file's contents be withheld from the ledger? */
export function isSensitivePath(path: string): boolean {
  const segments = segmentsOf(path);
  const name = segments.at(-1) ?? "";
  const dirs = segments.slice(0, -1);
  return (
    inSecretDirectory(dirs) ||
    isLiveDotenv(name) ||
    isSecretFilename(name) ||
    hasSecretExtension(name) ||
    matchesUserPattern(path, name)
  );
}
