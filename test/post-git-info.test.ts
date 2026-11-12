import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsSince } from "../src/hooks/lib/events";
import {
  literalCommandDir,
  runsGit,
  runsGitCommit,
  worktreePaths,
} from "../src/hooks/lib/git-command-repo";
import { postGitInfoResponse } from "../src/hooks/lib/post-git-info";
import type { Git } from "../src/hooks/lib/repo-state";
import { parseStatus } from "../src/hooks/lib/repo-state";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const NOW = Date.parse("2026-11-12T10:00:00Z");
const NOW_SEC = NOW / 1000;
let home: string;
let since: Date;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(resolve(home, "memory", "pal-settings.json"), "{}");
  reload();
  since = new Date(Date.now() - 1000);
});

function fakeGit(answers: Record<string, string>): Git {
  return (cwd, ...args) => answers[`${cwd}: ${args.join(" ")}`] ?? null;
}

const CLEAN =
  "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0";

function repo(path: string, porcelain = CLEAN): Record<string, string> {
  return {
    [`${path}: rev-parse --show-toplevel`]: path,
    [`${path}: status --porcelain=v2 --branch`]: porcelain,
  };
}

function bash(command: string, extra: Record<string, unknown> = {}) {
  return {
    session_id: "s1",
    tool_name: "Bash",
    tool_input: { command },
    cwd: "/r/main",
    duration_ms: 3000,
    ...extra,
  };
}

function contextOf(response: string | null): string | null {
  if (!response) return null;
  return JSON.parse(response).hookSpecificOutput.additionalContext;
}

describe("which commands count as git", () => {
  test.each([
    ["git status", true],
    ["cd /x && git log -1", true],
    ['git -C "$W" commit -m x', true],
    ["ls ~/git/portable-agent-layer", false],
    ["cat .gitignore", false],
  ])("%s → %p", (command, expected) => {
    expect(runsGit(command)).toBe(expected);
  });

  test.each([
    ["git commit -m x", true],
    ["git -C /a commit -qm x", true],
    ["git -c user.name=t commit -m x", true],
    ["git commit-tree abc", false],
    ["git status", false],
  ])("%s commits → %p", (command, expected) => {
    expect(runsGitCommit(command)).toBe(expected);
  });
});

describe("literalCommandDir", () => {
  test("prefers git -C over cd and resolves against cwd", () => {
    expect(literalCommandDir("cd /a && git -C sub status", "/base")).toBe(
      resolve("/base", "sub")
    );
  });

  test("reads a quoted cd target", () => {
    expect(literalCommandDir('cd "/x y" && git status', "/base")).toBe(resolve("/x y"));
  });

  test("ignores a directory named through a variable", () => {
    expect(literalCommandDir('cd "$W" && git status', "/base")).toBeNull();
  });
});

test("worktreePaths lists the main checkout and every linked one", () => {
  const porcelain =
    "worktree /r/main\nHEAD a\nbranch refs/heads/main\n\nworktree /r/wt\nHEAD b\ndetached";
  expect(worktreePaths(porcelain)).toEqual(["/r/main", "/r/wt"]);
});

test("parseStatus names each file and whether it is staged", () => {
  const status = parseStatus(
    [
      "# branch.oid abc",
      "# branch.head main",
      "1 .M N... 100644 100644 100644 a a src/a.ts",
      "1 M. N... 100644 100644 100644 a a b c.ts",
      "1 MM N... 100644 100644 100644 a a d.ts",
      "2 R. N... 100644 100644 100644 a a R100 new.ts\told.ts",
      "u UU N... 100644 100644 100644 100644 a a a e.ts",
      "? f.ts",
    ].join("\n")
  );
  expect(status.files).toEqual([
    { path: "src/a.ts", state: "unstaged" },
    { path: "b c.ts", state: "staged" },
    { path: "d.ts", state: "staged+unstaged" },
    { path: "new.ts", state: "staged" },
    { path: "e.ts", state: "conflicted" },
    { path: "f.ts", state: "untracked" },
  ]);
});

