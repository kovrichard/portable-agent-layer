import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { addDraft, type DraftInput, decideRule } from "../src/hooks/lib/adaptation-rules";
import {
  promptRulesReminder,
  watchReplyRules,
} from "../src/hooks/lib/adaptation-steering";
import { reload } from "../src/hooks/lib/settings";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const NOW = new Date("2026-10-07T08:00:00Z");

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  reload();
});

afterEach(() => {
  delete process.env.PAL_HOME;
  reload();
  removeOnceReleased(HOME);
});

function approved(over: Partial<DraftInput>) {
  const rule = addDraft({
    when: "Deleting files",
    trigger: { side: "prompt", pattern: "delete|clean ?up" },
    steering: "List what would be deleted and ask first.",
    evidence: [],
    ...over,
  });
  decideRule(rule.id, "approved");
  return rule;
}

function events() {
  const path = resolve(HOME, "memory", "adaptation", "rule-events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

const replyRule = {
  when: "Claiming tests pass",
  trigger: { side: "reply" as const, pattern: "tests? pass" },
  steering: "Show the test output or say the result is unverified.",
};

function stop(reply: string, over: Record<string, unknown> = {}) {
  return watchReplyRules(
    { session_id: "s1", last_assistant_message: reply, ...over },
    NOW
  );
}

describe("prompt-side rules", () => {
  test("an approved rule whose trigger matches the prompt is injected", () => {
    approved({});

    const reminder = promptRulesReminder("please clean up the logs", "s1", NOW);

    expect(reminder?.startsWith("<system-reminder>\n")).toBe(true);
    expect(reminder?.endsWith("\n</system-reminder>")).toBe(true);
    expect(reminder).toContain("approved from past corrections");
    expect(reminder).toContain("- List what would be deleted and ask first.");
  });

  test("a prompt that matches nothing injects nothing", () => {
    approved({});

    expect(promptRulesReminder("rename the key", "s1", NOW)).toBeNull();
  });

  test("drafts, denied rules and reply-side rules are not injected", () => {
    addDraft({
      ...replyRule,
      trigger: { side: "prompt", pattern: "logs" },
      evidence: [],
    });
    const denied = addDraft({
      ...replyRule,
      trigger: { side: "prompt", pattern: "logs" },
      evidence: [],
    });
    decideRule(denied.id, "denied");
    approved({ ...replyRule, trigger: { side: "reply", pattern: "logs" } });

    expect(promptRulesReminder("delete the logs", "s1", NOW)).toBeNull();
  });

  test("a rule with a broken pattern is skipped, not fatal", () => {
    approved({ trigger: { side: "prompt", pattern: "delete (" } });
    approved({ steering: "Ask first." });

    expect(promptRulesReminder("delete it", "s1", NOW)).toContain("- Ask first.");
  });

  test("matches beyond the budget are dropped", () => {
    for (let i = 0; i < 20; i++) approved({ steering: `${i} ${"x".repeat(100)}` });

    const reminder = promptRulesReminder("delete it", "s1", NOW) ?? "";

    expect(reminder.length).toBeLessThanOrEqual(1500);
    expect(reminder).toContain("- 0 ");
  });

  test("each fired rule is logged with its side and session", () => {
    const rule = approved({});

    promptRulesReminder("delete it", "s1", NOW);

    expect(events()).toEqual([
      { ts: NOW.toISOString(), rule: rule.id, side: "prompt", session: "s1" },
    ]);
  });

  test("switched off, nothing is injected or logged", () => {
    approved({});
    writeFileSync(
      resolve(HOME, "memory", "pal-settings.json"),
      JSON.stringify({ dynamicContext: { adaptationRules: false } })
    );
    reload();

    expect(promptRulesReminder("delete it", "s1", NOW)).toBeNull();
    expect(events()).toEqual([]);
  });
});

describe("reply-side rules", () => {
  test("a reply matching an approved rule is sent back with its steering", () => {
    approved(replyRule);

    expect(stop("Fixed it. All tests pass.")).toContain(
      "Show the test output or say the result is unverified."
    );
  });

  test("only the end of the reply is matched, as in the proof", () => {
    approved(replyRule);

    expect(stop(`Tests pass on main. ${"x".repeat(700)}`)).toBeNull();
  });

  test("a reply already sent back once goes through, and the fire is still logged", () => {
    const rule = approved(replyRule);

    expect(stop("All tests pass.", { stop_hook_active: true })).toBeNull();
    expect(events()).toEqual([
      {
        ts: NOW.toISOString(),
        rule: rule.id,
        side: "reply",
        session: "s1",
        sentBack: false,
      },
    ]);
  });

  test("a sent-back reply is logged as sent back", () => {
    approved(replyRule);

    stop("All tests pass.");

    expect(events()[0]).toMatchObject({ side: "reply", sentBack: true });
  });

  test("a reply matching nothing, or with no text, is let through", () => {
    approved(replyRule);

    expect(stop("Renamed the key.")).toBeNull();
    expect(stop("")).toBeNull();
    expect(events()).toEqual([]);
  });
});
