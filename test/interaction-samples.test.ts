import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { observeTurn, recordReply } from "../src/hooks/lib/interaction";
import type { Reaction } from "../src/hooks/lib/interaction-reaction";
import { keepSample, readSamples } from "../src/hooks/lib/interaction-samples";
import { reload } from "../src/hooks/lib/settings";

let TEST_HOME: string;
const T0 = new Date("2026-09-10T10:00:00Z");

function at(sec: number): Date {
  return new Date(T0.getTime() + sec * 1000);
}

function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(TEST_HOME, "memory", "pal-settings.json"), JSON.stringify(data));
  reload();
}

function sample(reaction: Reaction, i: number) {
  keepSample({
    ts: at(i).toISOString(),
    session: "s1",
    reaction,
    text: `msg ${i}`,
    replyEnd: "",
  });
}

beforeEach(() => {
  TEST_HOME = mkdtempSync(resolve(tmpdir(), "pal-samples-"));
  process.env.PAL_HOME = TEST_HOME;
  mkdirSync(resolve(TEST_HOME, "memory"), { recursive: true });
  setSettings({});
});

afterEach(() => {
  delete process.env.PAL_HOME;
  reload();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("sampling messages for the rule audit", () => {
  test("keeps the message with the end of the reply it answered", () => {
    observeTurn("fix the flaky upload test", "s1", T0);
    recordReply(
      "s1",
      "Moved the retry into the worker.\n\nShould I also add a backoff?",
      at(30)
    );
    observeTurn("nah leave it", "s1", at(40));

    expect(readSamples()).toEqual([
      expect.objectContaining({
        reaction: "follow-up",
        text: "nah leave it",
        replyEnd: expect.stringContaining("Should I also add a backoff?"),
      }),
    ]);
  });

  test("a message with no reply before it is not sampled", () => {
    observeTurn("first message", "s1", T0);

    expect(readSamples()).toEqual([]);
  });

  test("frequent approvals never push out the rarer corrections", () => {
    sample("corrected", 0);
    for (let i = 1; i <= 30; i++) sample("approved", i);

    const kept = readSamples();
    expect(kept.filter((s) => s.reaction === "corrected")).toHaveLength(1);
    expect(kept.filter((s) => s.reaction === "approved")).toHaveLength(20);
    expect(kept.at(-1)?.text).toBe("msg 30");
  });

  test("go-aheads are kept apart from approvals, so the audit sees both", () => {
    for (let i = 0; i < 30; i++) sample("go-ahead", i);
    sample("approved", 30);

    const kept = readSamples();
    expect(kept.filter((s) => s.reaction === "go-ahead")).toHaveLength(20);
    expect(kept.filter((s) => s.reaction === "approved")).toHaveLength(1);
  });

  test("follow-ups, where the misses land, get the most room", () => {
    for (let i = 0; i < 160; i++) sample("follow-up", i);

    expect(readSamples()).toHaveLength(150);
  });

  test("keeps no text when switched off", () => {
    setSettings({ dynamicContext: { reactionSampling: false } });
    observeTurn("fix it", "s1", T0);
    recordReply("s1", "done", at(10));
    observeTurn("thanks", "s1", at(20));

    expect(readSamples()).toEqual([]);
  });
});
