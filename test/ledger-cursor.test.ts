import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ledgeredCall,
  ledgeredTarget,
  unappliedVerdictOf,
} from "../src/hooks/lib/ledger-hook";

const CURSOR_WRITE = {
  hook_event_name: "preToolUse",
  conversation_id: "conv_1",
  generation_id: "gen_1",
  cursor_version: "2.4.0",
  workspace_roots: ["/work/app"],
  tool_name: "Write",
  tool_use_id: "tu_cursor_1",
  tool_input: { file_path: "/work/app/src/index.ts" },
  cwd: "/work/app",
};

describe("ledgeredCall on Cursor payloads", () => {
  test("reads a Write call, which is how Cursor edits files at all", () => {
    expect(ledgeredCall(CURSOR_WRITE)).toEqual({
      toolUseId: "tu_cursor_1",
      tool: "Write",
      target: "/work/app/src/index.ts",
    });
  });

  test("ignores the tools Cursor has that the ledger does not record", () => {
    for (const tool of ["Shell", "Read", "Grep", "Task", "MCP:fetch"]) {
      expect(ledgeredTarget(tool, { file_path: "/work/app/a.ts" })).toBeNull();
    }
  });

  test("a Cursor call without a tool_use_id is not ledgered", () => {
    const { tool_use_id, ...missing } = CURSOR_WRITE;
    expect(ledgeredCall(missing)).toBeNull();
  });
});

describe("unappliedVerdictOf on Cursor payloads", () => {
  const FAILURE = {
    hook_event_name: "postToolUseFailure",
    tool_name: "Write",
    tool_use_id: "tu_cursor_1",
    tool_input: { file_path: "/work/app/src/index.ts" },
    duration: 12,
    is_interrupt: false,
  };

  test("reads a tool error as failed, taking the reason from error_message", () => {
    expect(
      unappliedVerdictOf({
        ...FAILURE,
        error_message: "EACCES: permission denied",
        failure_type: "error",
      })
    ).toEqual({ outcome: "failed", reason: "EACCES: permission denied" });
  });

  test("a timeout is a failure, not a denial", () => {
    expect(
      unappliedVerdictOf({
        ...FAILURE,
        error_message: "Timed out after 30s",
        failure_type: "timeout",
      })
    ).toEqual({ outcome: "failed", reason: "Timed out after 30s" });
  });

  test("separates a denial from a failure on the one event Cursor sends", () => {
    expect(
      unappliedVerdictOf({
        ...FAILURE,
        error_message: "User rejected the edit",
        failure_type: "permission_denied",
      })
    ).toEqual({ outcome: "denied", reason: "User rejected the edit" });
  });

  test("a denial with no message is still recorded as denied", () => {
    expect(unappliedVerdictOf({ ...FAILURE, failure_type: "permission_denied" })).toEqual(
      { outcome: "denied" }
    );
  });

  test("an unknown failure_type falls back to failed rather than guessing", () => {
    expect(
      unappliedVerdictOf({ ...FAILURE, error_message: "x", failure_type: "cancelled" })
    ).toEqual({ outcome: "failed", reason: "x" });
  });

  test("Cursor's camelCase event does not collide with Claude Code's PascalCase one", () => {
    expect(
      unappliedVerdictOf({ hook_event_name: "PostToolUseFailure", error: "boom" })
    ).toEqual({ outcome: "failed", reason: "boom" });
    expect(unappliedVerdictOf({ hook_event_name: "posttooluseFailure" })).toBeNull();
  });

  test("failure_type on a Claude Code payload still upgrades it to denied", () => {
    expect(
      unappliedVerdictOf({
        hook_event_name: "PostToolUseFailure",
        error: "denied by rule",
        failure_type: "permission_denied",
      })
    ).toEqual({ outcome: "denied", reason: "denied by rule" });
  });

  test("Cursor's success and pre events are not unapplied verdicts", () => {
    for (const event of ["preToolUse", "postToolUse", "afterFileEdit", "stop"]) {
      expect(unappliedVerdictOf({ hook_event_name: event })).toBeNull();
    }
  });
});

describe("the shipped Cursor hooks template", () => {
  const template = JSON.parse(
    readFileSync(
      resolve(import.meta.dir, "../assets/templates/hooks.cursor.json"),
      "utf-8"
    )
  ) as { hooks: Record<string, Array<{ command: string }>> };

  const commandsFor = (event: string) =>
    (template.hooks[event] ?? []).map((e) => e.command);

  test("registers all three ledger halves on Cursor's own event names", () => {
    expect(commandsFor("preToolUse").join(" ")).toContain("LedgerSnapshot.ts");
    expect(commandsFor("postToolUse").join(" ")).toContain("LedgerCommit.ts");
    expect(commandsFor("postToolUseFailure").join(" ")).toContain("LedgerUnapplied.ts");
  });

  test("snapshots last, so a blocking hook does not strand a snapshot", () => {
    const pre = commandsFor("preToolUse");
    expect(pre.at(-1)).toContain("LedgerSnapshot.ts");
    expect(pre.length).toBeGreaterThan(1);
  });

  test("every ledger hook runs under PAL_AGENT=cursor so entries name the runtime", () => {
    for (const event of ["preToolUse", "postToolUse", "postToolUseFailure"]) {
      for (const command of commandsFor(event)) {
        expect(command).toStartWith("PAL_AGENT=cursor ");
      }
    }
  });

  test("uses no Claude Code event name", () => {
    for (const event of Object.keys(template.hooks)) {
      expect(event[0]).toBe(event[0].toLowerCase());
    }
  });
});
