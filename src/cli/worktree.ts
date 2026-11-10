/**
 * pal cli worktree — remove the worktrees of this repo whose branch is merged
 * and deleted on the remote. The branch stays, so each removal can be undone.
 */

import { spawnSync } from "node:child_process";
import {
  type FailedRemoval,
  type MergedWorktree,
  mergedWorktrees,
  pruneMergedWorktrees,
} from "../hooks/lib/merged-worktrees";
import { log } from "../targets/lib";
import { group, leaf } from "../tools/lib/command";

function forgetBranchesDeletedOnRemote(cwd: string): void {
  spawnSync("git", ["-C", cwd, "fetch", "--prune", "--quiet"], { encoding: "utf-8" });
}

function report(worktrees: MergedWorktree[], verb: string): void {
  if (worktrees.length === 0) {
    log.info("No merged worktrees.");
    return;
  }
  for (const { path, branch } of worktrees) {
    console.log(`${verb} ${path} (${branch}); undo: git worktree add ${path} ${branch}`);
  }
}

function reportFailures(failed: FailedRemoval[]): void {
  for (const { path, reason } of failed) log.error(`Could not remove ${path}: ${reason}`);
}

function prune(dryRun: boolean): number {
  const cwd = process.cwd();
  forgetBranchesDeletedOnRemote(cwd);
  if (dryRun) {
    report(mergedWorktrees(cwd), "Would remove");
    return 0;
  }
  const { removed, failed } = pruneMergedWorktrees(cwd);
  if (removed.length > 0 || failed.length === 0) report(removed, "Removed");
  reportFailures(failed);
  return failed.length === 0 ? 0 : 1;
}

export const worktreeCommand = group({
  summary: "Clean up this repo's git worktrees",
  commands: {
    prune: leaf({
      summary:
        "Remove clean worktrees whose branch is merged and deleted on the remote; branches stay",
      options: {
        "dry-run": { type: "boolean", description: "List them without removing" },
      },
      run: ({ values }) => prune(Boolean(values["dry-run"])),
    }),
  },
});
