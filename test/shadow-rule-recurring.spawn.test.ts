import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readCandidates } from "../src/hooks/lib/adaptation-candidates";
import { appendTurn } from "../src/hooks/lib/adaptation-turns";
import {
  eventsOf,
  fakeAdapter,
  modelHome,
  setSystemOne,
  shadowOn,
} from "./lib/shadow-judgments";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const DRAFT = {
  recurring: true,
  widens: "",
  reason: "Both claim success without a run.",
  when: "Reporting that tests pass",
  side: "reply",
  pattern: "tests? pass",
  steering: "Run the tests before saying they pass.",
  check: "The reply quotes a test run.",
  cites: [0, 1],
};

let home: string;

/** `null` makes the fake `claude` fail. */
function start(reply: string | null = JSON.stringify(DRAFT)) {
  home = modelHome(import.meta.file, reply ?? undefined);
  mkdirSync(resolve(home, "memory"), { recursive: true });
}

beforeEach(() => start());

const base = new Date();
const at = (minutes: number) => new Date(base.getTime() - (10 - minutes) * 60_000);

/** Session s1 holds a request and a first correction; session s2 holds the newest correction, with no request. */
function seedTwoCorrections() {
  appendTurn(
    {
      session: "s1",
      message: "run the suite",
      replyEnd: "Started.",
      reaction: "follow-up",
      issue: "",
    },
    at(1)
  );
  appendTurn(
    {
      session: "s1",
      message: "they never ran",
      replyEnd: "All tests pass.",
      reaction: "corrected",
      issue: "claimed tests pass",
      confirmed: true,
    },
    at(2)
  );
  appendTurn(
    {
      session: "s2",
      message: "you did not run them",
      replyEnd: "All tests pass again.",
      reaction: "corrected",
      issue: "claimed tests pass",
      confirmed: true,
    },
    at(3)
  );
}

async function draft(sessionId = "s2") {
  const rating = await import("../src/hooks/handlers/rating");
  await (
    rating as unknown as { draftRuleCandidate(s?: string): Promise<void> }
  ).draftRuleCandidate(sessionId);
}

describe("criterion 3: one judge() call, off by default", () => {
  test("records the drafted candidate, logs one rule-drafter inference_call and one off judge_call", async () => {
    seedTwoCorrections();
    await draft();
    expect(readCandidates()).toMatchObject([
      {
        when: DRAFT.when,
        steering: DRAFT.steering,
        check: DRAFT.check,
      },
    ]);
    const inferred = eventsOf(home, "inference_call");
    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.caller).toBe("rule-drafter");
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({
      caller: "rule-recurring",
      mode: "off",
      route: "fallback",
      fallbackAnswers: { recurring: { noul: true } },
    });
  });

  test("a not-recurring draft answers false and records no candidate", async () => {
    start(JSON.stringify({ ...DRAFT, recurring: false, cites: [] }));
    seedTwoCorrections();
    await draft();
    expect(readCandidates()).toEqual([]);
    expect(eventsOf(home, "judge_call")[0]?.fallbackAnswers).toEqual({
      recurring: { noul: false },
    });
  });

  test("a reply that is not JSON gives no answers and records no candidate", async () => {
    start("nope");
    seedTwoCorrections();
    await draft();
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]?.fallbackAnswers).toBeUndefined();
    expect(readCandidates()).toEqual([]);
  });

  test("a failed model call still writes the event and records no candidate", async () => {
    start(null);
    seedTwoCorrections();
    await draft();
    expect(eventsOf(home, "judge_call")).toHaveLength(1);
    expect(readCandidates()).toEqual([]);
  });

  test("a single correction stops at the guard: no model call, no judge_call", async () => {
    appendTurn(
      {
        session: "s2",
        message: "you did not run them",
        replyEnd: "All tests pass.",
        reaction: "corrected",
        issue: "claimed tests pass",
        confirmed: true,
      },
      at(3)
    );
    await draft();
    expect(eventsOf(home, "judge_call")).toEqual([]);
    expect(eventsOf(home, "inference_call")).toEqual([]);
  });
});

describe("criterion 4: caller missing from systemOne.callers", () => {
  test("mode off and System One is never asked", async () => {
    const adapter = fakeAdapter({ recurring: { noul: false } });
    setSystemOne(home, { provider: "fake", callers: { reaction: "shadow" } });
    seedTwoCorrections();
    await draft();
    expect(adapter.asked).toHaveLength(0);
    expect(eventsOf(home, "judge_call")).toMatchObject([
      { caller: "rule-recurring", mode: "off", route: "fallback" },
    ]);
    expect(readCandidates()).toHaveLength(1);
  });
});

describe("criteria 5 and 6: shadow", () => {
  test("records the same candidate, logs both answers, and sends exactly the state and question", async () => {
    const adapter = fakeAdapter({ recurring: { noul: false } });
    shadowOn(home, "rule-recurring");
    seedTwoCorrections();
    await draft();

    expect(readCandidates()).toMatchObject([
      { when: DRAFT.when, steering: DRAFT.steering },
    ]);
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({
      caller: "rule-recurring",
      mode: "shadow",
      route: "fallback",
      systemOneAnswers: { recurring: { noul: false } },
      fallbackAnswers: { recurring: { noul: true } },
    });
    expect(eventsOf(home, "inference_call")).toHaveLength(1);

    expect(adapter.asked).toHaveLength(1);
    const asked = adapter.asked[0];
    expect(asked?.state).toEqual({
      newest: {
        reply_end: "All tests pass again.",
        user_message: "you did not run them",
        what_was_wrong: "claimed tests pass",
      },
      earlier: [
        {
          request: "run the suite",
          reply_end: "All tests pass.",
          user_message: "they never ran",
          what_was_wrong: "claimed tests pass",
        },
      ],
    });
    expect(asked?.questions).toEqual({
      recurring: {
        type: "noul",
        instructions:
          "`newest` is a correction the user just made to an AI assistant's reply, and `earlier` are the user's earlier corrections. Is `newest` the same kind of mistake as at least one earlier correction?",
        criteria: {
          true: "one instruction to the assistant would have prevented both `newest` and an earlier correction",
          false:
            "`newest` only shares a topic with the earlier corrections, or `earlier` is empty",
        },
      },
    });
  });
});
