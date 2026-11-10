/**
 * Worktrees whose branch is finished: merged and deleted on the remote, with
 * nothing left in them that the remote lacks.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
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

export function linkedWorktrees(cwd: string): MergedWorktree[] {
  const blocks = (git(cwd, "worktree", "list", "--porcelain") ?? "").split("\n\n");
  return blocks.slice(1).flatMap((block) => {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    return path && branch ? [{ path: resolve(path), branch }] : [];
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

/** Why a worktree must stay, or null when removing it loses nothing the remote lacks. */
export function removalBlocker(
  cwd: string,
  { path, branch }: MergedWorktree
): string | null {
  const here = git(cwd, "rev-parse", "--show-toplevel");
  if (!here || !existsSync(path)) return "is not on disk";
  if (samePath(path, here)) return "is the checkout this runs from";
  if (!isClean(path)) return "has uncommitted changes";
  if (!reachedARemoteBranch(cwd, branch)) return "has commits on no remote branch";
  return null;
}

export function mergedWorktrees(cwd: string): MergedWorktree[] {
  const gone = branchesGoneOnRemote(cwd);
  return linkedWorktrees(cwd).filter(
    (worktree) => gone.has(worktree.branch) && removalBlocker(cwd, worktree) === null
  );
}

function gitRefusal(result: ReturnType<typeof spawnSync>): string | null {
  if (result.status === 0) return null;
  if (result.signal) return `git was stopped by ${result.signal}`;
  return String(result.stderr).trim() || `git exited with ${result.status}`;
}

/** Why git did not remove the worktree, or null once it is removed. */
export function removeWorktree(
  cwd: string,
  { path, branch }: MergedWorktree
): string | null {
  const refusal = gitRefusal(spawnSync("git", ["-C", cwd, "worktree", "remove", path]));
  if (refusal === null)
    appendEvent("worktree_pruned", { branch }, { cwd, content: { path, branch } });
  return refusal;
}

export interface FailedRemoval extends MergedWorktree {
  reason: string;
}

export interface PruneResult {
  removed: MergedWorktree[];
  failed: FailedRemoval[];
}

export function pruneMergedWorktrees(cwd: string): PruneResult {
  const result: PruneResult = { removed: [], failed: [] };
  for (const worktree of mergedWorktrees(cwd)) {
    const reason = removeWorktree(cwd, worktree);
    if (reason === null) result.removed.push(worktree);
    else result.failed.push({ ...worktree, reason });
  }
  return result;
}
