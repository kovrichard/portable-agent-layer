import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent, readEvents, readTree } from "../src/hooks/lib/work-tree";
import { attachGitProgress } from "../src/hooks/lib/work-tree-git";
import { freshTestDir } from "./lib/test-home";

let repo: string;
let file: string;

function git(...args: string[]): string {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function commit(subject: string, author = "me@example.com") {
  writeFileSync(resolve(repo, `${subject.replace(/\W/g, "-")}.txt`), subject);
  git("add", "-A");
  git("-c", `user.email=${author}`, "-c", "user.name=x", "commit", "-q", "-m", subject);
}

beforeEach(() => {
  const dir = freshTestDir(import.meta.file);
  process.env.PAL_HOME = dir;
  repo = resolve(dir, "repo");
  file = resolve(dir, "events.jsonl");
  mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "me@example.com");
  git("config", "user.name", "me");
  commit("initial");
});

const scope = () => repo;
const node = () => readTree(scope(), file).nodes.get("n1");

describe("attaching git progress to the active node", () => {
  test("a scope with no work is left alone", () => {
    attachGitProgress(repo, file);
    expect(existsSync(file)).toBe(false);
  });

  test("the first sighting only sets the cursor", () => {
    appendEvent(scope(), "n1", "open", { title: "Gate", parent: null }, file);
    attachGitProgress(repo, file);
    expect(node()?.artifacts).toEqual([]);
    expect(readTree(scope(), file).gitCursor?.head).toBe(git("rev-parse", "HEAD"));
  });

  test("the user's new commits land on the active node in order", () => {
    appendEvent(scope(), "n1", "open", { title: "Gate", parent: null }, file);
    attachGitProgress(repo, file);
    commit("feat: one");
    commit("feat: two");
    attachGitProgress(repo, file);
    expect(node()?.artifacts.map((a) => [a.kind, a.label])).toEqual([
      ["commit", "feat: one"],
      ["commit", "feat: two"],
    ]);
  });

  test("someone else's commits, as a pull brings them, are not attached", () => {
    appendEvent(scope(), "n1", "open", { title: "Gate", parent: null }, file);
    attachGitProgress(repo, file);
    commit("their work", "someone@else.com");
    attachGitProgress(repo, file);
    expect(node()?.artifacts).toEqual([]);
  });

  describe("from the project root", () => {
    const atRoot = () => {
      appendEvent(
        scope(),
        "n1",
        "open",
        { title: "Old", parent: null },
        file,
        undefined,
        "s0"
      );
      attachGitProgress(repo, file, undefined, "s1");
    };
    const sessionNodes = () =>
      [...readTree(scope(), file, "s1").nodes.values()].filter((n) => n.id !== "n1");

    test("a commit opens the session's node and lands on it", () => {
      atRoot();
      commit("feat: from root");
      attachGitProgress(repo, file, undefined, "s1");
      const [opened] = sessionNodes();
      expect(readTree(scope(), file, "s1").active).toBe(opened.id);
      expect(opened.artifacts.map((a) => a.label)).toEqual(["feat: from root"]);
      expect(node()?.artifacts).toEqual([]);
    });

    test("a branch switch alone opens nothing", () => {
      atRoot();
      git("checkout", "-q", "-b", "look-around");
      attachGitProgress(repo, file, undefined, "s1");
      expect(sessionNodes()).toEqual([]);
    });
  });

  test("a branch switch is attached as the branch", () => {
    appendEvent(scope(), "n1", "open", { title: "Gate", parent: null }, file);
    attachGitProgress(repo, file);
    git("checkout", "-q", "-b", "feat/work-tree");
    attachGitProgress(repo, file);
    expect(node()?.artifacts.map((a) => [a.kind, a.ref])).toEqual([
      ["branch", "feat/work-tree"],
    ]);
  });

  test("nothing moved writes nothing", () => {
    appendEvent(scope(), "n1", "open", { title: "Gate", parent: null }, file);
    attachGitProgress(repo, file);
    const before = readEvents(file).length;
    attachGitProgress(repo, file);
    expect(readEvents(file)).toHaveLength(before);
  });

  test("with no active node the cursor still moves, so nothing piles up for later", () => {
    appendEvent(scope(), "n1", "open", { title: "Gate", parent: null }, file);
    attachGitProgress(repo, file);
    appendEvent(scope(), "n1", "park", {}, file);
    commit("feat: unowned");
    attachGitProgress(repo, file);
    appendEvent(scope(), "n1", "enter", {}, file);
    attachGitProgress(repo, file);
    expect(node()?.artifacts).toEqual([]);
    expect(readTree(scope(), file).gitCursor?.head).toBe(git("rev-parse", "HEAD"));
  });

  test("a folder that is not a repository is skipped", () => {
    const plain = resolve(repo, "..", "plain");
    mkdirSync(plain, { recursive: true });
    appendEvent(plain, "n1", "open", { title: "Notes", parent: null }, file);
    attachGitProgress(plain, file);
    expect(readEvents(file)).toHaveLength(1);
  });
});
