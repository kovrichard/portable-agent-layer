/**
 * Whether the work here is committed, pushed and released, read fresh with every
 * prompt — so the agent answers from the checkout, not from what it remembers.
 */

import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { appendEvent, logQuietly } from "../../bronze/events";
import { isEnabled } from "../../core/settings";
import { mergedWorktrees } from "../../progress/merged-worktrees";
import { readAllProjects, resolveProjectFromCwd } from "../../progress/projects";

const GIT_TIMEOUT_MS = 1000;

export interface ChangedFile {
  path: string;
  state: "staged" | "unstaged" | "staged+unstaged" | "untracked" | "conflicted";
}

export interface Status {
  oid: string | null;
  head: string;
  hasCommits: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: ChangedFile[];
}

export type Git = (cwd: string, ...args: string[]) => string | null;

export const gitOutput: Git = (cwd, ...args) => {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
  });

  return result.status === 0 ? result.stdout.trim() : null;
};

function header(lines: string[], key: string): string | null {
  const line = lines.find((l) => l.startsWith(`# branch.${key} `));

  return line ? line.slice(`# branch.${key} `.length) : null;
}

const PATH_FIELD_INDEX: Record<string, number> = { "1": 8, "2": 9, u: 10 };

function stateOf(kind: string, xy: string): ChangedFile["state"] {
  if (kind === "?") return "untracked";

  if (kind === "u") return "conflicted";
  const [staged, unstaged] = [xy[0] !== ".", xy[1] !== "."];
  if (staged && unstaged) return "staged+unstaged";

  return staged ? "staged" : "unstaged";
}

function changedFile(line: string): ChangedFile {
  const fields = line.split(" ");
  const kind = fields[0];
  const pathIndex = PATH_FIELD_INDEX[kind] ?? 1;
  const path = fields.slice(pathIndex).join(" ").split("\t")[0];

  return { path, state: stateOf(kind, fields[1] ?? "") };
}

export function parseStatus(porcelain: string): Status {
  const lines = porcelain.split("\n").filter(Boolean);
  const [ahead, behind] = (header(lines, "ab") ?? "+0 -0")
    .split(" ")
    .map((n) => Math.abs(Number(n)));
  const files = lines.filter((l) => !l.startsWith("#")).map(changedFile);
  const oid = header(lines, "oid");

  return {
    oid: oid === "(initial)" ? null : oid,
    head: header(lines, "head") ?? "(detached)",
    hasCommits: oid !== "(initial)",
    upstream: header(lines, "upstream"),
    ahead,
    behind,
    files,
  };
}

export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function syncState(status: Status): string[] {
  if (!status.upstream) return ["never pushed"];
  const unsynced = [
    status.ahead > 0 ? `${count(status.ahead, "commit")} not pushed` : "",
    status.behind > 0
      ? `${count(status.behind, "commit")} behind ${status.upstream}`
      : "",
  ].filter(Boolean);

  return unsynced.length > 0 ? unsynced : ["pushed"];
}

function releaseState(cwd: string): string[] {
  const described = gitOutput(cwd, "describe", "--tags", "--long");
  const match = described ? /^(.*)-(\d+)-g[0-9a-f]+$/.exec(described) : null;
  if (!match) return [];
  const [, tag, since] = match;

  return Number(since) === 0
    ? [`at tag ${tag}`]
    : [`${count(Number(since), "commit")} since tag ${tag}`];
}

function mergedWorktreeState(cwd: string): string[] {
  const merged = mergedWorktrees(cwd).length;

  return merged > 0
    ? [`${count(merged, "merged worktree")}: pal cli worktree prune`]
    : [];
}

function workState(status: Status): string {
  if (!status.hasCommits) return "no commits yet";
  const changed = status.files.length;

  return changed > 0 ? `${count(changed, "file")} uncommitted` : "clean";
}

/** The head of the per-prompt Repo line: checkout, branch, work and sync state. */
export function repoStatusParts(toplevel: string, status: Status): string[] {
  return [
    `Repo: ${basename(toplevel)} on ${status.head}`,
    workState(status),
    ...syncState(status),
  ];
}

function readStatus(cwd: string): Status | null {
  const porcelain = gitOutput(cwd, "status", "--porcelain=v2", "--branch");

  return porcelain === null ? null : parseStatus(porcelain);
}

function gitLine(cwd: string, toplevel: string, status: Status): string {
  return [
    ...repoStatusParts(toplevel, status),
    ...releaseState(cwd),
    ...mergedWorktreeState(cwd),
  ].join(" · ");
}

function logRepoState(status: Status, session: string | null, cwd: string): void {
  logQuietly("repo_state", () =>
    appendEvent(
      "repo_state",
      {
        head: status.oid,
        branch: status.head,
        changed: status.files.length,
        ahead: status.ahead,
        behind: status.behind,
      },
      { session, cwd }
    )
  );
}

function unversionedProjectLine(cwd: string): string | null {
  const project = resolveProjectFromCwd(cwd, readAllProjects());
  if (!project) return null;

  return `Repo: ${project.name} is not under git — nothing in it is committed, pushed or released; the files on disk are its whole state`;
}

function repoLine(
  cwd: string,
  toplevel: string | null,
  status: Status | null
): string | null {
  if (!toplevel) return unversionedProjectLine(cwd);

  return status ? gitLine(cwd, toplevel, status) : null;
}

/** Records the commit this prompt starts from and returns the per-prompt Repo line. */
export function observeRepoState(
  cwd: string = process.cwd(),
  session: string | null = null
): string | null {
  const toplevel = gitOutput(cwd, "rev-parse", "--show-toplevel");
  const status = toplevel ? readStatus(cwd) : null;
  if (status) logRepoState(status, session, cwd);

  if (!isEnabled("repoState")) return null;
  const line = repoLine(cwd, toplevel, status);

  return line ? `<system-reminder>${line}</system-reminder>` : null;
}
