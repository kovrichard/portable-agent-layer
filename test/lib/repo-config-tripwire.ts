import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** The config every worktree of this checkout shares, or null outside a git checkout. */
export function sharedRepoConfig(from: string): string | null {
  const result = Bun.spawnSync(
    ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
    {
      cwd: from,
    }
  );
  if (result.exitCode !== 0) return null;
  const config = resolve(result.stdout.toString().trim(), "config");
  return existsSync(config) ? config : null;
}

/** Returns a check that restores the file and names the change when anything rewrote it. */
export function guardFile(path: string): () => string | null {
  const original = readFileSync(path, "utf-8");
  return () => {
    const now = readFileSync(path, "utf-8");
    if (now === original) return null;
    writeFileSync(path, original);
    return `The test that ran before this point changed the real repository's ${path}; it was restored. Run git inside a fixture repo under .test/.`;
  };
}
