/**
 * New commits and branch switches land on the active work-tree node at the end
 * of a turn, so the tree knows what the work produced without being told.
 */

import { spawnSync } from "node:child_process";
import { workSession } from "./work-session";
import { appendEvent, readTree, scopeOf } from "./work-tree";

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

/** A scope with no work yet is left alone, so visiting a repo writes nothing. */
export function attachGitProgress(
  cwd: string,
  file?: string,
  now: Date = new Date(),
  session: string | undefined = workSession()
): void {
  const scope = scopeOf(cwd);
  const tree = readTree(scope, file, session);
  if (tree.nodes.size === 0) return;
  const current = snapshot(cwd);
  if (!current) return;
  const cursor = tree.gitCursor;
  if (cursor?.head === current.head && cursor.branch === current.branch) return;

  if (cursor && tree.active) {
    if (cursor.branch !== current.branch)
      appendEvent(
        scope,
        tree.active,
        "attach",
        { kind: "branch", ref: current.branch },
        file,
        now
      );
    for (const commit of ownCommitsSince(cwd, cursor.head, current.head, current.email))
      appendEvent(
        scope,
        tree.active,
        "attach",
        { kind: "commit", ref: commit.sha, label: commit.subject },
        file,
        now
      );
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
