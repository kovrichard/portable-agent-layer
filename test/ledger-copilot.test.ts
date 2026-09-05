import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeToolUse } from "../src/hooks/lib/agent";
import { ledgeredCalls, unappliedVerdictOf } from "../src/hooks/lib/ledger-hook";

// Every payload below was captured from GitHub Copilot CLI 1.0.17 by registering
// a hook that wrote its stdin to disk. An invented fixture here proves only that
// the code agrees with the assumption it was written from — which is how the
// ledger came to record nothing at all on Copilot.

const COPILOT_PATCH = {
  sessionId: "4b0a1f8c-61fb-41e6-b79f-b2471866a16b",
  timestamp: 1788591800149,
  cwd: "/work/app",
  toolName: "apply_patch",
  toolArgs:
    "*** Begin Patch\n*** Update File: existing.txt\n@@\n-beta\n+BETA\n*** Add File: one.txt\n+1\n*** Add File: two.txt\n+2\n*** End Patch\n",
};

const COPILOT_VIEW = {
  sessionId: "4b0a1f8c-61fb-41e6-b79f-b2471866a16b",
  timestamp: 1788591552196,
  cwd: "/work/app",
  toolName: "view",
  toolArgs: { path: "/work/app/existing.txt" },
};

const targetsOf = (payload: Record<string, unknown>) =>
  ledgeredCalls(payload).map((call) => call.target);

/** A patch names files relative to cwd, so expectations resolve as the platform does. */
const inCwd = (name: string) => resolve(COPILOT_PATCH.cwd, name);

describe("Copilot writes files through a patch, whose arguments are not JSON", () => {
  test("the patch body yields no tool arguments, so no path can be read from them", () => {
    expect(normalizeToolUse(COPILOT_PATCH)?.toolInput).toEqual({});
  });

  test("its keyed tools do send an object, which passes through untouched", () => {
    expect(normalizeToolUse(COPILOT_VIEW)?.toolInput).toEqual({
      path: "/work/app/existing.txt",
    });
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

describe("one patch call changes a set of files, and the ledger records each", () => {
  test("every file the patch names is a target", () => {
    expect(targetsOf(COPILOT_PATCH)).toEqual([
      inCwd("existing.txt"),
      inCwd("one.txt"),
      inCwd("two.txt"),
    ]);
  });

  test("a deletion is a change to the file, so its header counts too", () => {
    const deletion = {
      ...COPILOT_PATCH,
      toolArgs: "*** Begin Patch\n*** Delete File: gone.txt\n*** End Patch\n",
    };
    expect(targetsOf(deletion)).toEqual([inCwd("gone.txt")]);
  });

  test("a path already absolute is left as it is", () => {
    const absolute = {
      ...COPILOT_PATCH,
      toolArgs: "*** Begin Patch\n*** Add File: /elsewhere/x.txt\n+1\n*** End Patch\n",
    };
    expect(targetsOf(absolute)).toEqual(["/elsewhere/x.txt"]);
  });

  test("the patch's own context lines are not mistaken for headers", () => {
    const quoted = {
      ...COPILOT_PATCH,
      toolArgs:
        "*** Begin Patch\n*** Add File: doc.md\n+*** Update File: not-a-target.txt\n*** End Patch\n",
    };
    expect(targetsOf(quoted)).toEqual([inCwd("doc.md")]);
  });

  test("a patch naming nothing records nothing", () => {
    const empty = { ...COPILOT_PATCH, toolArgs: "*** Begin Patch\n*** End Patch\n" };
    expect(ledgeredCalls(empty)).toEqual([]);
  });
});

describe("Copilot publishes no call id, so the halves pair on what it does send", () => {
  test("the pre and post halves of one patch derive the same keys", () => {
    const post = { ...COPILOT_PATCH, toolResult: { resultType: "success" } };
    expect(ledgeredCalls(post).map((c) => c.toolUseId)).toEqual(
      ledgeredCalls(COPILOT_PATCH).map((c) => c.toolUseId)
    );
  });

  test("each file in one patch gets its own key, or two would claim one snapshot", () => {
    const keys = ledgeredCalls(COPILOT_PATCH).map((call) => call.toolUseId);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^derived-[0-9a-f]{32}$/);
  });

  test("an explicit id does not collapse the files onto one key either", () => {
    const withId = { ...COPILOT_PATCH, tool_use_id: "tu_real" };
    const keys = ledgeredCalls(withId).map((call) => call.toolUseId);
    expect(new Set(keys).size).toBe(3);
  });

  test("a different session or file derives a different key", () => {
    const first = (payload: Record<string, unknown>) =>
      ledgeredCalls(payload)[0]?.toolUseId;
    expect(first({ ...COPILOT_PATCH, sessionId: "sess_2" })).not.toBe(
      first(COPILOT_PATCH)
    );
    expect(first({ ...COPILOT_PATCH, cwd: "/other" })).not.toBe(first(COPILOT_PATCH));
  });

  test("without a session there is no key, so nothing is recorded on a guess", () => {
    const { sessionId, ...anonymous } = COPILOT_PATCH;
    expect(ledgeredCalls(anonymous)).toEqual([]);
  });
});

describe("Copilot's keyed editing tools reach the ledger, and its reads do not", () => {
  test("the commands it sends as tool names are recorded", () => {
    for (const tool of ["create", "str_replace", "insert", "str_replace_editor"]) {
      expect(
        targetsOf({ sessionId: "s", toolName: tool, toolArgs: { path: "/a.ts" } })
      ).toEqual(["/a.ts"]);
    }
  });

  test("view is a query, so it is not an entry in a log of changes", () => {
    expect(ledgeredCalls(COPILOT_VIEW)).toEqual([]);
  });

  test("the editor tool reading under a command argument is declined too", () => {
    const reading = {
      sessionId: "s",
      toolName: "str_replace_editor",
      toolArgs: { command: "view", path: "/a.ts" },
    };
    expect(ledgeredCalls(reading)).toEqual([]);
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
