/**
 * A worktree belongs to the node whose session worked in it. A node's worktree
 * is removed when its PR merges or the node is done, but only when removing it
 * loses nothing the remote lacks and no other unfinished node holds it; the
 * branch always stays.
 */

import { resolve, sep } from "node:path";
import {
  linkedWorktrees,
  type MergedWorktree,
  removalBlocker,
  removeWorktree,
} from "./merged-worktrees";
import { attachOnce, buildTree, readEvents, type WorkNode } from "./progress-tree";

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

function worktreeHolding(cwd: string, shellCwd: string): MergedWorktree | undefined {
  const shell = resolve(shellCwd);

  return linkedWorktrees(cwd).find(
    (w) => shell === w.path || shell.startsWith(`${w.path}${sep}`)
  );
}

/**
 * Attaches the worktree the shell stands in to the active node. A worktree
 * that merely appeared in the repository may be another session's, so
 * appearing is not enough.
 */
export function attachShellWorktree(
  cwd: string,
  shellCwd: string,
  attachTo: { scope: string; node: WorkNode; file?: string; now: Date }
): void {
  const worktree = worktreeHolding(cwd, shellCwd);
  if (!worktree) return;
  const { scope, node, file, now } = attachTo;
  attachOnce(
    scope,
    node,
    { kind: "worktree", ref: worktree.path, label: worktree.branch },
    file,
    now
  );
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

/** Every node not done, in any scope, other than `node`. */
function unfinishedNodesBesides(node: WorkNode, file?: string): WorkNode[] {
  const events = readEvents(file);
  const scopes = new Set(events.map((event) => event.scope));

  return [...scopes]
    .flatMap((scope) => [...buildTree(scope, events).nodes.values()])
    .filter((other) => other.status !== "done" && other.id !== node.id);
}

function holds(node: WorkNode, worktree: MergedWorktree): boolean {
  return node.artifacts.some(
    (a) =>
      (a.kind === "worktree" &&
        (resolve(a.ref) === resolve(worktree.path) || a.label === worktree.branch)) ||
      (a.kind === "branch" && a.ref === worktree.branch)
  );
}

function heldElsewhere(worktree: MergedWorktree, others: WorkNode[]): string | null {
  const holder = others.find((other) => holds(other, worktree));

  return holder ? `is held by ${holder.title} [${holder.id}]` : null;
}

export function cleanUpNodeWorktrees(
  cwd: string,
  node: WorkNode,
  onlyBranch?: string,
  file?: string
): WorktreeCleanup {
  const cleanup: WorktreeCleanup = { removed: [], kept: [] };
  const others = unfinishedNodesBesides(node, file);

  for (const worktree of nodeWorktrees(node, onlyBranch)) {
    if (!stillListed(cwd, worktree)) continue;
    const reason =
      heldElsewhere(worktree, others) ??
      removalBlocker(cwd, worktree) ??
      removeWorktree(cwd, worktree);
    if (reason) cleanup.kept.push({ path: worktree.path, reason });
    else cleanup.removed.push(worktree);
  }

  return cleanup;
}
