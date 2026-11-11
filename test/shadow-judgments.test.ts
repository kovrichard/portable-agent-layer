import { describe, expect, test } from "bun:test";
import type { RequestedTurn } from "../src/hooks/lib/adaptation-turns";
import type { inference } from "../src/hooks/lib/inference";
import type { JudgeQuestion } from "../src/hooks/lib/judgment";
import {
  entityPrecheckJudgment,
  ruleRecurringJudgment,
  sessionStatusJudgment,
} from "../src/hooks/lib/shadow-judgments";

type InferenceRequest = Parameters<typeof inference>[0];

const SESSION_STATUS_QUESTION: JudgeQuestion = {
  type: "choice",
  instructions:
    "A session between a user and an AI assistant: `user_messages` are the user's latest messages, oldest first, and `last_reply` is the start and end of the assistant's last reply. Is the work in progress or completed?",
  criteria: {
    "in-progress":
      "work remains, or the last reply ends with a question or an offer that awaits the user's answer",
    completed: "nothing is left to do and the last reply does not wait for the user",
  },
};

function requestWith(extra: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    system: "system",
    user: "user",
    caller: "session-intelligence",
    maxTokens: 450,
    timeout: 90000,
    ...extra,
  } as InferenceRequest;
}

function turn(extra: Partial<RequestedTurn> = {}): RequestedTurn {
  return {
    session: "s1",
    ts: "2026-11-11T10:00:00Z",
    message: "M",
    replyEnd: "R",
    reaction: "",
    issue: "I",
    prompt: "",
    ...extra,
  };
}

describe("sessionStatusJudgment", () => {
  test("builds the session-status request from the two texts and the caller's request", () => {
    const req = requestWith({ caller: "session-intelligence", sessionId: "s" });
    const judgment = sessionStatusJudgment("1. a\n2. b", "end", req);
    expect(judgment.caller).toBe("session-status");
    expect(judgment.state).toEqual({ user_messages: "1. a\n2. b", last_reply: "end" });
    expect(judgment.sessionId).toBe("s");
    expect(judgment.fallback?.request).toBe(req);
  });

  test("empty texts and a request without sessionId give empty state and no sessionId", () => {
    const judgment = sessionStatusJudgment("", "", requestWith());
    expect(judgment.state).toEqual({ user_messages: "", last_reply: "" });
    expect(judgment.sessionId).toBeUndefined();
  });

  test("asks only the status question, for any input", () => {
    const judgment = sessionStatusJudgment("", "", requestWith());
    expect(judgment.questions).toEqual({ status: SESSION_STATUS_QUESTION });
  });
});

describe("sessionStatusAnswers (through the fallback parser)", () => {
  const parse = (output: string) =>
    sessionStatusJudgment("", "", requestWith()).fallback?.parse(output);

  test("an in-progress status gives an in-progress choice", () => {
    expect(parse('{"title":"x","status":"in-progress"}')).toEqual({
      status: { choice: "in-progress" },
    });
  });

  test("a completed status gives a completed choice", () => {
    expect(parse('{"status":"completed"}')).toEqual({ status: { choice: "completed" } });
  });

  test("a status outside the two choices gives no answers", () => {
    expect(parse('{"status":"paused"}')).toBeNull();
  });

  test("output that is not JSON gives no answers", () => {
    expect(parse("not json at all")).toBeNull();
  });

  test("the JSON null gives no answers", () => {
    expect(parse("null")).toBeNull();
  });

  test("JSON without a status gives no answers", () => {
    expect(parse('{"title":"x"}')).toBeNull();
  });
});

describe("entityPrecheckJudgment", () => {
  test("builds the entity-precheck request from the messages and the caller's request", () => {
    const req = requestWith({ tier: "medium", sessionId: "x" });
    const judgment = entityPrecheckJudgment(
      "1. we met Odo Vance from Northwind yesterday",
      req
    );
    expect(judgment.caller).toBe("entity-precheck");
    expect(judgment.state).toEqual({
      messages: "1. we met Odo Vance from Northwind yesterday",
    });
    expect(judgment.sessionId).toBe("x");
  });

  test("empty messages give empty state", () => {
    const judgment = entityPrecheckJudgment("", requestWith({ tier: "medium" }));
    expect(judgment.state).toEqual({ messages: "" });
  });

  test("keeps the caller's request and its medium tier, for any input", () => {
    const req = requestWith({ tier: "medium" });
    const judgment = entityPrecheckJudgment("", req);
    expect(judgment.fallback?.request).toBe(req);
    expect(judgment.fallback?.request.tier).toBe("medium");
  });
});

