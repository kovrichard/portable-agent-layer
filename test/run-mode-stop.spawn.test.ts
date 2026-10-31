import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent, readEvents, scopeOf } from "../src/hooks/lib/progress-tree";
import { attachGitProgress } from "../src/hooks/lib/progress-tree-git";
import { newRun, writeRun } from "../src/hooks/lib/run-mode";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const HOOKS = resolve(import.meta.dir, "../src/hooks");
let repo: string;

function git(...args: string[]): string {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function commit(subject: string) {
  writeFileSync(resolve(repo, `${subject.replace(/\W/g, "-")}.txt`), subject);
  git("add", "-A");
  git("commit", "-q", "-m", subject);
}

function stop() {
  return spawnSync(
    "bun",
    ["run", resolve(HOOKS, "StopOrchestrator.ts"), "--agent=claude"],
    {
      input: JSON.stringify({
        session_id: "night",
        cwd: repo,
        last_assistant_message: "Working on the next task.",
      }),
      encoding: "utf-8",
      cwd: repo,
      env: process.env,
    }
  );
}

function attachedCommits(): string[] {
  return readEvents()
    .map((e) => e as unknown as Record<string, unknown>)
    .filter((e) => e.type === "attach" && e.kind === "commit")
    .map((e) => String(e.label));
}

beforeEach(() => {
  const dir = freshTestDir(import.meta.file);
  process.env.PAL_HOME = dir;
  repo = resolve(dir, "repo");
  mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "me@example.com");
  git("config", "user.name", "me");
  commit("initial");
});

describe("a stop held by an unattended run", () => {
  test("still attaches the commits made since the last turn", () => {
    appendEvent(scopeOf(repo), "n1", "open", { title: "Night", parent: null });
    attachGitProgress(repo);
    commit("feat: night step");
    const now = new Date();
    writeRun(
      newRun({
        kind: "unattended",
        scope: scopeOf(repo),
        until: new Date(now.getTime() + 3_600_000),
        now,
      })
    );

    const proc = stop();

    expect(proc.stdout).toContain('"decision":"block"');
    expect(attachedCommits()).toEqual(["feat: night step"]);
  });
});
