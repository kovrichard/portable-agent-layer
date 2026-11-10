import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

let ROOT: string;

beforeEach(async () => {
  ROOT = realpathSync(freshTestDir(import.meta.file));
  process.env.PAL_HOME = resolve(ROOT, "pal");
  mkdirSync(resolve(ROOT, "pal", "memory"), { recursive: true });
  (await import("../src/hooks/lib/settings")).reload();
});

function git(dir: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd: dir, encoding: "utf-8" }
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(dir: string, file: string): void {
  writeFileSync(resolve(dir, file), file);
  git(dir, "add", file);
  git(dir, "commit", "-qm", file);
}

function checkout(): string {
  const remote = resolve(ROOT, "app.git");
  const dir = resolve(ROOT, "app");
  mkdirSync(remote);
  git(remote, "init", "-q", "--bare");
  mkdirSync(dir);
  git(dir, "init", "-q");
  commit(dir, "a");
  git(dir, "remote", "add", "origin", remote);
  git(dir, "push", "-q", "-u", "origin", "main");
  return dir;
}

function pushedWorktree(dir: string, branch: string): string {
  const path = resolve(ROOT, branch.replace("/", "-"));
  git(dir, "worktree", "add", "-q", "-b", branch, path, "origin/main");
  commit(path, `${branch.replace("/", "-")}.txt`);
  git(path, "push", "-q", "-u", "origin", branch);
  return path;
}

function mergeAndDeleteOnRemote(dir: string, branch: string): void {
  git(dir, "merge", "-q", "--no-ff", "-m", `merge ${branch}`, branch);
  git(dir, "push", "-q", "origin", "main");
  git(dir, "push", "-q", "origin", "--delete", branch);
  git(dir, "fetch", "-q", "--prune");
}

