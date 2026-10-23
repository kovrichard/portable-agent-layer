import { describe, expect, test } from "bun:test";
import { isWorktreeAgentGitCall } from "../src/hooks/lib/rtk-worktree";

const WORKTREE = "/repo/.claude/worktrees/agent-abc";
const call = (cwd: string, command: string) =>
  JSON.stringify({ cwd, tool_input: { command } });

describe("isWorktreeAgentGitCall", () => {
  test("a git command in an agent worktree", () => {
    expect(isWorktreeAgentGitCall(call(WORKTREE, "git log -1"))).toBe(true);
  });

  test("git later in a compound command in an agent worktree", () => {
    expect(isWorktreeAgentGitCall(call(WORKTREE, "cd src && git status"))).toBe(true);
  });

  test("a Windows agent worktree path", () => {
    expect(
      isWorktreeAgentGitCall(call("C:\\repo\\.claude\\worktrees\\agent-abc", "git diff"))
    ).toBe(true);
  });

  test("a git command in the main checkout", () => {
    expect(isWorktreeAgentGitCall(call("/repo", "git log -1"))).toBe(false);
  });

  test("a command without git in an agent worktree", () => {
    expect(isWorktreeAgentGitCall(call(WORKTREE, "bun test"))).toBe(false);
  });

  test("a word that only contains git", () => {
    expect(isWorktreeAgentGitCall(call(WORKTREE, "cat .gitignore digit"))).toBe(false);
  });

  test("input that is not JSON", () => {
    expect(isWorktreeAgentGitCall("not json")).toBe(false);
  });
});
