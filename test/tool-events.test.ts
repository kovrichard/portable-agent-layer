import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPostToolHandlers } from "../src/hooks/lib/post-tool";
import { reload } from "../src/hooks/lib/settings";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { logToolCall } from "../src/hooks/lib/tool-events";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

let home: string;

function month(): string {
  return new Date().toISOString().slice(0, 7);
}

function lines(dir: string[]): Record<string, unknown>[] {
  const file = resolve(home, "memory", ...dir, `${month()}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

function toolCalls(): Record<string, unknown>[] {
  return lines(["events"]).filter((e) => e.type === "tool_call");
}

beforeEach(() => {
  delete process.env[SPAWN_GUARD_ENV.SENTINEL];
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("a tool call", () => {
  test("records the tool, its ending and its sizes", () => {
    logToolCall({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/somewhere/notes.md" },
      tool_response: "four",
      duration_ms: 12,
    });
    expect(toolCalls()[0]).toMatchObject({
      session: "s1",
      tool: "Read",
      outcome: "ok",
      durationMs: 12,
      outputChars: 4,
      fileExt: ".md",
    });
  });

  test("names the skill, the subagent and its run, the MCP server and the web host", () => {
    logToolCall({ tool_name: "Skill", tool_input: { skill: "research" } });
    logToolCall({
      tool_name: "Agent",
      tool_input: { subagent_type: "Explore", prompt: "map it" },
      tool_response: { totalDurationMs: 9000, totalTokens: 1200, totalToolUseCount: 7 },
    });
    logToolCall({ tool_name: "mcp__claude_ai_Gmail__search", tool_input: {} });
    logToolCall({ tool_name: "WebFetch", tool_input: { url: "https://bun.sh/docs" } });
    const [skill, agent, mcp, web] = toolCalls();
    expect(skill?.skill).toBe("research");
    expect(agent).toMatchObject({
      subagent: "Explore",
      durationMs: 9000,
      subagentTokens: 1200,
      subagentTools: 7,
    });
    expect(mcp?.mcpServer).toBe("claude_ai_Gmail");
    expect(web?.host).toBe("bun.sh");
  });

  test("a shell call records only the program it ran", () => {
    logToolCall({
      tool_name: "Bash",
      tool_input: { command: "  /usr/bin/git push --force" },
    });
    logToolCall({ toolName: "bash", toolArgs: '{"command":"bun test x"}' });
    expect(toolCalls().map((e) => e.program)).toEqual(["git", "bun"]);
  });

  test("a failed and a denied call say so", () => {
    logToolCall({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", error: "x" });
    logToolCall({ hook_event_name: "PermissionDenied", tool_name: "Bash", reason: "no" });
    expect(toolCalls().map((e) => e.outcome)).toEqual(["failed", "denied"]);
  });

  test("reads Copilot's camelCase payload and Antigravity's nested call", () => {
    logToolCall({ sessionId: "c1", toolName: "bash", toolArgs: '{"command":"ls"}' });
    logToolCall({
      conversationId: "a1",
      toolCall: { name: "write_to_file", args: { TargetFile: "/x/a.ts" } },
      error: "disk full",
    });
    expect(toolCalls()).toEqual([
      expect.objectContaining({ session: "c1", tool: "bash", outcome: "ok" }),
      expect.objectContaining({
        session: "a1",
        tool: "write_to_file",
        outcome: "failed",
        fileExt: ".ts",
      }),
    ]);
  });

  test("the arguments go to the content store, never the stream", () => {
    logToolCall({ tool_name: "Bash", tool_input: { command: "echo secret-ish words" } });
    expect(JSON.stringify(toolCalls())).not.toContain("secret-ish");
    expect(JSON.stringify(lines(["content", "events"]))).toContain("secret-ish");
  });

  test("a payload that names no tool is ignored", () => {
    logToolCall({ session_id: "s1", prompt: "hi" });
    logToolCall(null);
    expect(toolCalls()).toEqual([]);
  });

  test("the post-tool hook logs it unless its registration is ledger-only", () => {
    const call = (session: string) => ({ session_id: session, tool_name: "Grep" });
    runPostToolHandlers(call("all"), [
      "bun",
      "PostToolOrchestrator.ts",
      "--agent=cursor",
    ]);
    runPostToolHandlers(call("ledger"), [
      "bun",
      "PostToolOrchestrator.ts",
      "--only=ledger",
    ]);
    runPostToolHandlers(call("events"), [
      "bun",
      "PostToolOrchestrator.ts",
      "--only=events",
    ]);
    expect(toolCalls().map((e) => e.session)).toEqual(["all", "events"]);
  });

  test("a call made inside PAL's own inference is not the user's, and is not logged", () => {
    process.env[SPAWN_GUARD_ENV.SENTINEL] = "1";
    logToolCall({ tool_name: "Read", tool_input: {} });
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    expect(toolCalls()).toEqual([]);
  });

  test("a broken event store never fails the hook", () => {
    writeFileSync(resolve(home, "memory", "events"), "not a folder");
    expect(() => logToolCall({ tool_name: "Read", tool_input: {} })).not.toThrow();
  });
});

describe("the PostToolOrchestrator hook", () => {
  test("logs the call, prints nothing and exits 0", async () => {
    const proc = Bun.spawn(
      ["bun", resolve(import.meta.dir, "../src/hooks/PostToolOrchestrator.ts")],
      {
        stdin: new TextEncoder().encode(
          JSON.stringify({ session_id: "s9", tool_name: "Grep", tool_input: {} })
        ),
        env: { ...process.env, PAL_HOME: home },
        stdout: "pipe",
        stderr: "ignore",
      }
    );
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stdout).text()).toBe("");
    expect(toolCalls()[0]).toMatchObject({ session: "s9", tool: "Grep" });
  });

  test("exits 0 even when the event store is broken", async () => {
    writeFileSync(resolve(home, "memory", "events"), "not a folder");
    const proc = Bun.spawn(
      ["bun", resolve(import.meta.dir, "../src/hooks/PostToolOrchestrator.ts")],
      {
        stdin: new TextEncoder().encode(JSON.stringify({ tool_name: "Grep" })),
        env: { ...process.env, PAL_HOME: home },
        stdout: "ignore",
        stderr: "ignore",
      }
    );
    expect(await proc.exited).toBe(0);
  });
});
