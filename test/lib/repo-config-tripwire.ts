import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function gitDirAbove(from: string): string | null {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const dotGit = resolve(dir, ".git");
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return dotGit;
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf-8"))?.[1];

      return pointer ? resolve(dir, pointer.trim()) : null;
    }

    if (dirname(dir) === dir) return null;
  }
}

function commonDirOf(gitDir: string): string {
  const commondir = resolve(gitDir, "commondir");
  if (!existsSync(commondir)) return gitDir;

  return resolve(gitDir, readFileSync(commondir, "utf-8").trim());
}

/**
 * The config every worktree of this checkout shares, or null outside a git checkout.
 * Read from disk: this runs in the preload of every test file, where spawning git
 * left a worker spinning in Bun.spawnSync now and then.
 */
export function sharedRepoConfig(from: string): string | null {
  const gitDir = gitDirAbove(from);
  if (!gitDir) return null;
  const config = resolve(commonDirOf(gitDir), "config");

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
