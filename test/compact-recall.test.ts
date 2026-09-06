import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildRecall,
  findSavedExchange,
  isConsumable,
  recallBudget,
  type SavedExchange,
  truncate,
} from "../src/hooks/lib/compact-recall";

// This runs once per compaction and its output is the only surviving copy of the
// turn that was in flight. A budget that is wrong silently loses half a message;
// a consumable check that is wrong deletes the fallback everything else relies on.

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-recall-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "state", "last-exchange"), { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

function saveExchange(name: string): string {
  const path = resolve(HOME, "memory", "state", "last-exchange", `${name}.json`);
  writeFileSync(path, JSON.stringify({ sessionId: name }), "utf-8");
  return path;
}

const EXCHANGE: SavedExchange = {
  sessionId: "s1",
  timestamp: "2026-09-06T00:00:00.000Z",
  trigger: "auto",
  customInstructions: null,
  userMessage: "what broke",
  assistantMessage: "the budget arithmetic",
};

describe("splitting the output budget", () => {
  test("both halves fit inside the cap, with the framing reserve left over", () => {
    const { user, assistant } = recallBudget(9000);
    expect(user + assistant).toBe(8700);
    expect(user + assistant).toBeLessThan(9000);
  });

  test("the assistant gets the larger half, since replies run longer than prompts", () => {
    const { user, assistant } = recallBudget(9000);
    expect(assistant).toBeGreaterThan(user);
  });

  test("the user's share is two fifths of the cap", () => {
    expect(recallBudget(9000).user).toBe(3600);
    expect(recallBudget(1000).user).toBe(400);
  });

  test("a fractional share is rounded down, never up past the cap", () => {
    expect(recallBudget(999).user).toBe(399);
  });
});

describe("truncating a message", () => {
  test("a message inside its budget is returned untouched", () => {
    expect(truncate("short", 100)).toBe("short");
  });

  test("a message exactly at its budget is not truncated", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });

  test("an over-long message keeps its first max characters and drops the rest", () => {
    const out = truncate("abcdefghij", 4);
    expect(out).toStartWith("abcd");
    // The point of the budget is that the tail is gone. Asserting the prefix
    // alone passes just as well when nothing was cut at all.
    expect(out).not.toContain("efghij");
  });

  test("and says how much went missing, so it cannot read as complete", () => {
    expect(truncate("abcdefghij", 4)).toContain("truncated 6 chars");
  });
});

describe("which saved file is read", () => {
  test("the session's own file wins over the shared fallback", () => {
    saveExchange("latest");
    const own = saveExchange("s1");
    expect(findSavedExchange("s1")).toBe(own);
  });

  test("the fallback is used when the session has no file of its own", () => {
    const latest = saveExchange("latest");
    expect(findSavedExchange("s1")).toBe(latest);
  });

  test("the fallback is used when there is no session id at all", () => {
    const latest = saveExchange("latest");
    expect(findSavedExchange()).toBe(latest);
  });

  test("nothing saved is null, not a path that does not exist", () => {
    expect(findSavedExchange("s1")).toBeNull();
  });
});

describe("what may be deleted after reading", () => {
  test("the session's own file is consumed once it has been injected", () => {
    const own = saveExchange("s1");
    expect(isConsumable(own, "s1")).toBe(true);
  });

  test("the shared fallback is never consumed — the next compaction still needs it", () => {
    const latest = saveExchange("latest");
    expect(isConsumable(latest, "s1")).toBe(false);
  });

  test("nothing is consumed without a session id to match against", () => {
    const latest = saveExchange("latest");
    expect(isConsumable(latest, undefined)).toBe(false);
  });

  test("another session's file is not consumed by this one", () => {
    const other = saveExchange("s2");
    expect(isConsumable(other, "s1")).toBe(false);
  });
});

describe("the reminder that gets injected", () => {
  test("carries both halves of the exchange", () => {
    const out = buildRecall(EXCHANGE);
    expect(out).toContain("what broke");
    expect(out).toContain("the budget arithmetic");
  });

  test("is wrapped so the agent reads it as a reminder, not as a user turn", () => {
    const out = buildRecall(EXCHANGE);
    expect(out).toStartWith("<system-reminder>");
    expect(out).toEndWith("</system-reminder>");
  });

  test("names itself, so the next session knows what it is reading", () => {
    expect(buildRecall(EXCHANGE)).toContain("## Last exchange before compaction");
  });

  test("says a user message was missing rather than leaving a blank heading", () => {
    const out = buildRecall({ ...EXCHANGE, userMessage: "" });
    expect(out).toContain("(no user message captured)");
  });

  test("says an assistant message was missing for the same reason", () => {
    const out = buildRecall({ ...EXCHANGE, assistantMessage: "" });
    expect(out).toContain("(no assistant message captured)");
  });

  test("truncates each half against its own budget, not a shared one", () => {
    const out = buildRecall(
      { ...EXCHANGE, userMessage: "u".repeat(50), assistantMessage: "a".repeat(50) },
      { user: 10, assistant: 20 }
    );
    expect(out).toContain("truncated 40 chars");
    expect(out).toContain("truncated 30 chars");
  });
});
