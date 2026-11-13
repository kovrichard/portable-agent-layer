/**
 * Worktrees belong to the node that was active when they appeared. A node's
 * worktree is removed when its PR merges or the node is done, but only when
 * removing it loses nothing the remote lacks; the branch always stays.
 */

import {
  linkedWorktrees,
  type MergedWorktree,
  removalBlocker,
  removeWorktree,
} from "./merged-worktrees";
import { appendEvent, type WorkNode } from "./progress-tree";

interface KeptWorktree {
  path: string;
  reason: string;
}

export interface WorktreeCleanup {
  removed: MergedWorktree[];
  kept: KeptWorktree[];
}

export function worktreePaths(cwd: string): string[] {
  return linkedWorktrees(cwd).map((w) => w.path);
}

/** Attaches the worktrees that appeared since `known` and returns every current path. */
export function attachNewWorktrees(
  cwd: string,
  known: string[] | undefined,
  attachTo: { scope: string; node: string | null; file?: string; now: Date }
): string[] {
  const current = linkedWorktrees(cwd);
  const { scope, node, file, now } = attachTo;
  if (known && node) {
    const seen = new Set(known);

    for (const { path, branch } of current.filter((w) => !seen.has(w.path)))
      appendEvent(
        scope,
        node,
        "attach",
        { kind: "worktree", ref: path, label: branch },
        file,
        now
      );
  }

  return current.map((w) => w.path);
}

function nodeWorktrees(node: WorkNode, onlyBranch?: string): MergedWorktree[] {
  return node.artifacts
    .filter((a) => a.kind === "worktree" && a.label)
    .map((a) => ({ path: a.ref, branch: a.label as string }))
    .filter((w) => onlyBranch === undefined || w.branch === onlyBranch);
}

function stillListed(cwd: string, worktree: MergedWorktree): boolean {
  return worktreePaths(cwd).includes(worktree.path);
}

export function cleanUpNodeWorktrees(
  cwd: string,
  node: WorkNode,
  onlyBranch?: string
): WorktreeCleanup {
  const cleanup: WorktreeCleanup = { removed: [], kept: [] };

  for (const worktree of nodeWorktrees(node, onlyBranch)) {
    if (!stillListed(cwd, worktree)) continue;
    const reason = removalBlocker(cwd, worktree) ?? removeWorktree(cwd, worktree);
    if (reason) cleanup.kept.push({ path: worktree.path, reason });
    else cleanup.removed.push(worktree);
  }

  return cleanup;
}
