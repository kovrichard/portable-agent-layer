import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeProject } from "../src/hooks/lib/projects";
import { PAL_REPO_URL } from "../src/hooks/lib/remote";
import { reload } from "../src/hooks/lib/settings";
import { backfillEvents } from "../src/tools/lib/backfill";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const AUTHOR = "Ada Example";

let home: string;
let repo: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = resolve(home, "pal");
  mkdirSync(resolve(home, "pal", "memory", "state"), { recursive: true });
  reload();
  repo = resolve(home, "repo");
  mkdirSync(repo);
  run("init", "-q", "-b", "main");
  const now = new Date().toISOString();
  writeProject({
    name: "repo",
    path: repo,
    status: "active",
    created: now,
    updated: now,
  });
});

function run(...args: string[]): string {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: AUTHOR,
      GIT_AUTHOR_EMAIL: "ada@example.test",
      GIT_COMMITTER_NAME: AUTHOR,
      GIT_COMMITTER_EMAIL: "ada@example.test",
      GIT_AUTHOR_DATE: "2026-10-12T15:00:00+02:00",
      GIT_COMMITTER_DATE: "2026-10-12T15:05:00+02:00",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commitFiles(message: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files))
    writeFileSync(resolve(repo, name), text);
  run("add", "-A");
  run("commit", "-q", "-m", message);
  return run("rev-parse", "HEAD");
}

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, "pal", dir, "events");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const commits = () => logLines("memory").filter((e) => e.type === "commit");

describe("git history becomes commit events", () => {
  test("a commit carries its counts, type and AI co-author, stamped at its author date", () => {
    const hash = commitFiles(
      `feat(x): add two files\n\nCo-authored by Helper · ${PAL_REPO_URL}`,
      { a: "1\n2\n3\n", b: "1\n" }
    );
    run("tag", "v1.0.0");

    expect(backfillEvents()).toMatchObject({ git: 1 });
    expect(commits()).toEqual([
      expect.objectContaining({
        id: `git:${hash}`,
        ts: "2026-10-12T13:00:00.000Z",
        runtime: "git",
        project: "repo",
        hash,
        committedAt: "2026-10-12T13:05:00.000Z",
        files: 2,
        added: 4,
        deleted: 0,
        commitType: "feat",
        breaking: false,
        revert: false,
        merge: false,
        tags: ["v1.0.0"],
        coAuthors: 1,
        aiCoAuthored: true,
      }),
    ]);
  });

  test("a human co-author, a breaking change and a revert are told apart", () => {
    commitFiles("feat!: drop the old flag\n\nCo-authored-by: Bob <bob@example.test>", {
      a: "x\n",
    });
    commitFiles('Revert "feat!: drop the old flag"', { a: "" });

    backfillEvents();
    const [breaking, revert] = [...commits()].sort((x, y) =>
      String(x.commitType).localeCompare(String(y.commitType))
    );
    expect(breaking).toMatchObject({ breaking: true, coAuthors: 1, aiCoAuthored: false });
    expect(revert).toMatchObject({ revert: true, commitType: null, deleted: 1 });
  });

  test("names, emails and the subject stay in the content store, out of the event", () => {
    const hash = commitFiles("fix: a private subject line", { a: "1\n" });
    backfillEvents();
    const events = JSON.stringify(logLines("memory"));
    expect(events).not.toContain(AUTHOR);
    expect(events).not.toContain("ada@example.test");
    expect(events).not.toContain("a private subject line");
    expect(logLines("memory/content")).toEqual([
      expect.objectContaining({
        id: `git:${hash}`,
        author: AUTHOR,
        subject: "fix: a private subject line",
      }),
    ]);
  });

  test("a second run appends nothing, and a new commit only itself", () => {
    commitFiles("chore: one", { a: "1\n" });
    backfillEvents();
    expect(backfillEvents()).toMatchObject({ git: 0 });
    commitFiles("chore: two", { b: "1\n" });
    expect(backfillEvents()).toMatchObject({ git: 1 });
    expect(commits()).toHaveLength(2);
  });

  test("--since leaves older commits out", () => {
    commitFiles("chore: old", { a: "1\n" });
    expect(backfillEvents("2026-10-13")).toMatchObject({ git: 0 });
  });
});
