/**
 * Which checkout a shell command's git call ran in. The command often names it
 * through a variable (`cd "$W"`), so a commit is traced by the worktree whose
 * HEAD appeared during the call before the command text is parsed at all.
 */

import { toPath } from "./paths";
import type { Git } from "./repo-state";

const COMMAND_START = String.raw`(?:^|[;&|(\s])`;
const GIT_GLOBAL_OPTIONS = String.raw`(?:\s+-[Cc]\s+\S+|\s+--[\w-]+(?:=\S+)?)*`;
const GIT_CALL = new RegExp(String.raw`${COMMAND_START}git(?:\s|$)`);
const GIT_COMMIT = new RegExp(
  String.raw`${COMMAND_START}git${GIT_GLOBAL_OPTIONS}\s+commit(?![\w-])`
);
const QUOTED_OR_BARE = String.raw`(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))`;
const GIT_DASH_C_DIR = new RegExp(
  String.raw`${COMMAND_START}git\s+-C\s+${QUOTED_OR_BARE}`
);
const CD_DIR = new RegExp(String.raw`${COMMAND_START}cd\s+${QUOTED_OR_BARE}`);
const MAX_WORKTREES = 30;
const COMMIT_TIME_SLACK_MS = 1000;

type RepoSource = "worktree" | "literal" | "cwd";

export interface RepoChoice {
  toplevel: string;
  source: RepoSource;
}

export const runsGit = (command: string) => GIT_CALL.test(command);

export const runsGitCommit = (command: string) => GIT_COMMIT.test(command);

function isLiteralPath(dir: string): boolean {
  return !/[$`*?]/.test(dir);
}

function firstLiteralDir(command: string, pattern: RegExp): string | null {
  const match = pattern.exec(command);
  const dir = match ? (match[1] ?? match[2] ?? match[3]) : null;

  return dir && isLiteralPath(dir) ? dir : null;
}

/** The directory a literal `git -C <dir>` or `cd <dir>` names, resolved against cwd. */
export function literalCommandDir(command: string, cwd: string): string | null {
  const dir =
    firstLiteralDir(command, GIT_DASH_C_DIR) ?? firstLiteralDir(command, CD_DIR);
  if (!dir) return null;

  try {
    return toPath(dir, cwd);
  } catch {
    return null;
  }
}

export function worktreePaths(porcelain: string): string[] {
  return Array.from(porcelain.matchAll(/^worktree (.+)$/gm), (m) => m[1]).slice(
    0,
    MAX_WORKTREES
  );
}

function headCommitMs(git: Git, path: string): number | null {
  const seconds = Number(git(path, "log", "-1", "--format=%ct", "HEAD"));

  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** The session repo's worktree whose HEAD commit is no older than the tool call. */
function worktreeCommittedSince(
  git: Git,
  cwd: string,
  startedAtMs: number
): string | null {
  const paths = worktreePaths(git(cwd, "worktree", "list", "--porcelain") ?? "");
  const fresh = paths
    .map((path) => ({ path, at: headCommitMs(git, path) }))
    .filter(({ at }) => at !== null && at >= startedAtMs - COMMIT_TIME_SLACK_MS)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  return fresh[0]?.path ?? null;
}

function candidateDirs(
  git: Git,
  command: string,
  cwd: string,
  startedAtMs: number
): [RepoSource, string | null][] {
  return [
    [
      "worktree",
      runsGitCommit(command) ? worktreeCommittedSince(git, cwd, startedAtMs) : null,
    ],
    ["literal", literalCommandDir(command, cwd)],
    ["cwd", cwd],
  ];
}

export function chooseRepo(
  git: Git,
  command: string,
  cwd: string,
  startedAtMs: number
): RepoChoice | null {
  for (const [source, dir] of candidateDirs(git, command, cwd, startedAtMs)) {
    const toplevel = dir ? git(dir, "rev-parse", "--show-toplevel") : null;
    if (toplevel) return { toplevel, source };
  }

  return null;
}
