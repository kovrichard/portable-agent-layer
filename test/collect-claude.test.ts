import { beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { agentDirOverrides } from "../src/hooks/lib/paths";
import { reload } from "../src/hooks/lib/settings";
import { collectEvents } from "../src/tools/lib/collectors";
import { collectClaude } from "../src/tools/lib/collectors/claude";
import { freshTestDir } from "./lib/test-home";

// Line shape from Claude Code transcripts: one line per content block, each
// repeating the message's usage, tool results written between them.

let home: string;
let projects: string;
let transcript: string;

const LATER = new Date("2099-01-01T00:00:00.000Z");
const NOW = () => new Date();

function streamed(): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "model_call");
}

function block(id: string, output: number, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-10-12T10:00:00.000Z",
    sessionId: "ses-1",
    cwd: home,
    isSidechain: false,
    effort: "medium",
    entrypoint: "cli",
    requestedModel: "claude-opus-5-5",
    thinkingDurationMs: 1200,
    message: {
      id,
      model: "claude-opus-5-5",
      stop_reason: "tool_use",
      usage: {
        input_tokens: 4,
        output_tokens: output,
        cache_read_input_tokens: 900,
        cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 7 },
        output_tokens_details: { thinking_tokens: 50 },
        server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
        service_tier: "standard",
        speed: "standard",
      },
    },
    ...extra,
  });
}

const toolResult = JSON.stringify({ type: "user", message: { content: [] } });

function write(...lines: string[]) {
  appendFileSync(transcript, `${lines.join("\n")}\n`);
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "codex";
  projects = resolve(home, "claude", "projects");
  mkdirSync(resolve(projects, "-repo"), { recursive: true });
  transcript = resolve(projects, "-repo", "s.jsonl");
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("collecting Claude Code's model calls", () => {
  test("a message is one model_call, at the usage of its last line", () => {
    write(block("msg_1", 3), toolResult, block("msg_1", 818), block("msg_2", 40));
    expect(collectClaude(projects, LATER)).toBe(2);
    const [first] = streamed();
    expect(first).toMatchObject({
      ts: "2026-10-12T10:00:00.000Z",
      session: "ses-1",
      runtime: "claude",
      model: "claude-opus-5-5",
      requestedModel: "claude-opus-5-5",
      inputTokens: 4,
      outputTokens: 818,
      cacheWrite5m: 30,
      cacheWrite1h: 7,
      cacheRead: 900,
      thinkingTokens: 50,
      thinkingMs: 1200,
      webSearches: 1,
      webFetches: 2,
      serviceTier: "standard",
      speed: "standard",
      effort: "medium",
      stopReason: "tool_use",
      entrypoint: "cli",
      sidechain: false,
    });
  });

  test("a second run emits nothing the first one did", () => {
    write(block("msg_1", 10), block("msg_2", 20));
    collectClaude(projects, LATER);
    expect(collectClaude(projects, LATER)).toBe(0);
    expect(streamed()).toHaveLength(2);
  });

  test("only what was appended since the last run is emitted", () => {
    write(block("msg_1", 10));
    collectClaude(projects, LATER);
    write(block("msg_2", 20));
    expect(collectClaude(projects, LATER)).toBe(1);
    expect(streamed().map((e) => e.outputTokens)).toEqual([10, 20]);
  });

  test("the newest message of a file still being written waits for the next run", () => {
    write(block("msg_1", 10), block("msg_2", 3));
    expect(collectClaude(projects, NOW())).toBe(1);
    write(toolResult, block("msg_2", 500), block("msg_3", 7));
    expect(collectClaude(projects, NOW())).toBe(1);
    expect(collectClaude(projects, LATER)).toBe(1);
    expect(streamed().map((e) => e.outputTokens)).toEqual([10, 500, 7]);
  });

  test("a line without usage or without a model is not a call", () => {
    write(
      toolResult,
      JSON.stringify({ type: "assistant", message: { usage: {} } }),
      "{bad"
    );
    expect(collectClaude(projects, LATER)).toBe(0);
  });

  test("the cursor is kept per source under memory/state", () => {
    write(block("msg_1", 10));
    collectClaude(projects, LATER);
    const cursors = JSON.parse(
      readFileSync(resolve(home, "memory", "state", "collector-cursors.json"), "utf-8")
    );
    expect(cursors.claude["-repo/s.jsonl"]).toBe(readFileSync(transcript).length);
  });
});

describe("collecting every source", () => {
  test("a source that fails is reported and the others still collect", () => {
    const overrides = [...agentDirOverrides().map(({ env }) => env), "XDG_DATA_HOME"];
    for (const env of overrides) process.env[env] = resolve(home, env);
    process.env.PAL_CLAUDE_DIR = resolve(home, "claude");
    mkdirSync(resolve(home, "XDG_DATA_HOME", "opencode", "opencode.db"), {
      recursive: true,
    });
    write(block("msg_1", 10), block("msg_2", 20));
    try {
      expect(collectEvents()).toEqual({ claude: 1, opencode: "failed", codex: 0 });
    } finally {
      for (const env of overrides) delete process.env[env];
    }
  });

  test("collects nothing while the event log is off", () => {
    writeFileSync(
      resolve(home, "memory", "pal-settings.json"),
      JSON.stringify({ eventLog: { enabled: false } })
    );
    reload();
    expect(collectEvents()).toEqual({});
  });
});
