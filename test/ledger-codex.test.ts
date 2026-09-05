import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ledgeredCalls } from "../src/hooks/lib/ledger-hook";
import { loadCodexHooksTemplate, mergeCodexHooks } from "../src/targets/lib";

const TEMPLATE = resolve(import.meta.dir, "../assets/templates/hooks.codex.json");
const PKG_ROOT = "/pkg";

// Codex ships apply_patch hook events since 0.123.0 (PR #18391), which put the
// patch body at tool_input.command rather than sending it as the arguments.
const CODEX_PATCH = {
  session_id: "2f1c9d3e-7a44-4b21-9c08-6d5e1f0a3b77",
  cwd: "/work/app",
  hook_event_name: "PreToolUse",
  tool_name: "apply_patch",
  tool_input: {
    command:
      "*** Begin Patch\n*** Update File: existing.txt\n@@\n-a\n+A\n*** Add File: fresh.txt\n+new\n*** End Patch\n",
  },
};

const targetsOf = (payload: Record<string, unknown>) =>
  ledgeredCalls(payload).map((call) => call.target);

const inCwd = (name: string) => resolve(CODEX_PATCH.cwd, name);

function commands(): { event: string; command: string }[] {
  const cfg = loadCodexHooksTemplate(TEMPLATE, PKG_ROOT) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  return Object.entries(cfg.hooks).flatMap(([event, groups]) =>
    groups.flatMap((g) => g.hooks.map((h) => ({ event, command: h.command })))
  );
}

describe("Codex sends the patch under a command key, not as the arguments", () => {
  test("every file the patch names becomes a target", () => {
    expect(targetsOf(CODEX_PATCH)).toEqual([inCwd("existing.txt"), inCwd("fresh.txt")]);
  });

  /** The fix landed with "the proper tool_name" but did not pin its spelling. */
  test("the tool is recognised whichever way its name is cased", () => {
    const cased = { ...CODEX_PATCH, tool_name: "ApplyPatch" };
    expect(targetsOf(cased)).toEqual([inCwd("existing.txt"), inCwd("fresh.txt")]);
  });

  test("a patch naming no file records nothing", () => {
    const empty = {
      ...CODEX_PATCH,
      tool_input: { command: "*** Begin Patch\n*** End Patch\n" },
    };
    expect(ledgeredCalls(empty)).toEqual([]);
  });

  test("a command that is not a patch records nothing", () => {
    const shell = {
      ...CODEX_PATCH,
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    };
    expect(ledgeredCalls(shell)).toEqual([]);
  });

  test("both halves derive the same key, so a snapshot is claimable", () => {
    const post = { ...CODEX_PATCH, hook_event_name: "PostToolUse" };
    const keys = ledgeredCalls(post).map((c) => c.toolUseId);
    expect(keys.length).toBe(2);
    expect(keys).toEqual(ledgeredCalls(CODEX_PATCH).map((c) => c.toolUseId));
  });

  /** Copilot sends the same patch format as raw text; reading a key must not break it. */
  test("a patch sent as raw text still reads, which is how Copilot sends it", () => {
    const raw = {
      sessionId: "b1",
      cwd: "/work/app",
      toolName: "apply_patch",
      toolArgs: "*** Begin Patch\n*** Add File: fresh.txt\n+new\n*** End Patch\n",
    };
    expect(targetsOf(raw)).toEqual([inCwd("fresh.txt")]);
  });
});

describe("the Codex hooks template", () => {
  test("snapshots before a tool runs and commits after it", () => {
    const ledger = commands()
      .filter((c) => c.command.includes("Ledger"))
      .map((c) => `${c.event} ${c.command.split("/").pop()}`);
    expect(ledger).toEqual([
      "PreToolUse LedgerSnapshot.ts --agent=codex",
      "PostToolUse LedgerCommit.ts --agent=codex",
    ]);
  });

  test("names the agent on argv, since a shell env prefix never reached the process", () => {
    for (const { command } of commands()) {
      expect(command).toContain("--agent=codex");
      expect(command).not.toContain("PAL_AGENT=");
    }
  });

  /**
   * Codex publishes neither PostToolUseFailure nor PermissionDenied (its own
   * parity tracker lists both as missing), so wiring LedgerUnapplied would
   * register a hook that never fires and imply an outcome PAL cannot observe.
   */
  test("records no failure outcome, because Codex publishes no failure event", () => {
    expect(commands().map((c) => c.event)).not.toContain("PostToolUseFailure");
    expect(commands().every((c) => !c.command.includes("LedgerUnapplied"))).toBe(true);
  });

  test("still runs the security gate before the snapshot", () => {
    const pre = commands().filter((c) => c.event === "PreToolUse");
    expect(pre.findIndex((c) => c.command.includes("SecurityValidator"))).toBeLessThan(
      pre.findIndex((c) => c.command.includes("LedgerSnapshot"))
    );
  });
});

describe("upgrading a Codex install that predates the agent flag", () => {
  const upgraded = () =>
    mergeCodexHooks(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "PAL_AGENT=codex bun run /old/src/hooks/LoadContext.ts",
                },
              ],
            },
          ],
          Stop: [{ hooks: [{ type: "command", command: "my-own-linter" }] }],
        },
      },
      loadCodexHooksTemplate(TEMPLATE, PKG_ROOT) as never
    ) as { hooks: Record<string, { hooks: { command: string }[] }[]> };

  const merged = () =>
    Object.values(upgraded().hooks).flatMap((groups) =>
      groups.flatMap((g) => g.hooks.map((h) => h.command))
    );

  /** Two registrations of one hook is the Cursor double-fire, reproduced on Codex. */
  test("replaces the old registration instead of running both", () => {
    expect(merged().filter((c) => c.includes("LoadContext.ts")).length).toBe(1);
  });

  test("leaves a hook the user wrote themselves alone", () => {
    expect(merged()).toContain("my-own-linter");
  });

  /**
   * Codex rejects the whole file on an unknown top-level field, so a stale
   * version silently disables every PAL hook: "unknown field `version`,
   * expected `description` or `hooks`".
   */
  test("drops a stale version field that would make Codex reject the file", () => {
    const healed = mergeCodexHooks(
      { version: 1, hooks: {} } as never,
      loadCodexHooksTemplate(TEMPLATE, PKG_ROOT) as never
    );
    expect(Object.keys(healed)).not.toContain("version");
  });

  test("keeps a description, which Codex does accept", () => {
    const healed = mergeCodexHooks(
      { description: "mine", hooks: {} } as never,
      loadCodexHooksTemplate(TEMPLATE, PKG_ROOT) as never
    ) as { description?: string };
    expect(healed.description).toBe("mine");
  });
});

describe("every Codex hooks config this repo ships", () => {
  const REPO_GATES = resolve(import.meta.dir, "../.codex/hooks.json");

  function rejectedKeys(path: string): string[] {
    const keys = Object.keys(JSON.parse(readFileSync(path, "utf-8")));
    return keys.filter((key) => key !== "hooks" && key !== "description");
  }

  test("the shipped template uses only the fields Codex accepts", () => {
    expect(rejectedKeys(TEMPLATE)).toEqual([]);
  });

  /** Stryker's sandbox omits .codex, a symlink farm its file copy cannot follow. */
  test.skipIf(!existsSync(REPO_GATES))("so does this repo's own gates config", () => {
    expect(rejectedKeys(REPO_GATES)).toEqual([]);
  });
});
