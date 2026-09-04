/**
 * `biome check --write`, plus the one thing biome does not report: which files
 * it rewrote.
 *
 * A formatter that edits files silently invalidates whatever an agent had
 * planned against them. The next exact-text edit fails on a stale snippet — or,
 * through the shell, matches nothing and still reports success. Biome prints a
 * count ("Fixed 3 files") and no names, so the agent cannot tell whether the
 * file it is about to edit is one of them.
 *
 * Naming them turns "re-read before editing" from something to remember into
 * something the output already told you.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Everything biome may rewrite: tracked files, plus new ones not yet committed. */
export function repoFiles(): string[] {
  const list = (args: string[]) =>
    spawnSync("git", args, { encoding: "utf-8" }).stdout.split("\n").filter(Boolean);
  return [...list(["ls-files"]), ...list(["ls-files", "--others", "--exclude-standard"])];
}

/**
 * Content hashes, not timestamps: a rewrite that produced identical bytes would
 * still move an mtime, and an output that cried wolf would be worth less than
 * no output at all.
 */
export function fingerprint(files: string[]): Map<string, string> {
  const prints = new Map<string, string>();
  for (const file of files) {
    try {
      prints.set(file, Bun.hash(readFileSync(file)).toString(36));
    } catch {
      // Unreadable or vanished between listing and hashing; it is not a rewrite.
    }
  }
  return prints;
}

export function rewrittenBetween(
  files: string[],
  before: Map<string, string>,
  after: Map<string, string>
): string[] {
  return files.filter((file) => before.get(file) !== after.get(file));
}

export function report(rewritten: string[]): string {
  if (rewritten.length === 0) {
    return "\nNo files were rewritten — anything you already read is still current.";
  }
  const header = `\nRewritten by the formatter (${rewritten.length}) — re-read before editing:`;
  return [header, ...rewritten.map((file) => `  ${file}`)].join("\n");
}

if (import.meta.main) {
  const files = repoFiles();
  const before = fingerprint(files);
  const result = spawnSync("bunx", ["biome", "check", "--write"], { stdio: "inherit" });
  const after = fingerprint(files);

  console.log(report(rewrittenBetween(files, before, after)));
  process.exit(result.status ?? 0);
}
