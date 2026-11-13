import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { recordIdleCompactionNear } from "../src/hooks/lib/compaction-near";
import { eventsSince } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const IDLE_ENV = "CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS";
let home: string;
let since: Date;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_CLAUDE_DIR = resolve(home, "claude-dir");
  process.env.PAL_AGENT = "claude";
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env[IDLE_ENV];
  mkdirSync(resolve(home, "memory"), { recursive: true });
  mkdirSync(resolve(home, "claude-dir"), { recursive: true });
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

describe("recordIdleCompactionNear with idleCompaction false", () => {
  test("a Claude Code settings file with idleCompaction false logs no idle event, however often the hook runs", () => {
    writeFileSync(
      resolve(home, "claude-dir", "settings.json"),
      JSON.stringify({ idleCompaction: false })
    );
    const payload = {
      session_id: "sess-1",
      transcript_path: transcriptWith("t.jsonl", 250_000),
    };
    recordIdleCompactionNear(payload);
    recordIdleCompactionNear(payload);
    expect(eventsSince("compaction_near", since)).toEqual([]);
  });
});
