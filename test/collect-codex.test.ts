import { beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import { collectCodex } from "../src/tools/lib/collectors/codex";
import { freshTestDir } from "./lib/test-home";

// Line shapes from a real Codex rollout (keys only): session_meta, then a
// turn_context per turn, then a token_count per call, sometimes repeated.

let home: string;
let codexDir: string;
let rollout: string;

function streamed(): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "model_call");
}

const sessionMeta = JSON.stringify({
  timestamp: "2026-10-12T10:00:00.000Z",
  type: "session_meta",
  payload: { session_id: "thr_1", cwd: "/work/repo", model_provider: "openai" },
});

const turnContext = JSON.stringify({
  timestamp: "2026-10-12T10:00:01.000Z",
  type: "turn_context",
  payload: { model: "gpt-6-codex", effort: "high" },
});

function tokenCount(total: number, output = 162) {
  return JSON.stringify({
    timestamp: "2026-10-12T10:00:02.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: {
          input_tokens: 16074,
          cached_input_tokens: 20,
          cache_write_input_tokens: 16039,
          output_tokens: output,
          reasoning_output_tokens: 103,
          total_tokens: 16236,
        },
      },
    },
  });
}

function write(...lines: string[]) {
  appendFileSync(rollout, `${lines.join("\n")}\n`);
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  codexDir = resolve(home, "codex");
  const day = resolve(codexDir, "sessions", "2026", "10", "12");
  mkdirSync(day, { recursive: true });
  rollout = resolve(day, "rollout-2026-10-12T10-00-00-thr_1.jsonl");
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("collecting Codex's model calls", () => {
  test("a token_count is one model_call in the session and turn it belongs to", () => {
    write(sessionMeta, turnContext, tokenCount(16236));
    expect(collectCodex(codexDir)).toBe(1);
    expect(streamed()[0]).toMatchObject({
      ts: "2026-10-12T10:00:02.000Z",
      session: "thr_1",
      runtime: "codex",
      cwd: "/work/repo",
      model: "gpt-6-codex",
      provider: "openai",
      effort: "high",
      inputTokens: 15,
      outputTokens: 162,
      thinkingTokens: 103,
      cacheWrite5m: 16039,
      cacheRead: 20,
    });
  });

  test("a repeated token_count is not a second call", () => {
    write(sessionMeta, turnContext, tokenCount(100), tokenCount(100), tokenCount(200));
    expect(collectCodex(codexDir)).toBe(2);
  });

  test("a second run emits nothing the first one did", () => {
    write(sessionMeta, turnContext, tokenCount(100));
    collectCodex(codexDir);
    expect(collectCodex(codexDir)).toBe(0);
    write(tokenCount(200, 7));
    expect(collectCodex(codexDir)).toBe(1);
    expect(streamed().map((e) => e.outputTokens)).toEqual([162, 7]);
  });

  test("a line still being written is read once it is whole", () => {
    write(sessionMeta, turnContext);
    appendFileSync(rollout, tokenCount(100).slice(0, 40));
    expect(collectCodex(codexDir)).toBe(0);
    appendFileSync(rollout, `${tokenCount(100).slice(40)}\n`);
    expect(collectCodex(codexDir)).toBe(1);
  });

  test("no Codex directory, nothing collected", () => {
    expect(collectCodex(resolve(home, "missing"))).toBe(0);
  });
});
