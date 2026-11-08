import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPACTION_NEAR_THRESHOLD,
  compactionPredicted,
  recordCompactionNear,
} from "../src/hooks/lib/compaction-near";
import { EVENT_FIELDS, eventsSince } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const WINDOW_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
let home: string;
let since: Date;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env[WINDOW_ENV];
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(resolve(home, "memory", "pal-settings.json"), "{}");
  reload();
  since = new Date(Date.now() - 1000);
});

function transcriptWith(name: string, tokens: number): string {
  const path = resolve(home, name);
  const usage = { input_tokens: 10, cache_read_input_tokens: tokens - 10 };
  writeFileSync(path, `${JSON.stringify({ message: { usage } })}\n`);
  return path;
}

function prompt(transcript_path: string) {
  return { session_id: "sess-1", transcript_path };
}

const written = () => eventsSince("compaction_near", since);

describe("recordCompactionNear", () => {
  test("logs a shadow event predicting compaction at 250k with the window set", () => {
    process.env[WINDOW_ENV] = "500000";
    recordCompactionNear(prompt(transcriptWith("t.jsonl", 250_000)));
    const events = written();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "compaction_near",
      mode: "shadow",
      session: "sess-1",
      contextTokens: 250_000,
      thresholdTokens: COMPACTION_NEAR_THRESHOLD,
      windowTokens: 500_000,
      predicted: true,
    });
  });

  test("predicts nothing at 100k", () => {
    process.env[WINDOW_ENV] = "500000";
    recordCompactionNear(prompt(transcriptWith("t.jsonl", 100_000)));
    expect(written()[0]).toMatchObject({ contextTokens: 100_000, predicted: false });
  });

  test("windowTokens is null when the variable is unset or not a number", () => {
    const transcript = transcriptWith("t.jsonl", 250_000);
    recordCompactionNear(prompt(transcript));
    process.env[WINDOW_ENV] = "lots";
    recordCompactionNear(prompt(transcript));
    const events = written();
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({ windowTokens: null, predicted: true });
    }
  });

  test("writes nothing when the transcript is missing", () => {
    recordCompactionNear(prompt(resolve(home, "absent.jsonl")));
    recordCompactionNear({ session_id: "sess-1" });
    expect(written()).toEqual([]);
  });

  test("writes nothing when the transcript has no usage", () => {
    const path = resolve(home, "empty.jsonl");
    writeFileSync(path, `${JSON.stringify({ message: { content: "hi" } })}\n`);
    recordCompactionNear(prompt(path));
    expect(written()).toEqual([]);
  });

  test("writes nothing in a PAL-spawned inference", () => {
    process.env.PAL_SPAWNED_INFERENCE = "1";
    recordCompactionNear(prompt(transcriptWith("t.jsonl", 250_000)));
    expect(written()).toEqual([]);
  });
});

describe("the shared rule", () => {
  test("the threshold is 200000 and predicted means at or over it", () => {
    expect(COMPACTION_NEAR_THRESHOLD).toBe(200_000);
    expect(compactionPredicted(COMPACTION_NEAR_THRESHOLD)).toBe(true);
    expect(compactionPredicted(COMPACTION_NEAR_THRESHOLD - 1)).toBe(false);
  });

  test("compaction_near is registered with exactly its fields", () => {
    expect([...EVENT_FIELDS.compaction_near].map(String).sort()).toEqual(
      ["contextTokens", "mode", "predicted", "thresholdTokens", "windowTokens"].sort()
    );
  });
});
