import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeToolUse } from "../src/hooks/lib/agent";
import { ledgeredCall, unappliedVerdictOf } from "../src/hooks/lib/ledger-hook";

const COPILOT_WRITE = {
  sessionId: "sess_1",
  timestamp: 1704614400000,
  cwd: "/work/app",
  toolName: "write",
  toolArgs: JSON.stringify({ file_path: "/work/app/src/index.ts", content: "x" }),
};

describe("Copilot sends its tool arguments as JSON text, not an object", () => {
  test("the arguments are read rather than silently seen as empty", () => {
    expect(normalizeToolUse(COPILOT_WRITE)?.toolInput).toEqual({
      file_path: "/work/app/src/index.ts",
      content: "x",
    });
  });

  test("an object stays an object, so the other agents are unaffected", () => {
    expect(
      normalizeToolUse({ toolName: "write", tool_input: { file_path: "/a.ts" } })
        ?.toolInput
    ).toEqual({ file_path: "/a.ts" });
  });

  test("text that is not JSON yields no arguments rather than throwing", () => {
    expect(
      normalizeToolUse({ toolName: "write", toolArgs: "not json" })?.toolInput
    ).toEqual({});
  });

  test("JSON that is not an object yields no arguments", () => {
    expect(normalizeToolUse({ toolName: "write", toolArgs: "[1,2]" })?.toolInput).toEqual(
      {}
    );
  });
});

describe("Copilot publishes no call id, so the halves pair on what it does send", () => {
  test("a write is ledgered despite the missing id", () => {
    const call = ledgeredCall(COPILOT_WRITE);
    expect(call?.tool).toBe("write");
    expect(call?.target).toBe("/work/app/src/index.ts");
    expect(call?.toolUseId).toMatch(/^derived-[0-9a-f]{32}$/);
  });

  test("the pre and post halves of one call derive the same key", () => {
    const post = { ...COPILOT_WRITE, toolResult: { resultType: "success" } };
    expect(ledgeredCall(post)?.toolUseId).toBe(ledgeredCall(COPILOT_WRITE)?.toolUseId);
  });

  test("a different session, tool or file derives a different key", () => {
    const base = ledgeredCall(COPILOT_WRITE)?.toolUseId;
    const other = (patch: Record<string, unknown>) =>
      ledgeredCall({ ...COPILOT_WRITE, ...patch })?.toolUseId;

    expect(other({ sessionId: "sess_2" })).not.toBe(base);
    expect(other({ toolName: "edit" })).not.toBe(base);
    expect(other({ toolArgs: JSON.stringify({ file_path: "/work/app/b.ts" }) })).not.toBe(
      base
    );
  });

  test("without a session there is no key, so nothing is recorded on a guess", () => {
    const { sessionId, ...anonymous } = COPILOT_WRITE;
    expect(ledgeredCall(anonymous)).toBeNull();
  });

  test("an explicit id still wins over the derived one", () => {
    const withId = { ...COPILOT_WRITE, tool_use_id: "tu_real" };
    expect(ledgeredCall(withId)?.toolUseId).toBe("tu_real");
  });
});

describe("the failure reason key differs between agents on the same event name", () => {
  test("Copilot's postToolUseFailure carries it under error", () => {
    expect(
      unappliedVerdictOf({ hook_event_name: "postToolUseFailure", error: "EACCES" })
    ).toEqual({ outcome: "failed", reason: "EACCES" });
  });

  test("Cursor's carries it under error_message", () => {
    expect(
      unappliedVerdictOf({
        hook_event_name: "postToolUseFailure",
        error_message: "rejected",
      })
    ).toEqual({ outcome: "failed", reason: "rejected" });
  });

  test("Cursor's key is preferred when a payload somehow carries both", () => {
    expect(
      unappliedVerdictOf({
        hook_event_name: "postToolUseFailure",
        error_message: "specific",
        error: "generic",
      })
    ).toEqual({ outcome: "failed", reason: "specific" });
  });
});

describe("the shipped Copilot hooks template", () => {
  const raw = readFileSync(
    resolve(import.meta.dir, "../assets/templates/hooks.copilot.json"),
    "utf-8"
  );
  const template = JSON.parse(raw) as {
    hooks: Record<
      string,
      Array<{ command?: string; bash?: string; powershell?: string }>
    >;
  };
  const commandsFor = (event: string) =>
    (template.hooks[event] ?? []).map((e) => e.bash ?? "");

  test("registers all three ledger halves on Copilot's own event names", () => {
    expect(commandsFor("preToolUse").join(" ")).toContain("LedgerSnapshot.ts");
    expect(commandsFor("postToolUse").join(" ")).toContain("LedgerCommit.ts");
    expect(commandsFor("postToolUseFailure").join(" ")).toContain("LedgerUnapplied.ts");
  });

  test("snapshots last, so a blocking hook does not strand a snapshot", () => {
    expect(commandsFor("preToolUse").at(-1)).toContain("LedgerSnapshot.ts");
  });

  test("names the event on argv, since the payload never does", () => {
    expect(commandsFor("postToolUseFailure")[0]).toContain("--event=postToolUseFailure");
  });

  test("declares its agent by flag on every hook, with no shell prefix left", () => {
    for (const entries of Object.values(template.hooks)) {
      for (const entry of entries) {
        expect(entry.bash).toContain("--agent=copilot");
        expect(entry.powershell).toContain("--agent=copilot");
      }
    }
    expect(raw).not.toContain("PAL_AGENT=");
  });

  test("keeps a powershell command, which a bash-only template broke on Windows", () => {
    for (const entries of Object.values(template.hooks)) {
      for (const entry of entries) {
        expect(entry.powershell).toContain("bun run");
      }
    }
  });
});
