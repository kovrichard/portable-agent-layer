import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent, readTree } from "../src/hooks/lib/progress-tree";
import { attachGitProgress } from "../src/hooks/lib/progress-tree-git";
import { settleAttachedPrs } from "../src/hooks/lib/progress-tree-prs";
import { cleanUpNodeWorktrees } from "../src/hooks/lib/progress-tree-worktrees";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

let root: string;
let repo: string;
let file: string;

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

function commit(dir: string, name: string): void {
  writeFileSync(resolve(dir, name), name);
  git(dir, "add", name);
  git(dir, "commit", "-qm", name);
}

beforeEach(() => {
  root = realpathSync(freshTestDir(import.meta.file));
  process.env.PAL_HOME = resolve(root, "pal");
  mkdirSync(resolve(root, "pal", "memory"), { recursive: true });
  const remote = resolve(root, "app.git");
  repo = resolve(root, "app");
  file = resolve(root, "events.jsonl");
  mkdirSync(remote);
  git(remote, "init", "-q", "--bare");
  mkdirSync(repo);
  git(repo, "init", "-q");
  commit(repo, "a");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");
});

function worktree(branch: string, pushed = true): string {
  const path = resolve(root, branch.replace("/", "-"));
  git(repo, "worktree", "add", "-q", "-b", branch, path, "origin/main");
  commit(path, `${branch.replace("/", "-")}.txt`);

  if (pushed) git(path, "push", "-q", "-u", "origin", branch);

  return path;
}

const node = (id = "n1") => readTree(repo, file).nodes.get(id);
const worktreeArtifacts = (id = "n1") =>
  node(id)
    ?.artifacts.filter((a) => a.kind === "worktree")
    .map((a) => [a.ref, a.label]);

function openNode(id = "n1"): void {
  appendEvent(repo, id, "open", { title: id, parent: null }, file);
}

describe("a worktree that appears during the work", () => {
  test("is attached to the active node with its branch", () => {
    openNode();
    attachGitProgress(repo, file);
    const path = worktree("feat/a");
    attachGitProgress(repo, file);

    expect(worktreeArtifacts()).toEqual([[path, "feat/a"]]);
  });

  test("is attached once, however many turns follow", () => {
    openNode();
    attachGitProgress(repo, file);
    worktree("feat/a");
    attachGitProgress(repo, file);
    attachGitProgress(repo, file);

    expect(worktreeArtifacts()).toHaveLength(1);
  });

  test("worktrees that existed before tracking began are attached to no node", () => {
    openNode();
    worktree("feat/old");
    appendEvent(
      repo,
      "",
      "git-cursor",
      { branch: "main", head: git(repo, "rev-parse", "HEAD") },
      file
    );
    attachGitProgress(repo, file);

    expect(worktreeArtifacts()).toEqual([]);
    expect(readTree(repo, file).gitCursor?.worktrees).toHaveLength(1);
  });

  test("with no active node it is only remembered", () => {
    openNode();
    attachGitProgress(repo, file);
    appendEvent(repo, "n1", "park", {}, file);
    worktree("feat/a");
    attachGitProgress(repo, file);

    expect(worktreeArtifacts()).toEqual([]);
    expect(readTree(repo, file).gitCursor?.worktrees).toHaveLength(1);
  });
});

describe("cleaning up a node's worktrees", () => {
  function attached(...paths: [string, string][]): void {
    openNode();

    for (const [path, branch] of paths)
      appendEvent(
        repo,
        "n1",
        "attach",
        { kind: "worktree", ref: path, label: branch },
        file
      );
  }

  test("removes the safe ones, keeps the branch, and names why each other one stays", () => {
    const safe = worktree("feat/safe");
    const dirty = worktree("feat/dirty");
    const local = worktree("feat/local", false);
    writeFileSync(resolve(dirty, "wip.txt"), "wip");
    attached([safe, "feat/safe"], [dirty, "feat/dirty"], [local, "feat/local"]);

    const cleanup = cleanUpNodeWorktrees(
      repo,
      node() as NonNullable<ReturnType<typeof node>>
    );

    expect(cleanup.removed).toEqual([{ path: safe, branch: "feat/safe" }]);
    expect(cleanup.kept).toEqual([
      { path: dirty, reason: "has uncommitted changes" },
      { path: local, reason: "has commits on no remote branch" },
    ]);
    expect(existsSync(safe)).toBe(false);
    expect(git(repo, "branch", "--list", "feat/safe")).toContain("feat/safe");
  });

  test("a worktree already removed is skipped silently", () => {
    const path = worktree("feat/gone");
    attached([path, "feat/gone"]);
    git(repo, "worktree", "remove", path);

    expect(
      cleanUpNodeWorktrees(repo, node() as NonNullable<ReturnType<typeof node>>)
    ).toEqual({
      removed: [],
      kept: [],
    });
  });

  test("limited to one branch, it leaves the others alone", () => {
    const a = worktree("feat/a");
    const b = worktree("feat/b");
    attached([a, "feat/a"], [b, "feat/b"]);

    const cleanup = cleanUpNodeWorktrees(
      repo,
      node() as NonNullable<ReturnType<typeof node>>,
      "feat/b"
    );

    expect(cleanup.removed.map((w) => w.branch)).toEqual(["feat/b"]);
    expect(existsSync(a)).toBe(true);
  });
});

describe("an attached PR that settles", () => {
  function prOnNode(path: string, branch: string): void {
    openNode();
    appendEvent(
      repo,
      "n1",
      "attach",
      { kind: "worktree", ref: path, label: branch },
      file
    );
    appendEvent(
      repo,
      "n1",
      "attach",
      { kind: "pr", ref: "https://example.test/pull/7" },
      file
    );
  }

  const gh = (state: "MERGED" | "CLOSED", branch: string) => () =>
    JSON.stringify({
      state,
      mergedAt: state === "MERGED" ? "2026-11-10T10:00:00Z" : null,
      closedAt: "2026-11-10T10:00:00Z",
      headRefName: branch,
    });

  test("merged, its branch's worktree is removed", () => {
    const path = worktree("feat/pr");
    prOnNode(path, "feat/pr");

    settleAttachedPrs(repo, repo, { file, gh: gh("MERGED", "feat/pr") });

    expect(existsSync(path)).toBe(false);
  });

  test("closed without merging, its worktree stays", () => {
    const path = worktree("feat/pr");
    prOnNode(path, "feat/pr");

    settleAttachedPrs(repo, repo, { file, gh: gh("CLOSED", "feat/pr") });

    expect(existsSync(path)).toBe(true);
  });
});
