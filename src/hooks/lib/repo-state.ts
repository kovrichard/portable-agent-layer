/**
 * Whether the work here is committed, pushed and released, read fresh with every
 * prompt — so the agent answers from the checkout, not from what it remembers.
 */

import { basename } from "node:path";
import { readAllProjects, resolveProjectFromCwd } from "./projects";
import { isEnabled } from "./settings";
import { spawnInCurrentEnv } from "./spawn";

const GIT_TIMEOUT_MS = 1000;

interface Status {
  head: string;
  hasCommits: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  changed: number;
}

function git(cwd: string, ...args: string[]): string | null {
  try {
    const result = spawnInCurrentEnv(["git", "-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
    });
    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

function header(lines: string[], key: string): string | null {
  const line = lines.find((l) => l.startsWith(`# branch.${key} `));
  return line ? line.slice(`# branch.${key} `.length) : null;
}

function parseStatus(porcelain: string): Status {
  const lines = porcelain.split("\n").filter(Boolean);
  const [ahead, behind] = (header(lines, "ab") ?? "+0 -0")
    .split(" ")
    .map((n) => Math.abs(Number(n)));
  return {
    head: header(lines, "head") ?? "(detached)",
    hasCommits: header(lines, "oid") !== "(initial)",
    upstream: header(lines, "upstream"),
    ahead,
    behind,
    changed: lines.filter((l) => !l.startsWith("#")).length,
  };
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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
  const described = git(cwd, "describe", "--tags", "--long");
  const match = described ? /^(.*)-(\d+)-g[0-9a-f]+$/.exec(described) : null;
  if (!match) return [];
  const [, tag, since] = match;
  return Number(since) === 0
    ? [`at tag ${tag}`]
    : [`${count(Number(since), "commit")} since tag ${tag}`];
}

function workState(status: Status): string {
  if (!status.hasCommits) return "no commits yet";
  return status.changed > 0 ? `${count(status.changed, "file")} uncommitted` : "clean";
}

function gitLine(cwd: string, toplevel: string): string | null {
  const porcelain = git(cwd, "status", "--porcelain=v2", "--branch");
  if (porcelain === null) return null;
  const status = parseStatus(porcelain);
  return [
    `Repo: ${basename(toplevel)} on ${status.head}`,
    workState(status),
    ...syncState(status),
    ...releaseState(cwd),
  ].join(" · ");
}

function unversionedProjectLine(cwd: string): string | null {
  const project = resolveProjectFromCwd(cwd, readAllProjects());
  if (!project) return null;
  return `Repo: ${project.name} is not under git — nothing in it is committed, pushed or released; the files on disk are its whole state`;
}

export function getRepoStateReminder(cwd: string = process.cwd()): string | null {
  if (!isEnabled("repoState")) return null;
  const toplevel = git(cwd, "rev-parse", "--show-toplevel");
  const line = toplevel ? gitLine(cwd, toplevel) : unversionedProjectLine(cwd);
  return line ? `<system-reminder>${line}</system-reminder>` : null;
}
