import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  type CandidateInput,
  recordCandidate,
} from "../src/hooks/lib/adaptation-candidates";
import {
  addDraft,
  type DraftInput,
  decideRule,
  readRules,
} from "../src/hooks/lib/adaptation-rules";
import { appendTurn, type TurnInput } from "../src/hooks/lib/adaptation-turns";
import { ruleEventsPath } from "../src/hooks/lib/rule-effect";
import { decideFromPage, relationship } from "../src/tools/control-room/relationship";

let HOME: string;
const NOW = new Date("2026-10-07T12:00:00Z");

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-relationship-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

const rule: DraftInput = {
  when: "Claiming tests pass",
  trigger: { side: "reply", pattern: "tests? pass" },
  steering: "Show the test output.",
  evidence: [],
};

const turn = (over: Partial<TurnInput> = {}): TurnInput => ({
  session: "s1",
  message: "next",
  replyEnd: "Renamed it.",
  reaction: "follow-up",
  issue: "",
  ...over,
});

const at = (iso: string) => new Date(iso);

describe("relationship view", () => {
  test("rules are split into drafts, active and denied", () => {
    const draft = addDraft({ ...rule, when: "draft" });
    const active = addDraft({ ...rule, when: "active" });
    const denied = addDraft({ ...rule, when: "denied" });
    decideRule(active.id, "approved");
    decideRule(denied.id, "denied");

    const view = relationship(NOW);

    expect(view.drafts.map((r) => r.id)).toEqual([draft.id]);
    expect(view.active.map((r) => r.id)).toEqual([active.id]);
    expect(view.denied.map((r) => r.id)).toEqual([denied.id]);
  });

  test("an active rule carries what it did in the window", () => {
    const active = addDraft(rule);
    decideRule(active.id, "approved");
    writeFileSync(
      ruleEventsPath(),
      `${JSON.stringify({ ts: "2026-10-07T10:00:00.000Z", rule: active.id, side: "reply", session: "s1", sentBack: true })}\n`
    );
    appendTurn(
      turn({ reaction: "corrected", confirmed: true }),
      at("2026-10-07T10:05:00Z")
    );

    expect(relationship(NOW).active[0].effect).toEqual({
      fired: 1,
      sentBack: 1,
      judged: 1,
      correctedAfter: 1,
    });
  });

  test("an active rule that never fired shows zeros", () => {
    const active = addDraft(rule);
    decideRule(active.id, "approved");

    expect(relationship(NOW).active[0].effect.fired).toBe(0);
  });

  test("the last 30 days of turns are counted by reaction", () => {
    appendTurn(turn(), at("2026-10-06T10:00:00Z"));
    appendTurn(turn({ reaction: "approved" }), at("2026-10-06T11:00:00Z"));
    appendTurn(
      turn({
        reaction: "corrected",
        confirmed: true,
        issue: "wrong path",
        message: "no",
      }),
      at("2026-10-06T12:00:00Z")
    );
    appendTurn(
      turn({ reaction: "corrected", confirmed: false }),
      at("2026-10-06T13:00:00Z")
    );
    appendTurn(turn(), at("2026-08-01T10:00:00Z"));

    expect(relationship(NOW).turns).toEqual({
      total: 4,
      byReaction: { "follow-up": 1, approved: 1, corrected: 2 },
      confirmedCorrections: 1,
      recentCorrections: [
        { ts: "2026-10-06T12:00:00.000Z", issue: "wrong path", message: "no" },
      ],
    });
  });

  test("the pipeline shows waiting and failed candidates, not passed ones", () => {
    const candidate: CandidateInput = { ...rule, check: "Quotes a run." };
    const corrections = [1, 2].map((n) => ({
      ...turn({ reaction: "corrected", confirmed: true, replyEnd: "tests pass" }),
      ts: `2026-10-0${n}T10:00:00.000Z`,
      prompt: "",
    }));
    const ordinary = (count: number) =>
      Array.from({ length: count }, () => ({
        ...turn(),
        ts: "2026-10-03T10:00:00.000Z",
        prompt: "",
      }));
    recordCandidate({ ...candidate, when: "waiting" }, [...corrections, ...ordinary(12)]);
    recordCandidate({ ...candidate, when: "passed" }, [...corrections, ...ordinary(20)]);
    recordCandidate({ ...candidate, when: "failed" }, corrections.slice(0, 1));

    const pipeline = relationship(NOW).pipeline;

    expect(pipeline.map((c) => [c.when, c.verdict, c.ordinaryNeeded])).toEqual([
      ["waiting", "waiting", 8],
      ["failed", "failed", 0],
    ]);
  });
});

describe("decideFromPage", () => {
  test("approving a draft goes through the same rule as the CLI", () => {
    const draft = addDraft(rule);

    expect(decideFromPage(draft.id, "approved")).toEqual({ ok: true, changed: true });
    expect(readRules()[0].status).toBe("approved");
  });

  test("an unknown id is a 404", () => {
    expect(decideFromPage("nope", "denied")).toMatchObject({ ok: false, status: 404 });
  });

  test("a rule already decided is a 409", () => {
    const draft = addDraft(rule);
    decideRule(draft.id, "denied");

    expect(decideFromPage(draft.id, "approved")).toMatchObject({
      ok: false,
      status: 409,
    });
  });
});