describe("postGitInfoResponse", () => {
  test("stays silent for a command that runs no git", () => {
    expect(postGitInfoResponse(bash("ls"), fakeGit(repo("/r/main")), NOW)).toBeNull();
  });

  test("stays silent for a tool other than Bash", () => {
    const payload = { ...bash("git status"), tool_name: "Write" };
    expect(postGitInfoResponse(payload, fakeGit(repo("/r/main")), NOW)).toBeNull();
  });

  test("reports a clean checkout in the hook's cwd as Claude Code's PostToolUse context", () => {
    const response = postGitInfoResponse(
      bash("git status"),
      fakeGit(repo("/r/main")),
      NOW
    );
    expect(JSON.parse(response ?? "{}").hookSpecificOutput.hookEventName).toBe(
      "PostToolUse"
    );
    expect(contextOf(response)).toBe(
      "Git state after this command: Repo: main on main · clean · pushed"
    );
  });

  test("lists changed files with their state, capped", () => {
    const files = Array.from({ length: 12 }, (_, i) => `? f${i}.ts`);
    const git = fakeGit(repo("/r/main", [CLEAN, ...files].join("\n")));
    const context = contextOf(postGitInfoResponse(bash("git add ."), git, NOW));
    expect(context).toContain("12 files uncommitted");
    expect(context).toContain("f0.ts (untracked), f1.ts (untracked)");
    expect(context).toContain("f9.ts (untracked), +2 more");
    expect(context).not.toContain("f10.ts");
  });

  test("after a commit finds the worktree that just committed and lists HEAD and what is left", () => {
    const git = fakeGit({
      ...repo("/r/main"),
      ...repo("/r/wt", `${CLEAN}\n1 .M N... 100644 100644 100644 a a left.ts`),
      "/r/main: worktree list --porcelain":
        "worktree /r/main\nHEAD a\n\nworktree /r/wt\nHEAD b",
      "/r/main: log -1 --format=%ct HEAD": String(NOW_SEC - 3600),
      "/r/wt: log -1 --format=%ct HEAD": String(NOW_SEC - 1),
      "/r/wt: show --name-status --format=%h %s HEAD":
        "abc1234 feat: add thing\n\nM\tsrc/a.ts\nA\tsrc/b.ts",
    });
    const context = contextOf(
      postGitInfoResponse(bash('cd "$W" && git commit -m "feat: add thing"'), git, NOW)
    );
    expect(context).toBe(
      [
        "Git state after this command: Repo: wt on main · 1 file uncommitted · pushed — left.ts (unstaged)",
        'HEAD abc1234 "feat: add thing" contains 2 files: M src/a.ts, A src/b.ts',
      ].join("\n")
    );
    const [event] = eventsSince("git_state_injected", since);
    expect(event).toMatchObject({
      trigger: "commit",
      source: "worktree",
      changed: 1,
      committedFiles: 2,
      session: "s1",
    });
  });

  test("a commit no worktree shows falls back to a literal git -C directory", () => {
    const other = resolve("/other");
    const git = fakeGit({
      ...repo("/r/main"),
      ...repo(other),
      "/r/main: worktree list --porcelain": "worktree /r/main\nHEAD a",
      "/r/main: log -1 --format=%ct HEAD": String(NOW_SEC - 3600),
      [`${other}: show --name-status --format=%h %s HEAD`]: "def5678 fix: x\n\nM\tz.ts",
    });
    const context = contextOf(
      postGitInfoResponse(bash("git -C /other commit -m 'fix: x'"), git, NOW)
    );
    expect(context).toContain("Repo: other on main");
    expect(context).toContain('HEAD def5678 "fix: x" contains 1 file: M z.ts');
    expect(eventsSince("git_state_injected", since)[0]).toMatchObject({
      source: "literal",
    });
  });

  test("a directory git cannot read falls back to the hook's cwd", () => {
    const git = fakeGit(repo("/r/main"));
    const context = contextOf(
      postGitInfoResponse(bash("cd /gone && git status"), git, NOW)
    );
    expect(context).toContain("Repo: main on main");
    expect(eventsSince("git_state_injected", since)[0]).toMatchObject({ source: "cwd" });
  });

  test("outside any repository it stays silent and logs nothing", () => {
    expect(postGitInfoResponse(bash("git status"), fakeGit({}), NOW)).toBeNull();
    expect(eventsSince("git_state_injected", since)).toEqual([]);
  });

  test("a git runner that throws yields no output instead of failing the call", () => {
    const throwing: Git = () => {
      throw new Error("boom");
    };
    expect(postGitInfoResponse(bash("git status"), throwing, NOW)).toBeNull();
  });

  test("stays silent when repoState is turned off", () => {
    writeFileSync(
      resolve(home, "memory", "pal-settings.json"),
      JSON.stringify({ dynamicContext: { repoState: false } })
    );
    reload();
    expect(
      postGitInfoResponse(bash("git status"), fakeGit(repo("/r/main")), NOW)
    ).toBeNull();
  });
});
