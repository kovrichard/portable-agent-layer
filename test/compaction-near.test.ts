import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPACTION_MARGIN_FRACTION,
  compactionPoint,
  compactionPredicted,
  recordCompactionNear,
  recordIdleCompactionNear,
  resolveCompactionWindow,
} from "../src/hooks/lib/compaction-near";
import { EVENT_FIELDS, eventsSince } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const WINDOW_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
const IDLE_ENV = "CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS";
let home: string;
let since: Date;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_CLAUDE_DIR = resolve(home, "claude-dir");
  process.env.PAL_AGENT = "claude";
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env[WINDOW_ENV];
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

function payloadFor(transcript_path: string) {
  return { session_id: "sess-1", transcript_path };
}

const written = () => eventsSince("compaction_near", since);

describe("compactionPoint", () => {
  test.each([
    [300_000, 1_000_000, 64_000, 267_000],
    [500_000, 1_000_000, 64_000, 467_000],
    [500_000, 200_000, 64_000, 167_000],
    [500_000, 1_000_000, 8_000, 500_000 - 8_000 - 13_000],
  ])("window %i, model %i, max output %i gives %i", (window, ctx, out, expected) => {
    expect(
      compactionPoint({
        window,
        modelContextWindow: ctx,
        modelMaxOutput: out,
      })
    ).toBe(expected);
  });
});

describe("compactionPredicted", () => {
  test("is true at or under the margin and false above it", () => {
    expect(COMPACTION_MARGIN_FRACTION).toBe(0.2);
    expect(compactionPredicted(96_000, 96_000)).toBe(true);
    expect(compactionPredicted(1, 96_000)).toBe(true);
    expect(compactionPredicted(-5, 96_000)).toBe(true);
    expect(compactionPredicted(96_001, 96_000)).toBe(false);
  });
});

describe("resolveCompactionWindow", () => {
  function files() {
    const settings = resolve(home, "settings.json");
    const claudeJson = resolve(home, "claude.json");
    return { settings, claudeJson };
  }
  const base = { model: "claude-opus-5-5", modelContextWindow: 1_000_000 };

  test("settings autoCompactWindow wins over the env var", () => {
    const { settings, claudeJson } = files();
    writeFileSync(settings, JSON.stringify({ autoCompactWindow: 400_000 }));
    expect(
      resolveCompactionWindow({
        ...base,
        env: { [WINDOW_ENV]: "500000" },
        settingsFiles: [resolve(home, "absent.json"), settings],
        claudeJsonPath: claudeJson,
      })
    ).toEqual({ tokens: 400_000, source: "settings" });
  });

  test("the env var is used when no settings file has a window", () => {
    const { settings, claudeJson } = files();
    writeFileSync(settings, "{}");
    writeFileSync(
      claudeJson,
      JSON.stringify({ autoCompactWindowsCache: { "claude-opus-5-5": 350_000 } })
    );
    expect(
      resolveCompactionWindow({
        ...base,
        env: { [WINDOW_ENV]: "500000" },
        settingsFiles: [settings],
        claudeJsonPath: claudeJson,
      })
    ).toEqual({ tokens: 500_000, source: "env" });
  });

  test("a non-numeric env var is skipped for the next source", () => {
    const { claudeJson } = files();
    writeFileSync(
      claudeJson,
      JSON.stringify({ autoCompactWindowsCache: { "claude-opus-5-5": 350_000 } })
    );
    expect(
      resolveCompactionWindow({
        ...base,
        env: { [WINDOW_ENV]: "lots" },
        settingsFiles: [],
        claudeJsonPath: claudeJson,
      })
    ).toEqual({ tokens: 350_000, source: "cache" });
  });

  test("the model's context window is the last source", () => {
    expect(
      resolveCompactionWindow({
        ...base,
        env: {},
        settingsFiles: [],
        claudeJsonPath: resolve(home, "absent.json"),
      })
    ).toEqual({ tokens: 1_000_000, source: "model" });
  });
});

