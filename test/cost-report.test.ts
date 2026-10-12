import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsSince, type LoggedEvent } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { collectClaude } from "../src/tools/lib/collectors/claude";
import { costLines, costMonths } from "../src/tools/lib/cost-report";
import { readClaudeCode } from "../src/tools/lib/usage-buckets";
import { freshTestDir } from "./lib/test-home";

const NOW = new Date("2026-10-20T00:00:00.000Z");
const LONG_AGO = new Date("2026-10-01T00:00:00.000Z");

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  reload();
});

function assistant(
  id: string,
  model: string,
  ts: string,
  usage: Record<string, unknown>
) {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    sessionId: "ses-1",
    cwd: home,
    message: { id, model, usage },
  });
}

function claudeMonth(): string {
  const projects = resolve(home, "claude", "projects");
  const transcript = resolve(projects, "-work-repo", "s.jsonl");
  mkdirSync(resolve(transcript, ".."), { recursive: true });
  const lines = [
    assistant("m1", "claude-opus-5-5", "2026-10-02T10:00:00.000Z", {
      input_tokens: 1200,
      output_tokens: 800,
      cache_read_input_tokens: 50_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 3000,
        ephemeral_1h_input_tokens: 9000,
      },
    }),
    assistant("m2", "claude-sonnet-5-5", "2026-10-03T10:00:00.000Z", {
      input_tokens: 400,
      output_tokens: 2000,
      cache_read_input_tokens: 12_000,
    }),
    assistant("m3", "claude-haiku-5-5", "2026-10-04T10:00:00.000Z", {
      input_tokens: 90,
      output_tokens: 30,
    }),
  ];
  writeFileSync(transcript, `${lines.join("\n")}\n`);
  utimesSync(transcript, LONG_AGO, LONG_AGO);
  return projects;
}

function call(fields: Partial<LoggedEvent> & Record<string, unknown>): LoggedEvent {
  return {
    v: 1,
    id: crypto.randomUUID(),
    ts: "2026-10-02T10:00:00.000Z",
    type: "model_call",
    session: "ses-1",
    runtime: "claude",
    machine: "m",
    actor: "a",
    authority: "user",
    channel: null,
    project: null,
    cwd: "/work",
    model: "claude-opus-5-5",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    ...fields,
  } as LoggedEvent;
}

const MAX_5X = {
  billing: "subscription",
  plan: "default_claude_max_5x",
  extraUsage: false,
};
const label = (runtime: string) => runtime;

describe("a month in the event log costs what pal cli usage says", () => {
  test("the same transcripts price identically either way", () => {
    const projects = claudeMonth();
    const usage = readClaudeCode(projects, undefined, NOW).buckets.total;
    collectClaude(projects, NOW);
    const month = costMonths(eventsSince("model_call", new Date(0)))
      .get("2026-10")
      ?.get("claude");
    expect(usage.calls).toBe(3);
    expect(month?.calls).toBe(3);
    expect(month?.apiEquivalent).toBeCloseTo(usage.cost, 10);
  });
});

describe("subscription against API-equivalent, per agent and month", () => {
  test("a subscription month is paid at its plan price, with the leverage over it", () => {
    const lines = costLines(costMonths([call(MAX_5X), call(MAX_5X)]), label);
    expect(lines.join("\n")).toContain(
      "paid $100.00   API-equivalent $48.00   leverage 0.5x"
    );
  });

  test("an API-billed month paid exactly its API price", () => {
    const lines = costLines(
      costMonths([call({ billing: "api", plan: null, extraUsage: null })]),
      label
    );
    expect(lines.join("\n")).toContain(
      "paid $24.00   API-equivalent $24.00   leverage 1.0x"
    );
  });

  test("extra usage leaves what was paid open, and the leverage a ceiling", () => {
    const lines = costLines(costMonths([call({ ...MAX_5X, extraUsage: true })]), label);
    expect(lines.join("\n")).toContain(
      "paid $100.00 + extra usage (unknown)   API-equivalent $24.00   leverage up to 0.2x"
    );
  });

  test("an unknown billing, plan or price is shown as unknown, never as $0", () => {
    const text = costLines(
      costMonths([
        call({ billing: "unknown", plan: null }),
        call({ runtime: "codex", model: "gpt-6", billing: "subscription", plan: null }),
        call({ ...MAX_5X, ts: "2025-01-02T10:00:00.000Z" }),
      ]),
      label
    ).join("\n");
    expect(text).toContain("claude           paid unknown   API-equivalent $24.00\n");
    expect(text).toContain("codex            paid unknown   API-equivalent unknown");
    expect(text).not.toContain("$0.00");
    expect(text).not.toContain("leverage");
  });

  test("months come oldest first, each with its own agents", () => {
    const lines = costLines(
      costMonths([
        call(MAX_5X),
        call({ ...MAX_5X, runtime: "opencode", ts: "2026-09-02T10:00:00.000Z" }),
      ]),
      label
    );
    expect(
      lines
        .filter((line) => /^\n {2}20|^ {4}\w/.test(line))
        .map((l) => l.trim().split(" ")[0])
    ).toEqual(["2026-09", "opencode", "2026-10", "claude"]);
  });
});
