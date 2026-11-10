/**
 * Worktrees whose branch is finished: merged and deleted on the remote, with
 * nothing left in them that the remote lacks.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { appendEvent } from "./events";

const GIT_TIMEOUT_MS = 1000;

export interface MergedWorktree {
  path: string;
  branch: string;
}

function git(cwd: string, ...args: string[]): string | null {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function linkedWorktrees(cwd: string): MergedWorktree[] {
  const blocks = (git(cwd, "worktree", "list", "--porcelain") ?? "").split("\n\n");
  return blocks.slice(1).flatMap((block) => {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    return path && branch ? [{ path, branch }] : [];
  });
}

function branchesGoneOnRemote(cwd: string): Set<string> {
  const refs = git(
    cwd,
    "for-each-ref",
    "--format=%(refname:short)\t%(upstream:track)",
    "refs/heads"
  );
  return new Set(
    (refs ?? "")
      .split("\n")
      .filter((line) => line.endsWith("\t[gone]"))
      .map((line) => line.split("\t")[0])
  );
}

function isClean(path: string): boolean {
  return git(path, "status", "--porcelain") === "";
}

function reachedARemoteBranch(cwd: string, branch: string): boolean {
  return Boolean(git(cwd, "branch", "-r", "--contains", branch));
}

function samePath(a: string, b: string): boolean {
  return realpathSync(a) === realpathSync(b);
}

export function mergedWorktrees(cwd: string): MergedWorktree[] {
  const here = git(cwd, "rev-parse", "--show-toplevel");
  if (!here) return [];
  const gone = branchesGoneOnRemote(cwd);
  return linkedWorktrees(cwd).filter(
    ({ path, branch }) =>
      gone.has(branch) &&
      existsSync(path) &&
      !samePath(path, here) &&
      isClean(path) &&
      reachedARemoteBranch(cwd, branch)
  );
}

export function pruneMergedWorktrees(cwd: string): MergedWorktree[] {
  return mergedWorktrees(cwd).filter(({ path, branch }) => {
    if (git(cwd, "worktree", "remove", path) === null) return false;
    appendEvent("worktree_pruned", { branch }, { cwd, content: { path, branch } });
    return true;
  });
}
