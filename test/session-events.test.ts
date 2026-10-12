import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent } from "../src/hooks/lib/events";
import {
  contextTokensOf,
  gitBranchOf,
  logCompaction,
  logSessionEnd,
  logSessionStart,
} from "../src/hooks/lib/session-events";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let home: string;
const T0 = new Date("2026-09-10T10:00:00.000Z");

function at(sec: number): Date {
  return new Date(T0.getTime() + sec * 1000);
}

function streamed(type: string): Record<string, unknown>[] {
  const file = resolve(home, "memory", "events", "2026-09.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("session boundaries", () => {
  test("a start records why it opened, the PAL version and the timezone", () => {
    logSessionStart({ session_id: "s1", source: "resume" }, T0);
    const [start] = streamed("session_start");
    expect(start).toMatchObject({ session: "s1", source: "resume" });
    expect(start?.palVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof start?.tz).toBe("string");
    expect(start?.utcOffsetMin).toBe(0 - T0.getTimezoneOffset());
  });

  test("an end records the reason and how long the session ran", () => {
    logSessionStart({ session_id: "other", source: "startup" }, T0);
    logSessionStart({ session_id: "s1", source: "startup" }, at(60));
    logSessionEnd({ session_id: "s1", reason: "prompt_input_exit" }, at(3660));
    expect(streamed("session_end")).toEqual([
      expect.objectContaining({
        session: "s1",
        reason: "prompt_input_exit",
        durationSec: 3600,
      }),
    ]);
  });

  test("an end without a known start has no duration", () => {
    logSessionEnd({ sessionId: "s2", reason: "other" }, T0);
    expect(streamed("session_end")[0]).toMatchObject({
      session: "s2",
      durationSec: null,
    });
  });

  test("a compaction records its trigger and whether it was steered", () => {
    logCompaction(
      { session_id: "s1", trigger: "manual", custom_instructions: "keep IDs" },
      T0
    );
    logCompaction({ session_id: "s1", trigger: "auto", custom_instructions: " " }, T0);
    expect(streamed("compaction").map((e) => [e.trigger, e.withInstructions])).toEqual([
      ["manual", true],
      ["auto", false],
    ]);
  });

  test("the compaction instructions themselves never reach the stream", () => {
    logCompaction(
      { session_id: "s1", trigger: "manual", custom_instructions: "keep IDs" },
      T0
    );
    expect(JSON.stringify(streamed("compaction"))).not.toContain("keep IDs");
  });
});

describe("what a session ran with", () => {
  test("a start records the model, effort, entrypoint and branch", () => {
    process.env.CLAUDE_EFFORT = "high";
    process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
    mkdirSync(resolve(home, "repo", ".git"), { recursive: true });
    writeFileSync(resolve(home, "repo", ".git", "HEAD"), "ref: refs/heads/feat/x\n");
    const cwd = process.cwd();
    process.chdir(resolve(home, "repo"));
    try {
      logSessionStart({ session_id: "s1", model: "claude-opus-5-5" }, T0);
    } finally {
      process.chdir(cwd);
      delete process.env.CLAUDE_EFFORT;
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
    }
    expect(streamed("session_start")[0]).toMatchObject({
      model: "claude-opus-5-5",
      effort: "high",
      entrypoint: "cli",
      branch: "feat/x",
    });
  });

  test("a worktree's branch is read through its gitdir pointer, a detached head says so", () => {
    const real = resolve(home, "real-git");
    mkdirSync(real, { recursive: true });
    writeFileSync(resolve(real, "HEAD"), "0123abcd\n");
    mkdirSync(resolve(home, "wt", "sub"), { recursive: true });
    writeFileSync(resolve(home, "wt", ".git"), `gitdir: ${real}\n`);
    expect(gitBranchOf(resolve(home, "wt", "sub"))).toBe("detached");
  });

  test("an end counts the session's turns", () => {
    logSessionStart({ session_id: "s1" }, T0);
    appendEvent("turn", { words: 3 }, { ts: at(10).toISOString(), session: "s1" });
    appendEvent("turn", { words: 3 }, { ts: at(20).toISOString(), session: "s1" });
    appendEvent("turn", { words: 3 }, { ts: at(30).toISOString(), session: "s2" });
    logSessionEnd({ session_id: "s1", reason: "other" }, at(60));
    expect(streamed("session_end")[0]).toMatchObject({ turns: 2, durationSec: 60 });
  });

  test("a compaction records how full the context was", () => {
    const transcript = resolve(home, "t.jsonl");
    const usage = (n: number) =>
      JSON.stringify({
        message: {
          usage: {
            input_tokens: n,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 10,
          },
        },
      });
    writeFileSync(transcript, `${usage(1)}\n${usage(5)}\n{"type":"user"}\n`);
    expect(contextTokensOf(transcript)).toBe(1015);
    expect(contextTokensOf(resolve(home, "missing.jsonl"))).toBeNull();
  });
});