describe("namesEntityAnswers (through the fallback parser)", () => {
  const parse = (output: string) =>
    entityPrecheckJudgment("", requestWith({ tier: "medium" })).fallback?.parse(output);

  test("an extraction with a person gives a true answer", () => {
    expect(parse('{"entities":[{"kind":"person","name":"Odo Vance"}]}')).toEqual({
      names_entity: { noul: true },
    });
  });

  test("an extraction without entities gives a false answer", () => {
    expect(parse('{"entities":[]}')).toEqual({ names_entity: { noul: false } });
  });

  test("output that is not JSON gives no answers", () => {
    expect(parse("nope")).toBeNull();
  });

  test("JSON without entities gives a false answer", () => {
    expect(parse("{}")).toEqual({ names_entity: { noul: false } });
  });
});

describe("ruleRecurringJudgment", () => {
  const c1 = turn({
    prompt: "run the suite",
    replyEnd: "R1",
    message: "M1",
    issue: "I1",
  });
  const c2 = turn({ prompt: "", replyEnd: "R2", message: "M2", issue: "I2" });
  const c3 = turn({ prompt: "p3", replyEnd: "R3", message: "M3", issue: "I3" });

  test("the newest correction is the state's newest and earlier ones are listed oldest first", () => {
    const judgment = ruleRecurringJudgment([c1, c2], requestWith());
    expect(judgment.state).toEqual({
      newest: { reply_end: "R2", user_message: "M2", what_was_wrong: "I2" },
      earlier: [
        {
          request: "run the suite",
          reply_end: "R1",
          user_message: "M1",
          what_was_wrong: "I1",
        },
      ],
    });
  });

  test("a single correction gives no earlier corrections (widening path)", () => {
    const judgment = ruleRecurringJudgment([c1], requestWith());
    expect(judgment.state).toEqual({
      newest: {
        request: "run the suite",
        reply_end: "R1",
        user_message: "M1",
        what_was_wrong: "I1",
      },
      earlier: [],
    });
  });

  test("with three corrections the newest is the last and the earlier ones keep their order", () => {
    const judgment = ruleRecurringJudgment([c1, c2, c3], requestWith());
    const state = judgment.state as {
      newest: Record<string, string>;
      earlier: Record<string, string>[];
    };
    expect(state.newest).toEqual({
      request: "p3",
      reply_end: "R3",
      user_message: "M3",
      what_was_wrong: "I3",
    });
    expect(state.earlier.map((e) => e.reply_end)).toEqual(["R1", "R2"]);
  });
});

describe("correctionState (through the newest state of ruleRecurringJudgment)", () => {
  const newestOf = (correction: RequestedTurn) =>
    (ruleRecurringJudgment([correction], requestWith()).state as { newest: unknown })
      .newest;

  test("a correction with a prompt carries request, reply_end, user_message and what_was_wrong", () => {
    expect(
      newestOf(
        turn({
          prompt: "run the suite",
          replyEnd: "All tests pass.",
          message: "they never ran",
          issue: "claimed tests pass",
        })
      )
    ).toEqual({
      request: "run the suite",
      reply_end: "All tests pass.",
      user_message: "they never ran",
      what_was_wrong: "claimed tests pass",
    });
  });

  test("an empty prompt leaves out the request key", () => {
    const newest = newestOf(
      turn({ prompt: "", replyEnd: "R", message: "M", issue: "I" })
    );
    expect(newest).toEqual({ reply_end: "R", user_message: "M", what_was_wrong: "I" });
    expect(Object.keys(newest as object)).not.toContain("request");
  });

  test("empty fields other than the prompt are kept as empty strings", () => {
    expect(newestOf(turn({ prompt: "p", replyEnd: "", message: "", issue: "" }))).toEqual(
      {
        request: "p",
        reply_end: "",
        user_message: "",
        what_was_wrong: "",
      }
    );
  });
});

describe("recurringAnswers (through the fallback parser)", () => {
  const parse = (output: string) =>
    ruleRecurringJudgment([turn()], requestWith()).fallback?.parse(output);

  test("a recurring draft with no widening gives a true answer", () => {
    expect(parse('{"recurring":true,"widens":"","cites":[0,1]}')).toEqual({
      recurring: { noul: true },
    });
  });

  test("a not-recurring draft with no widening gives a false answer", () => {
    expect(parse('{"recurring":false,"widens":"","cites":[]}')).toEqual({
      recurring: { noul: false },
    });
  });

  test("a draft that widens gives no answers", () => {
    expect(parse('{"recurring":true,"widens":"r1"}')).toBeNull();
  });

  test("output that is not JSON gives no answers", () => {
    expect(parse("nope")).toBeNull();
  });

  test("a recurring draft without a widens key gives a true answer", () => {
    expect(parse('{"recurring":true}')).toEqual({ recurring: { noul: true } });
  });

  test("a recurring value that is not a boolean gives no answers", () => {
    expect(parse('{"recurring":"yes","widens":""}')).toBeNull();
  });

  test("a draft without a recurring key gives no answers", () => {
    expect(parse('{"widens":""}')).toBeNull();
  });
});
