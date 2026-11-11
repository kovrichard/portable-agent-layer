import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { captureSessionIntelligence } from "../src/hooks/handlers/session-intelligence";
import { readTree, scopeOf } from "../src/hooks/lib/progress-tree";
import { readProjectHistory } from "../src/hooks/lib/work-tracking";
import {
  eventsOf,
  fakeAdapter,
  modelHome,
  setSystemOne,
  shadowOn,
} from "./lib/shadow-judgments";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const REPLY = {
  title: "Handoff wiring",
  summary: "We traced the handoff.",
  insights: "",
  status: "in-progress",
  done: "Traced where the handoff is written.",
  next: "Write the next step into the progress tree, then run the gates.",
  waitingOn: "",
};

let home: string;

/** `null` makes the fake `claude` fail. */
function start(reply: string | null = JSON.stringify(REPLY)) {
  home = modelHome(import.meta.file, reply ?? undefined);
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
}

beforeEach(() => start());

const PAD = "x".repeat(300);

function transcript(): string {
  return JSON.stringify(
    Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} ${PAD}`,
    }))
  );
}

function stored(session: string) {
  const nodes = [...readTree(scopeOf(process.cwd()), undefined, session).nodes.values()];
  return {
    history: readProjectHistory(process.cwd()).filter((e) => e.session === session),
    nodes,
  };
}

const COMPLETED_AGAINST_IN_PROGRESS = { status: { choice: "completed" } };

describe("criterion 1: one judge() call, off by default", () => {
  test("stores what the reply gives and logs one inference_call and one off judge_call", async () => {
    await captureSessionIntelligence(transcript(), "s-off");
    const { history, nodes } = stored("s-off");
    expect(history.map((e) => e.title)).toEqual(["Handoff wiring"]);
    expect(nodes[0]).toMatchObject({
      title: "Handoff wiring",
      stoppedAt: `Next: ${REPLY.next}`,
    });
    const inferred = eventsOf(home, "inference_call");
    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.caller).toBe("session-intelligence");
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({
      caller: "session-status",
      mode: "off",
      route: "fallback",
      fallbackAnswers: { status: { choice: "in-progress" } },
    });
  });

  test("a completed reply gives a completed answer", async () => {
    start(JSON.stringify({ ...REPLY, status: "completed" }));
    await captureSessionIntelligence(transcript(), "s-done");
    expect(eventsOf(home, "judge_call")[0]?.fallbackAnswers).toEqual({
      status: { choice: "completed" },
    });
  });

  test("a reply that is not JSON gives no answers and still one event", async () => {
    start("not json at all");
    await captureSessionIntelligence(transcript(), "s-bad");
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]?.fallbackAnswers).toBeUndefined();
    expect(stored("s-bad").history).toEqual([]);
  });

  test("a status outside the two choices gives no answers", async () => {
    start(JSON.stringify({ ...REPLY, status: "paused" }));
    await captureSessionIntelligence(transcript(), "s-odd");
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]?.fallbackAnswers).toBeUndefined();
  });

  test("a failed model call still writes the event and records no history", async () => {
    start(null);
    await captureSessionIntelligence(transcript(), "s-fail");
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]?.fallbackAnswers).toBeUndefined();
    expect(stored("s-fail").history).toEqual([]);
  });

  test("a guard that stops the run makes no model call and no judge_call", async () => {
    await captureSessionIntelligence("[]", "s-guard");
    expect(eventsOf(home, "judge_call")).toEqual([]);
    expect(eventsOf(home, "inference_call")).toEqual([]);
  });
});

describe("criterion 4: caller missing from systemOne.callers", () => {
  test("mode off and System One is never asked", async () => {
    const adapter = fakeAdapter(COMPLETED_AGAINST_IN_PROGRESS);
    setSystemOne(home, { provider: "fake", callers: { reaction: "shadow" } });
    await captureSessionIntelligence(transcript(), "s-missing");
    expect(adapter.asked).toHaveLength(0);
    expect(eventsOf(home, "judge_call")).toMatchObject([
      { caller: "session-status", mode: "off", route: "fallback" },
    ]);
    expect(stored("s-missing").history.map((e) => e.title)).toEqual(["Handoff wiring"]);
  });
});

describe("criteria 5 and 6: shadow", () => {
  test("stores the same result, logs both answers, and sends exactly the state and question", async () => {
    const adapter = fakeAdapter(COMPLETED_AGAINST_IN_PROGRESS);
    shadowOn(home, "session-status");
    await captureSessionIntelligence(transcript(), "s-shadow");

    const { history, nodes } = stored("s-shadow");
    expect(history.map((e) => e.title)).toEqual(["Handoff wiring"]);
    expect(nodes[0]?.stoppedAt).toBe(`Next: ${REPLY.next}`);

    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({
      caller: "session-status",
      mode: "shadow",
      route: "fallback",
      systemOneAnswers: { status: { choice: "completed" } },
      fallbackAnswers: { status: { choice: "in-progress" } },
    });
    expect(eventsOf(home, "inference_call")).toHaveLength(1);

    expect(adapter.asked).toHaveLength(1);
    const asked = adapter.asked[0];
    const messages = [0, 2, 4, 6, 8, 10].map((i, n) =>
      `${n + 1}. message ${i} ${PAD}`.slice(0, 203)
    );
    expect(asked?.state).toEqual({
      user_messages: messages.join("\n"),
      last_reply: `message 11 ${PAD}`,
    });
    expect(asked?.questions).toEqual({
      status: {
        type: "choice",
        instructions:
          "A session between a user and an AI assistant: `user_messages` are the user's latest messages, oldest first, and `last_reply` is the start and end of the assistant's last reply. Is the work in progress or completed?",
        criteria: {
          "in-progress":
            "work remains, or the last reply ends with a question or an offer that awaits the user's answer",
          completed:
            "nothing is left to do and the last reply does not wait for the user",
        },
      },
    });
  });
});