describe("recordCompactionNear (UserPromptSubmit)", () => {
  test("400k with a 500k window predicts compaction", () => {
    process.env[WINDOW_ENV] = "500000";
    recordCompactionNear(payloadFor(transcriptWith("t.jsonl", 400_000)));
    const events = written();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "compaction_near",
      mode: "shadow",
      trigger: "threshold",
      session: "sess-1",
      contextTokens: 400_000,
      windowTokens: 500_000,
      windowSource: "env",
      compactAtTokens: 467_000,
      tokensLeft: 67_000,
      marginTokens: 96_000,
      predicted: true,
    });
  });

  test("300k with a 500k window does not", () => {
    process.env[WINDOW_ENV] = "500000";
    recordCompactionNear(payloadFor(transcriptWith("t.jsonl", 300_000)));
    expect(written()[0]).toMatchObject({
      contextTokens: 300_000,
      tokensLeft: 167_000,
      predicted: false,
    });
  });

  test("the session is null when the payload has none", () => {
    process.env[WINDOW_ENV] = "500000";
    recordCompactionNear({ transcript_path: transcriptWith("t.jsonl", 300_000) });
    expect(written()).toHaveLength(1);
    expect(written()[0]?.session).toBeNull();
  });

  test("writes nothing when the transcript is missing", () => {
    process.env[WINDOW_ENV] = "500000";
    recordCompactionNear(payloadFor(resolve(home, "absent.jsonl")));
    recordCompactionNear({ session_id: "sess-1" });
    expect(written()).toEqual([]);
  });

  test("writes nothing when the transcript has no usage", () => {
    process.env[WINDOW_ENV] = "500000";
    const path = resolve(home, "empty.jsonl");
    writeFileSync(path, `${JSON.stringify({ message: { content: "hi" } })}\n`);
    recordCompactionNear(payloadFor(path));
    expect(written()).toEqual([]);
  });

  test("writes nothing in a PAL-spawned inference", () => {
    process.env[WINDOW_ENV] = "500000";
    process.env.PAL_SPAWNED_INFERENCE = "1";
    recordCompactionNear(payloadFor(transcriptWith("t.jsonl", 400_000)));
    expect(written()).toEqual([]);
  });
});

describe("recordCompactionNear return value", () => {
  test("returns the verdict it logged when predicted", () => {
    process.env[WINDOW_ENV] = "500000";
    expect(recordCompactionNear(payloadFor(transcriptWith("t.jsonl", 400_000)))).toEqual({
      contextTokens: 400_000,
      compactAtTokens: 467_000,
      tokensLeft: 67_000,
      marginTokens: 96_000,
      predicted: true,
    });
  });

  test("returns the verdict when not predicted", () => {
    process.env[WINDOW_ENV] = "500000";
    expect(recordCompactionNear(payloadFor(transcriptWith("t.jsonl", 300_000)))).toEqual({
      contextTokens: 300_000,
      compactAtTokens: 467_000,
      tokensLeft: 167_000,
      marginTokens: 96_000,
      predicted: false,
    });
  });

  test("returns null when nothing was logged", () => {
    process.env[WINDOW_ENV] = "500000";
    expect(recordCompactionNear(payloadFor(resolve(home, "absent.jsonl")))).toBeNull();
    expect(recordCompactionNear(null)).toBeNull();
    process.env.PAL_SPAWNED_INFERENCE = "1";
    expect(
      recordCompactionNear(payloadFor(transcriptWith("t.jsonl", 400_000)))
    ).toBeNull();
  });

  test("the event written by a direct call stays shadow", () => {
    process.env[WINDOW_ENV] = "500000";
    recordCompactionNear(payloadFor(transcriptWith("t.jsonl", 400_000)));
    expect(written()[0]).toMatchObject({ mode: "shadow" });
  });
});

