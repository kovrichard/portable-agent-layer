/**
 * Every commit that still exists in a registered project's repository, as a
 * commit event whose id is its hash. Names, emails and the subject are text,
 * so they go to the content store; the event keeps counts and flags.
 */

import { spawnSync } from "node:child_process";
import { appendEvent } from "../../../hooks/lib/events";
import { PAL_REPO_URL } from "../../../hooks/lib/remote";

const RECORD = "\x1e";
const FIELD = "\x1f";
const FORMAT = [
  "%H",
  "%aI",
  "%cI",
  "%an",
  "%ae",
  "%cn",
  "%ce",
  "%D",
  "%P",
  "%s",
  "%b",
  "",
]
  .join(FIELD)
  .replace(/^/, RECORD);
const AI_CO_AUTHOR = new RegExp(
  String.raw`noreply@anthropic\.com|${PAL_REPO_URL.replace(/[.]/g, String.raw`\.`)}|copilot|cursor|openai|codex|gemini`,
  "i"
);
const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:/;

interface Commit {
  hash: string;
  authoredAt: string;
  committedAt: string;
  author: string;
  authorEmail: string;
  committer: string;
  committerEmail: string;
  subject: string;
  files: number;
  added: number;
  deleted: number;
  commitType: string | null;
  breaking: boolean;
  revert: boolean;
  merge: boolean;
  tags: string[];
  coAuthors: number;
  aiCoAuthored: boolean;
}

function gitLog(repo: string, since: string | undefined): string | null {
  const args = [
    "-C",
    repo,
    "log",
    "--branches",
    "--tags",
    "--remotes",
    "--numstat",
    `--format=${FORMAT}`,
  ];
  if (since) args.push(`--since=${since}`);
  const result = spawnSync("git", args, {
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

function numstatOf(text: string) {
  const rows = text
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cells) => cells.length === 3);
  const count = (cell: string) => (cell === "-" ? 0 : Number(cell));
  return {
    files: rows.length,
    added: rows.reduce((sum, [added]) => sum + count(added), 0),
    deleted: rows.reduce((sum, [, deleted]) => sum + count(deleted), 0),
  };
}

function coAuthorLines(body: string): string[] {
  return body.split("\n").filter((line) => /^co-authored[- ]by\b/i.test(line.trim()));
}

function tagsOf(refs: string): string[] {
  return refs
    .split(", ")
    .filter((ref) => ref.startsWith("tag: "))
    .map((ref) => ref.slice("tag: ".length));
}

function commitOf(record: string): Commit | null {
  const [hash, aI, cI, an, ae, cn, ce, refs, parents, subject, body, numstat] =
    record.split(FIELD);
  if (!hash || !aI || !cI) return null;
  const conventional = CONVENTIONAL.exec(subject ?? "");
  const coAuthors = coAuthorLines(body ?? "");
  return {
    hash,
    authoredAt: new Date(aI).toISOString(),
    committedAt: new Date(cI).toISOString(),
    author: an ?? "",
    authorEmail: ae ?? "",
    committer: cn ?? "",
    committerEmail: ce ?? "",
    subject: subject ?? "",
    ...numstatOf(numstat ?? ""),
    commitType: conventional?.[1] ?? null,
    breaking: !!conventional?.[3] || /^BREAKING CHANGE:/m.test(body ?? ""),
    revert: conventional?.[1] === "revert" || (subject ?? "").startsWith("Revert "),
    merge: (parents ?? "").trim().split(" ").length > 1,
    tags: tagsOf(refs ?? ""),
    coAuthors: coAuthors.length,
    aiCoAuthored: coAuthors.some((line) => AI_CO_AUTHOR.test(line)),
  };
}

function readCommits(repo: string, since?: string): Commit[] {
  const log = gitLog(repo, since);
  if (log === null) return [];
  return log
    .split(RECORD)
    .map(commitOf)
    .filter((commit): commit is Commit => commit !== null);
}

const commitEventId = (hash: string) => `git:${hash}`;

function emitCommit(repo: string, commit: Commit): void {
  appendEvent(
    "commit",
    {
      hash: commit.hash,
      committedAt: commit.committedAt,
      files: commit.files,
      added: commit.added,
      deleted: commit.deleted,
      commitType: commit.commitType,
      breaking: commit.breaking,
      revert: commit.revert,
      merge: commit.merge,
      tags: commit.tags,
      coAuthors: commit.coAuthors,
      aiCoAuthored: commit.aiCoAuthored,
    },
    {
      id: commitEventId(commit.hash),
      ts: commit.authoredAt,
      session: null,
      runtime: "git",
      channel: null,
      cwd: repo,
      content: {
        author: commit.author,
        authorEmail: commit.authorEmail,
        committer: commit.committer,
        committerEmail: commit.committerEmail,
        subject: commit.subject,
      },
    }
  );
}

/** Appends the commits not yet logged and returns how many. */
export function backfillGit(repos: string[], known: Set<string>, since?: string): number {
  let emitted = 0;
  for (const repo of repos) {
    for (const commit of readCommits(repo, since)) {
      const id = commitEventId(commit.hash);
      if (known.has(id)) continue;
      known.add(id);
      emitCommit(repo, commit);
      emitted++;
    }
  }
  return emitted;
}