function withGitThatOnRemove<T>(action: string, run: () => T): T {
  const bin = resolve(ROOT, "fake-git");
  mkdirSync(bin);
  const realGit = Bun.which("git") as string;
  writeFileSync(
    resolve(bin, "git"),
    `#!/bin/sh\ncase "$*" in *"worktree remove"*) ${action};; esac\nexec "${realGit}" "$@"\n`,
    { mode: 0o755 }
  );
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${savedPath}`;
  try {
    return run();
  } finally {
    process.env.PATH = savedPath;
  }
}

async function lib() {
  return import("../src/hooks/lib/merged-worktrees");
}

function prunedEvents(): Record<string, unknown>[] {
  const dir = resolve(ROOT, "pal", "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").split("\n"))
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "worktree_pruned");
}

describe("a worktree whose branch was merged and deleted on the remote", () => {
  test("is listed, and prune removes it but keeps the branch", async () => {
    const dir = checkout();
    const path = pushedWorktree(dir, "feat/done");
    mergeAndDeleteOnRemote(dir, "feat/done");
    const { mergedWorktrees, pruneMergedWorktrees } = await lib();

    expect(mergedWorktrees(dir)).toEqual([{ path, branch: "feat/done" }]);
    expect(pruneMergedWorktrees(dir)).toEqual({
      removed: [{ path, branch: "feat/done" }],
      failed: [],
    });
    expect(existsSync(path)).toBe(false);
    expect(git(dir, "branch", "--list", "feat/done")).toContain("feat/done");
    expect(prunedEvents()).toEqual([
      expect.objectContaining({ branch: "feat/done", cwd: dir }),
    ]);
  });

  test("a second prune removes and logs nothing", async () => {
    const dir = checkout();
    pushedWorktree(dir, "feat/done");
    mergeAndDeleteOnRemote(dir, "feat/done");
    const { pruneMergedWorktrees } = await lib();

    pruneMergedWorktrees(dir);
    expect(pruneMergedWorktrees(dir)).toEqual({ removed: [], failed: [] });
    expect(prunedEvents()).toHaveLength(1);
  });

  test.skipIf(process.platform === "win32")(
    "a removal that takes longer than a second still finishes",
    async () => {
      const dir = checkout();
      const path = pushedWorktree(dir, "feat/done");
      mergeAndDeleteOnRemote(dir, "feat/done");
      const { pruneMergedWorktrees } = await lib();

      const { removed } = withGitThatOnRemove("sleep 1.5", () =>
        pruneMergedWorktrees(dir)
      );
      expect(removed).toEqual([{ path, branch: "feat/done" }]);
      expect(existsSync(path)).toBe(false);
    }
  );

  test.skipIf(process.platform === "win32")(
    "a git stopped by a signal is reported as such",
    async () => {
      const dir = checkout();
      const path = pushedWorktree(dir, "feat/done");
      mergeAndDeleteOnRemote(dir, "feat/done");
      const { pruneMergedWorktrees } = await lib();

      expect(
        withGitThatOnRemove("kill -TERM $$", () => pruneMergedWorktrees(dir))
      ).toEqual({
        removed: [],
        failed: [{ path, branch: "feat/done", reason: "git was stopped by SIGTERM" }],
      });
    }
  );

  test("a removal git refuses is reported with git's reason, and the worktree stays", async () => {
    const dir = checkout();
    const path = pushedWorktree(dir, "feat/done");
    mergeAndDeleteOnRemote(dir, "feat/done");
    git(dir, "worktree", "lock", path);

    expect((await lib()).pruneMergedWorktrees(dir)).toEqual({
      removed: [],
      failed: [{ path, branch: "feat/done", reason: expect.stringContaining("locked") }],
    });
    expect(existsSync(path)).toBe(true);
    expect(prunedEvents()).toEqual([]);
  });

  test("pal cli worktree prune names a removal git refused and exits 1", () => {
    const dir = checkout();
    const path = pushedWorktree(dir, "feat/done");
    mergeAndDeleteOnRemote(dir, "feat/done");
    git(dir, "worktree", "lock", path);
    const cli = resolve(import.meta.dir, "..", "src", "cli", "index.ts");

    const result = spawnSync("bun", [cli, "cli", "worktree", "prune"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Could not remove ${path}`);
    expect(result.stderr).toContain("locked");
    expect(result.stdout).not.toContain("No merged worktrees");
  });

  test("is kept while it has uncommitted changes", async () => {
    const dir = checkout();
    const path = pushedWorktree(dir, "feat/done");
    mergeAndDeleteOnRemote(dir, "feat/done");
    writeFileSync(resolve(path, "wip.txt"), "wip");

    expect((await lib()).mergedWorktrees(dir)).toEqual([]);
  });

  test("is kept when a commit on it reached no remote branch", async () => {
    const dir = checkout();
    const path = pushedWorktree(dir, "feat/done");
    mergeAndDeleteOnRemote(dir, "feat/done");
    commit(path, "late.txt");

    expect((await lib()).mergedWorktrees(dir)).toEqual([]);
  });
});

describe("a worktree that is not finished", () => {
  test("a pushed branch still on the remote is kept", async () => {
    const dir = checkout();
    pushedWorktree(dir, "feat/open");

    expect((await lib()).mergedWorktrees(dir)).toEqual([]);
  });

  test("the worktree prune is asked from is kept", async () => {
    const dir = checkout();
    const path = pushedWorktree(dir, "feat/done");
    mergeAndDeleteOnRemote(dir, "feat/done");

    expect((await lib()).mergedWorktrees(path)).toEqual([]);
  });
});

describe("the repo line", () => {
  test("names merged worktrees and the command that prunes them", async () => {
    const dir = checkout();
    pushedWorktree(dir, "feat/done");
    mergeAndDeleteOnRemote(dir, "feat/done");
    const { getRepoStateReminder } = await import("../src/hooks/lib/repo-state");

    expect(getRepoStateReminder(dir)).toContain(
      "1 merged worktree: pal cli worktree prune"
    );
  });

  test("says nothing about worktrees when none is merged", async () => {
    const dir = checkout();
    pushedWorktree(dir, "feat/open");
    const { getRepoStateReminder } = await import("../src/hooks/lib/repo-state");

    expect(getRepoStateReminder(dir)).not.toContain("worktree");
  });
});
