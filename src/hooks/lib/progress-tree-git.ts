/**
 * New commits and branch switches land on the active progress-tree node at the end
 * of a turn, so the tree knows what the work produced without being told.
 */

import { spawnSync } from "node:child_process";
import { progressSession } from "./progress-session";
import { appendEvent, readTree, scopeOf } from "./progress-tree";
import { openSessionNode } from "./progress-tree-session-node";

const GIT_TIMEOUT_MS = 1000;
const MAX_COMMITS = 20;

interface GitSnapshot {
  branch: string;
  head: string;
  email: string;
}

interface Commit {
  sha: string;
  subject: string;
}

function git(cwd: string, ...args: string[]): string | null {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function snapshot(cwd: string): GitSnapshot | null {
  const head = git(cwd, "rev-parse", "HEAD");
  const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  if (!head || !branch) return null;
  return { head, branch, email: git(cwd, "config", "user.email") ?? "" };
}

/** Only the user's own commits: a pull brings other people's work, which this turn did not make. */
function ownCommitsSince(cwd: string, from: string, to: string, email: string): Commit[] {
  const log = git(
    cwd,
    "log",
    `-${MAX_COMMITS}`,
    "--format=%h%x09%ae%x09%s",
    `${from}..${to}`
  );
  if (!log) return [];
  return log
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([, author]) => author === email)
    .map(([sha, , subject]) => ({ sha, subject }))
    .reverse();
}

interface GitMoves {
  scope: string;
  node: string;
  branch: string | null;
  commits: Commit[];
  file?: string;
  now: Date;
}

function attachMoves({ scope, node, branch, commits, file, now }: GitMoves): void {
  if (branch)
    appendEvent(scope, node, "attach", { kind: "branch", ref: branch }, file, now);
  for (const commit of commits)
    appendEvent(
      scope,
      node,
      "attach",
      { kind: "commit", ref: commit.sha, label: commit.subject },
      file,
      now
    );
}

/** A scope with no work yet is left alone, so visiting a repo writes nothing; a commit made from the root opens the session's node. */
export function attachGitProgress(
  cwd: string,
  file?: string,
  now: Date = new Date(),
  session: string | undefined = progressSession()
): void {
  const scope = scopeOf(cwd);
  const tree = readTree(scope, file, session);
  if (tree.nodes.size === 0) return;
  const current = snapshot(cwd);
  if (!current) return;
  const cursor = tree.gitCursor;
  if (cursor?.head === current.head && cursor.branch === current.branch) return;

  if (cursor) {
    const branch = cursor.branch !== current.branch ? current.branch : null;
    const commits = ownCommitsSince(cwd, cursor.head, current.head, current.email);
    const node =
      tree.active ??
      (commits.length > 0 ? openSessionNode(scope, session, file, now) : null);
    if (node) attachMoves({ scope, node, branch, commits, file, now });
  }
  appendEvent(
    scope,
    "",
    "git-cursor",
    { branch: current.branch, head: current.head },
    file,
    now
  );
}
