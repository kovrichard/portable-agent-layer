import { describe, expect, test } from "bun:test";
import { keepJqUnwrapped } from "../src/hooks/lib/rtk-jq";

const claudeRewrite = (command: string) =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecisionReason: "RTK auto-rewrite",
      updatedInput: { command },
    },
  });

const rewrittenCommand = (out: string) =>
  JSON.parse(out).hookSpecificOutput.updatedInput.command;

describe("keepJqUnwrapped", () => {
  test("a jq call goes back to plain jq", () => {
    const out = keepJqUnwrapped(claudeRewrite("rtk jq -c .a t.json"));
    expect(rewrittenCommand(out)).toBe("jq -c .a t.json");
  });

  test("jq is restored while other rewrites in the command stay", () => {
    const out = keepJqUnwrapped(
      claudeRewrite("rtk grep -n x f && cat a.json | rtk jq '.b'")
    );
    expect(rewrittenCommand(out)).toBe("rtk grep -n x f && cat a.json | jq '.b'");
  });

  test("a rewrite without jq is returned unchanged", () => {
    const original = claudeRewrite("rtk git status");
    expect(keepJqUnwrapped(original)).toBe(original);
  });

  test("a word that only ends in jq is left alone", () => {
    const original = claudeRewrite("rtk ls ~/jq-notes");
    expect(keepJqUnwrapped(original)).toBe(original);
  });

  test("output that is not JSON is returned unchanged", () => {
    expect(keepJqUnwrapped("not json")).toBe("not json");
  });
});