// Shapes from each runtime's hook reference (cursor.com/docs/hooks,
// docs.github.com/en/copilot/reference/hooks-configuration,
// developers.openai.com/codex/hooks), not from captured runs.
describe("a compaction on every runtime that announces one", () => {
  test("Cursor hands over the token count itself", () => {
    logCompaction(
      {
        conversation_id: "cur1",
        hook_event_name: "preCompact",
        trigger: "auto",
        context_usage_percent: 85,
        context_tokens: 120000,
        context_window_size: 128000,
        message_count: 45,
        messages_to_compact: 30,
        is_first_compaction: true,
      } as Parameters<typeof logCompaction>[0],
      T0
    );
    expect(streamed("compaction")).toEqual([
      expect.objectContaining({
        session: "cur1",
        trigger: "auto",
        withInstructions: false,
        contextTokens: 120000,
      }),
    ]);
  });

  test("Copilot's camelCase keys are read like Claude's snake_case ones", () => {
    const transcript = resolve(home, "copilot.jsonl");
    writeFileSync(
      transcript,
      `${JSON.stringify({ message: { usage: { input_tokens: 42 } } })}\n`
    );
    logCompaction(
      {
        sessionId: "cop1",
        timestamp: T0.getTime(),
        cwd: "/work",
        transcriptPath: transcript,
        trigger: "manual",
        customInstructions: "keep IDs",
      } as Parameters<typeof logCompaction>[0],
      T0
    );
    expect(streamed("compaction")).toEqual([
      expect.objectContaining({
        session: "cop1",
        trigger: "manual",
        withInstructions: true,
        contextTokens: 42,
      }),
    ]);
  });

  test("Codex sends Claude's keys and may have no transcript", () => {
    logCompaction(
      {
        session_id: "cdx1",
        transcript_path: null,
        cwd: "/work",
        hook_event_name: "PreCompact",
        model: "gpt-5",
        turn_id: "t1",
        trigger: "auto",
      } as unknown as Parameters<typeof logCompaction>[0],
      T0
    );
    expect(streamed("compaction")).toEqual([
      expect.objectContaining({ session: "cdx1", trigger: "auto", contextTokens: null }),
    ]);
  });

  test("each of their templates runs the compaction hook on its own event name", () => {
    const template = (name: string) =>
      readFileSync(resolve(import.meta.dir, "../assets/templates", name), "utf-8");
    const registered = (name: string, event: string) =>
      JSON.stringify(JSON.parse(template(name)).hooks[event] ?? null);
    expect(registered("hooks.cursor.json", "preCompact")).toContain(
      "PreCompactPersist.ts --agent=cursor"
    );
    expect(registered("hooks.copilot.json", "preCompact")).toContain(
      "PreCompactPersist.ts --agent=copilot"
    );
    expect(registered("hooks.codex.json", "PreCompact")).toContain(
      "PreCompactPersist.ts --agent=codex"
    );
  });
});

describe("a broken event store never fails the hook", () => {
  test("every session logger swallows the failure", () => {
    writeFileSync(resolve(home, "memory", "events"), "not a folder");
    expect(() => {
      logSessionStart({ session_id: "s1", source: "startup" }, T0);
      logSessionEnd({ session_id: "s1", reason: "other" }, T0);
      logCompaction({ session_id: "s1", trigger: "auto" }, T0);
    }).not.toThrow();
  });
});

describe("the PreCompact hook", () => {
  test("logs the compaction when the agent runs it", async () => {
    const proc = Bun.spawn(
      ["bun", resolve(import.meta.dir, "../src/hooks/PreCompactPersist.ts")],
      {
        stdin: new TextEncoder().encode(
          JSON.stringify({ session_id: "s9", trigger: "auto" })
        ),
        env: { ...process.env, PAL_HOME: home },
        stdout: "ignore",
        stderr: "ignore",
      }
    );
    await proc.exited;
    const month = new Date().toISOString().slice(0, 7);
    const lines = readFileSync(
      resolve(home, "memory", "events", `${month}.jsonl`),
      "utf-8"
    );
    expect(lines).toContain('"type":"compaction"');
    expect(lines).toContain('"session":"s9"');
  });
});