describe("recordIdleCompactionNear (Stop)", () => {
  test("250k with the env var unset logs an idle event", () => {
    recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 250_000)));
    const events = written();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "compaction_near",
      mode: "shadow",
      trigger: "idle",
      session: "sess-1",
      contextTokens: 250_000,
      idleMinTokens: 200_000,
      predicted: true,
    });
  });

  test("150k logs nothing", () => {
    recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 150_000)));
    expect(written()).toEqual([]);
  });

  test("the env minimum of 300k suppresses an event at 250k", () => {
    process.env[IDLE_ENV] = "300000";
    recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 250_000)));
    expect(written()).toEqual([]);
    recordIdleCompactionNear(payloadFor(transcriptWith("t2.jsonl", 320_000)));
    expect(written()[0]).toMatchObject({ idleMinTokens: 300_000, predicted: true });
  });

  test("an env minimum under 100k is raised to 100k", () => {
    process.env[IDLE_ENV] = "50000";
    recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 120_000)));
    expect(written()[0]).toMatchObject({ idleMinTokens: 100_000 });
  });

  test("writes nothing for a missing transcript, no usage, or a spawned inference", () => {
    recordIdleCompactionNear(payloadFor(resolve(home, "absent.jsonl")));
    const path = resolve(home, "empty.jsonl");
    writeFileSync(path, `${JSON.stringify({ message: { content: "hi" } })}\n`);
    recordIdleCompactionNear(payloadFor(path));
    process.env.PAL_SPAWNED_INFERENCE = "1";
    recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 250_000)));
    expect(written()).toEqual([]);
  });
});

describe("event registry", () => {
  test("compaction_near is registered with the union of both triggers' fields", () => {
    expect([...EVENT_FIELDS.compaction_near].map(String).sort()).toEqual(
      [
        "mode",
        "trigger",
        "contextTokens",
        "windowTokens",
        "windowSource",
        "compactAtTokens",
        "tokensLeft",
        "marginTokens",
        "predicted",
        "idleMinTokens",
      ].sort()
    );
  });
});

describe("compactionWarningReminder table rows", () => {
  const nearLib = () => import("../src/hooks/lib/compaction-near");

  function verdictFor(
    contextTokens: number,
    compactAtTokens: number,
    tokensLeft: number,
    marginTokens: number,
    predicted: boolean
  ) {
    return { contextTokens, compactAtTokens, tokensLeft, marginTokens, predicted };
  }

  test.each([
    [
      400_000,
      467_000,
      67_000,
      96_000,
      true,
      "Context: 400k tokens, auto-compaction at 467k (67k left). Before the next long step, ",
    ],
    [
      400_500,
      467_000,
      66_500,
      96_000,
      true,
      "Context: 401k tokens, auto-compaction at 467k (67k left).",
    ],
    [
      420_000,
      467_000,
      47_000,
      96_000,
      true,
      "Context: 420k tokens, auto-compaction at 467k (47k left).",
    ],
    [
      480_000,
      467_000,
      -13_000,
      96_000,
      true,
      "Context: 480k tokens, auto-compaction at 467k (0k left).",
    ],
    [
      466_600,
      467_000,
      400,
      96_000,
      true,
      "Context: 467k tokens, auto-compaction at 467k (0k left).",
    ],
    [300_000, 467_000, 167_000, 96_000, false, null],
  ])(
    "row: context %i, compact at %i, left %i, margin %i",
    async (contextTokens, compactAtTokens, tokensLeft, marginTokens, predicted, prefix) => {
      const { compactionWarningReminder } = await nearLib();
      const block = compactionWarningReminder(
        verdictFor(contextTokens, compactAtTokens, tokensLeft, marginTokens, predicted)
      );
      if (prefix === null) {
        expect(block).toBeNull();
        return;
      }
      expect(block).not.toBeNull();
      const lines = (block as string).split("\n");
      expect(lines.length).toBe(3);
      expect(lines[1].startsWith(prefix)).toBe(true);
    }
  );

  test("a null verdict gives no warning", async () => {
    const { compactionWarningReminder } = await nearLib();
    expect(compactionWarningReminder(null)).toBeNull();
  });
});
