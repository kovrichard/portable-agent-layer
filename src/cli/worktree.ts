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
import { log } from "../targets/log";
import { group, leaf } from "../tools/lib/command";

function forgetBranchesDeletedOnRemote(cwd: string): void {
  spawnSync("git", ["-C", cwd, "fetch", "--prune", "--quiet"], { encoding: "utf-8" });
}

function report(verb: string, worktrees: MergedWorktree[], failed: FailedRemoval[] = []) {
  if (worktrees.length === 0 && failed.length === 0) log.info("No merged worktrees.");
  for (const { path, branch } of worktrees) {
    console.log(`${verb} ${path} (${branch}); undo: git worktree add ${path} ${branch}`);
  }
  for (const { path, reason } of failed) log.error(`Could not remove ${path}: ${reason}`);
  return failed.length === 0 ? 0 : 1;
}

export function prune(cwd: string, dryRun: boolean): number {
  forgetBranchesDeletedOnRemote(cwd);
  if (dryRun) return report("Would remove", mergedWorktrees(cwd));
  const { removed, failed } = pruneMergedWorktrees(cwd);
  return report("Removed", removed, failed);
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
      run: ({ values }) => prune(process.cwd(), Boolean(values["dry-run"])),
    }),
  },
});
