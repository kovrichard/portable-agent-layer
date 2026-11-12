import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { correctionKindRequest } from "../src/hooks/lib/correction-kind";
import type { inference } from "../src/hooks/lib/inference";
import {
  JUDGE_ADAPTERS,
  type JudgeAdapter,
  judge,
  TYPESAFE_DEFAULT_MODEL,
} from "../src/hooks/lib/judge";
import {
  answersProblem,
  type JudgeRequest,
  type JudgeResult,
  judgeRequestJson,
} from "../src/hooks/lib/judgment";
import { costOfUsage, MODEL_PRICING } from "../src/hooks/lib/models";
import {
  correctionCheckJudgment,
  correctionCheckOf,
  correctionKindJudgment,
  correctionKindOf,
  reactionJudgment,
  reactionLabelOf,
} from "../src/hooks/lib/rating-judgments";
import {
  correctionCheckRequest,
  reactionRequest,
} from "../src/hooks/lib/reaction-rating";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

type Infer = typeof inference;
type InferCall = Parameters<Infer>[0];

const KEYS = ["PAL_TYPESAFE_API_KEY", "TYPESAFE_API_KEY", "PAL_HOME"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let home: string;

beforeEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  delete process.env.PAL_TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  delete JUDGE_ADAPTERS.fake;
  settings(undefined);
});

function settings(systemOne: Record<string, unknown> | undefined) {
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify(systemOne ? { systemOne } : {})
  );
  reload();
}

function events(type: string): Record<string, unknown>[] {
  const file = resolve(
    home,
    "memory",
    "events",
    `${new Date().toISOString().slice(0, 7)}.jsonl`
  );
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);
}

const QUESTIONS = {
  reaction: {
    type: "choice",
    instructions: "How did the user react?",
    criteria: { corrected: "it was wrong", approved: "go ahead" },
  },
  corrected: { type: "noul", instructions: "Is it wrong?" },
  mood: { type: "score", instructions: "How happy?", criteria: ["low", "mid", "high"] },
} as const;

const ANSWERS = {
  reaction: {
    choice: "approved",
    confidence: 0.9,
    probabilities: { approved: 0.9, corrected: 0.1 },
  },
  corrected: { noul: false },
  mood: { score: 2, confidence: 0.6, probabilities: [0.1, 0.3, 0.6] },
};

function http(
  reply: unknown = { answers: ANSWERS, usage: { input_tokens: 1000 } },
  status = 200
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });

    return new Response(JSON.stringify(reply), { status });
  };

  return { calls, fn: fn as unknown as typeof fetch };
}

function infer(output = '{"reaction":"corrected"}', success = true) {
  const calls: InferCall[] = [];
  const fn: Infer = async (call) => {
    calls.push(call);

    return success ? { success, output } : { success, error: "boom" };
  };

  return { calls, fn };
}

const FALLBACK_REQUEST = { user: "classify", caller: "t", timeout: 5000 };
const fallback = {
  request: FALLBACK_REQUEST,
  parse: (output: string) => ({ reaction: { choice: JSON.parse(output).reaction } }),
};

const noSleep = async () => {};

function on(extra: Record<string, unknown> = {}) {
  process.env.PAL_TYPESAFE_API_KEY = "k-pal";
  settings({ provider: "typesafe", callers: { t: "live" }, ...extra });
}

const base = { caller: "t", state: { message: "go on" }, questions: QUESTIONS };

describe("judge answers (criteria 1, 2)", () => {
  test("sends one request with all questions and returns every answer type with probabilities and confidence", async () => {
    on();
    const h = http();
    const f = infer();
    const result = await judge(base, { http: h.fn, infer: f.fn, sleep: noSleep });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(
      ((h.calls[0]?.init.headers ?? {}) as Record<string, string>).Authorization
    ).toBe("Bearer k-pal");
    const body = JSON.parse(String(h.calls[0]?.init.body));
    expect(body.state).toEqual({ message: "go on" });
    expect(Object.keys(body.questions).sort()).toEqual(["corrected", "mood", "reaction"]);
    expect(body.questions.mood.type).toBe("score");
    expect(result.route).toBe("system-one");
    expect(result.answers).toEqual(ANSWERS);
    expect(f.calls).toHaveLength(0);
  });

  test("a string state is sent as given", async () => {
    on();
    const h = http();
    await judge({ ...base, state: "plain text" }, { http: h.fn, infer: infer().fn });
    expect(JSON.parse(String(h.calls[0]?.init.body)).state).toBe("plain text");
  });
});

describe("provider registry (criterion 3)", () => {
  test("typesafe is the only built-in adapter", () => {
    expect(Object.keys(JUDGE_ADAPTERS)).toEqual(["typesafe"]);
  });

  test("a fake adapter named in the settings answers without caller changes", async () => {
    const asked: unknown[] = [];
    const adapter: JudgeAdapter = {
      defaultModel: "fake-1",
      keyNames: [],
      ask: async (input) => {
        asked.push(input);

        return { answers: ANSWERS, inputTokens: 10 };
      },
    };
    JUDGE_ADAPTERS.fake = adapter;
    settings({ provider: "fake", callers: { t: "live" } });
    const h = http();
    const result = await judge(base, { http: h.fn, infer: infer().fn });
    expect(asked).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
    expect(result.route).toBe("system-one");
    expect(result.answers).toEqual(ANSWERS);
  });
});

describe("key lookup (criterion 4)", () => {
  test("PAL_TYPESAFE_API_KEY alone is used", async () => {
    settings({ provider: "typesafe", callers: { t: "live" } });
    process.env.PAL_TYPESAFE_API_KEY = "only-pal";
    const h = http();
    await judge(base, { http: h.fn, infer: infer().fn });
    expect(
      ((h.calls[0]?.init.headers ?? {}) as Record<string, string>).Authorization
    ).toBe("Bearer only-pal");
  });

  test("TYPESAFE_API_KEY alone is used", async () => {
    settings({ provider: "typesafe", callers: { t: "live" } });
    process.env.TYPESAFE_API_KEY = "only-vendor";
    const h = http();
    await judge(base, { http: h.fn, infer: infer().fn });
    expect(
      ((h.calls[0]?.init.headers ?? {}) as Record<string, string>).Authorization
    ).toBe("Bearer only-vendor");
  });

  test("PAL_TYPESAFE_API_KEY wins over TYPESAFE_API_KEY", async () => {
    settings({ provider: "typesafe", callers: { t: "live" } });
    process.env.PAL_TYPESAFE_API_KEY = "first";
    process.env.TYPESAFE_API_KEY = "second";
    const h = http();
    await judge(base, { http: h.fn, infer: infer().fn });
    expect(
      ((h.calls[0]?.init.headers ?? {}) as Record<string, string>).Authorization
    ).toBe("Bearer first");
  });

  test("a key in ~/.pal/.env is read through withPalEnv", async () => {
    settings({ provider: "typesafe", callers: { t: "live" } });
    writeFileSync(resolve(home, ".env"), "TYPESAFE_API_KEY=from-file\n");
    const h = http();
    await judge(base, { http: h.fn, infer: infer().fn });
    expect(
      ((h.calls[0]?.init.headers ?? {}) as Record<string, string>).Authorization
    ).toBe("Bearer from-file");
  });
});

describe("model (criterion 5)", () => {
  test("defaults to the pinned jev-1.14.0, not an alias", async () => {
    on();
    const h = http();
    await judge(base, { http: h.fn, infer: infer().fn });
    expect(JSON.parse(String(h.calls[0]?.init.body)).model).toBe("jev-1.14.0");
    expect(TYPESAFE_DEFAULT_MODEL).toBe("jev-1.14.0");
  });

  test("systemOne.model overrides it", async () => {
    on({ model: "jev-9.9.9" });
    const h = http();
    await judge(base, { http: h.fn, infer: infer().fn });
    expect(JSON.parse(String(h.calls[0]?.init.body)).model).toBe("jev-9.9.9");
  });
});

describe("fallback cases (criterion 6)", () => {
  async function expectFallback(
    deps: Parameters<typeof judge>[1] & { f: ReturnType<typeof infer> }
  ) {
    const result = await judge({ ...base, fallback }, deps);
    expect(deps.f.calls).toHaveLength(1);
    expect(result.route).toBe("fallback");
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
  }

  test("no systemOne setting", async () => {
    process.env.PAL_TYPESAFE_API_KEY = "k";
    const f = infer();
    const h = http();
    await expectFallback({ http: h.fn, infer: f.fn, f });
    expect(h.calls).toHaveLength(0);
  });

  test("no key", async () => {
    settings({ provider: "typesafe", callers: { t: "live" } });
    const f = infer();
    const h = http();
    await expectFallback({ http: h.fn, infer: f.fn, f });
    expect(h.calls).toHaveLength(0);
  });

  test("an HTTP error", async () => {
    on();
    const f = infer();
    await expectFallback({ http: http({ error: "x" }, 500).fn, infer: f.fn, f });
  });

  test("a timeout", async () => {
    on();
    const f = infer();
    const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
    const req = {
      ...base,
      fallback: { ...fallback, request: { ...FALLBACK_REQUEST, timeout: 50 } },
    };
    const result = await judge(req, { http: hang, infer: f.fn, sleep: noSleep });
    expect(f.calls).toHaveLength(1);
    expect(result.route).toBe("fallback");
  });

  for (const status of [429, 529]) {
    test(`${status} still failing after the retries`, async () => {
      on();
      const f = infer();
      const h = http({ error: "busy" }, status);
      await expectFallback({ http: h.fn, infer: f.fn, sleep: noSleep, f });
      expect(h.calls.length).toBeGreaterThan(1);
    });
  }
});

describe("the fallback request (criterion 7)", () => {
  test("runs the caller's exact inference request and maps its output", async () => {
    const f = infer();
    const result = await judge({ ...base, fallback }, { http: http().fn, infer: f.fn });
    expect(f.calls[0]).toMatchObject(FALLBACK_REQUEST);
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
    expect(result.fallbackOutput).toBe('{"reaction":"corrected"}');
  });

  test("without a fallback the questions are rendered with a JSON schema", async () => {
    const f = infer(JSON.stringify({ reaction: "approved", corrected: true, mood: 1 }));
    const result = await judge(base, { http: http().fn, infer: f.fn });
    const call = f.calls[0];
    expect(call?.tier).toBe("small");
    expect(call?.caller).toBe("t");
    const props = (
      (call?.jsonSchema ?? { properties: {} }) as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    expect(props.reaction?.enum).toEqual(["corrected", "approved"]);
    expect(props.corrected?.type).toBe("boolean");
    expect(props.mood?.type).toBe("integer");
    expect(result.route).toBe("fallback");
    expect(result.answers).toEqual({
      reaction: { choice: "approved" },
      corrected: { noul: true },
      mood: { score: 1 },
    });
    const answer = result.answers?.reaction as Record<string, unknown>;
    expect("probabilities" in answer).toBe(false);
    expect("confidence" in answer).toBe(false);
  });

  test("the rendered prompt carries the state and each question", async () => {
    const f = infer(JSON.stringify({ reaction: "approved", corrected: true, mood: 1 }));
    await judge(
      { ...base, state: { message: "UNIQUE-STATE" } },
      { http: http().fn, infer: f.fn }
    );
    const prompt = `${f.calls[0]?.system ?? ""}\n${f.calls[0]?.user ?? ""}`;
    expect(prompt).toContain("UNIQUE-STATE");
    expect(prompt).toContain("How did the user react?");
    expect(prompt).toContain("Is it wrong?");
  });
});

describe("modes (criterion 8)", () => {
  test("a caller not listed is off: only the fallback runs", async () => {
    process.env.PAL_TYPESAFE_API_KEY = "k";
    settings({ provider: "typesafe", callers: { other: "live" } });
    const h = http();
    const f = infer();
    const result = await judge({ ...base, fallback }, { http: h.fn, infer: f.fn });
    expect(h.calls).toHaveLength(0);
    expect(f.calls).toHaveLength(1);
    expect(result.route).toBe("fallback");
  });

  test("shadow: both run and the fallback's answer is returned", async () => {
    on({ callers: { t: "shadow" } });
    const h = http();
    const f = infer();
    const result = await judge({ ...base, fallback }, { http: h.fn, infer: f.fn });
    expect(h.calls).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
    expect(result.route).toBe("fallback");
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
  });

  test("live: the System One answer is returned and the fallback does not run", async () => {
    on();
    const f = infer();
    const result = await judge({ ...base, fallback }, { http: http().fn, infer: f.fn });
    expect(result.route).toBe("system-one");
    expect(result.answers).toEqual(ANSWERS);
    expect(f.calls).toHaveLength(0);
  });

  test("live: the fallback runs when System One fails", async () => {
    on();
    const f = infer();
    const result = await judge(
      { ...base, fallback },
      { http: http({ error: "x" }, 500).fn, infer: f.fn }
    );
    expect(f.calls).toHaveLength(1);
    expect(result.route).toBe("fallback");
  });
});

describe("judge_call events (criteria 9, 10)", () => {
  test("a shadow call logs both sides, the cost and the mode", async () => {
    on({ callers: { t: "shadow" } });
    await judge(
      { ...base, fallback, sessionId: "s9" },
      { http: http().fn, infer: infer().fn }
    );
    const logged = events("judge_call");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      session: "s9",
      caller: "t",
      mode: "shadow",
      route: "fallback",
      provider: "typesafe",
      model: "jev-1.14.0",
      inputTokens: 1000,
      failure: null,
      systemOneAnswers: ANSWERS,
      fallbackAnswers: { reaction: { choice: "corrected" } },
    });
    expect(logged[0]?.costUsd as number).toBeCloseTo(0.000042, 9);
    expect(logged[0]?.latencyMs as number).toBeGreaterThanOrEqual(0);
  });

  test("a fallback-only call logs one event with no System One fields", async () => {
    await judge({ ...base, fallback }, { http: http().fn, infer: infer().fn });
    const logged = events("judge_call");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      caller: "t",
      mode: "off",
      route: "fallback",
      fallbackAnswers: { reaction: { choice: "corrected" } },
    });
    expect(logged[0]?.systemOneAnswers ?? null).toBeNull();
  });

  test("a System One failure is logged with its reason", async () => {
    on();
    await judge(
      { ...base, fallback },
      { http: http({ error: "x" }, 500).fn, infer: infer().fn }
    );
    expect(String(events("judge_call")[0]?.failure)).not.toBe("null");
    expect(events("judge_call")[0]?.failure).toBeTruthy();
  });

  test("each call appends exactly one event", async () => {
    on();
    const deps = { http: http().fn, infer: infer().fn };
    await judge(base, deps);
    await judge(base, deps);
    expect(events("judge_call")).toHaveLength(2);
  });

  test("jev-1.14.0 costs $0.042 per million input tokens with free output", () => {
    expect(MODEL_PRICING["jev-1.14.0"]).toBeDefined();
    const usage = {
      input: 1_000_000,
      output: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
    };
    expect(costOfUsage("jev-1.14.0", usage)).toBeCloseTo(0.042, 9);
    expect(costOfUsage("jev-1.14.0", { ...usage, input: 0, output: 5_000_000 })).toBe(0);
  });
});

describe("edge cases", () => {
  test("an unknown provider falls back and logs unknown-provider", async () => {
    settings({ provider: "nonesuch", callers: { t: "live" } });
    const f = infer();
    const result = await judge({ ...base, fallback }, { http: http().fn, infer: f.fn });
    expect(result.route).toBe("fallback");
    expect(f.calls).toHaveLength(1);
    expect(events("judge_call")[0]?.failure).toBe("unknown-provider");
  });

  test("an answer missing a question id is a bad-answer; live falls back", async () => {
    on();
    const { mood: _drop, ...partial } = ANSWERS;
    const f = infer();
    const result = await judge(
      { ...base, fallback },
      { http: http({ answers: partial, usage: { input_tokens: 5 } }).fn, infer: f.fn }
    );
    expect(result.route).toBe("fallback");
    expect(f.calls).toHaveLength(1);
    expect(events("judge_call")[0]?.failure).toBe("bad-answer");
  });

  test("a choice outside criteria is a bad-answer; shadow logs it and returns the fallback", async () => {
    on({ callers: { t: "shadow" } });
    const bad = {
      ...ANSWERS,
      reaction: { choice: "not-an-option", confidence: 1, probabilities: {} },
    };
    const result = await judge(
      { ...base, fallback },
      { http: http({ answers: bad, usage: { input_tokens: 5 } }).fn, infer: infer().fn }
    );
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
    expect(events("judge_call")[0]?.failure).toBe("bad-answer");
  });

  test("when the fallback also fails there are no answers and success is false", async () => {
    const result = await judge(
      { ...base, fallback },
      { http: http().fn, infer: infer("", false).fn }
    );
    expect(result.success).toBe(false);
    expect(result.answers).toBeUndefined();
  });

  test("a shadow System One call runs alongside the fallback, not before it", async () => {
    on({ callers: { t: "shadow" } });
    const order: string[] = [];
    const slowHttp = (async () => {
      order.push("http-start");
      await new Promise((r) => setTimeout(r, 150));
      order.push("http-end");

      return new Response(
        JSON.stringify({ answers: ANSWERS, usage: { input_tokens: 1 } })
      );
    }) as unknown as typeof fetch;
    const f: Infer = async () => {
      order.push("infer");

      return { success: true, output: '{"reaction":"corrected"}' };
    };
    await judge({ ...base, fallback }, { http: slowHttp, infer: f });
    expect(order.indexOf("infer")).toBeLessThan(order.indexOf("http-end"));
  });

  test("a shadow System One call that hangs never delays the caller past its timeout", async () => {
    on({ callers: { t: "shadow" } });
    const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
    const req = {
      ...base,
      fallback: { ...fallback, request: { ...FALLBACK_REQUEST, timeout: 100 } },
    };
    const started = Date.now();
    const result = await judge(req, { http: hang, infer: infer().fn });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.route).toBe("fallback");
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
  });

  test("the message is cut to 800 characters in the request", async () => {
    on();
    const h = http();
    await judge(
      { ...base, state: { message: "x".repeat(2000) }, fallback },
      { http: h.fn, infer: infer().fn }
    );
    const sent = JSON.parse(String(h.calls[0]?.init.body)).state.message as string;
    expect(sent.length).toBeLessThanOrEqual(800);
  });
});

// ---- One test per row of the plan's example tables (steps 4-9) ----

type Req = Parameters<typeof judge>[0];
type Deps = Parameters<typeof judge>[1];

const NOUL = { type: "noul", instructions: "n" } as const;

function deps(h: { fn: typeof fetch }, f: { fn: Infer }): Deps {
  return { http: h.fn, infer: f.fn, sleep: noSleep };
}

async function renderedCall(request: JudgeRequest): Promise<InferCall | undefined> {
  const f = infer();
  await judge(request, deps(http(), f));

  return f.calls[0];
}

function schemaProps(call: InferCall | undefined): Record<string, unknown> {
  return (call?.jsonSchema?.properties ?? {}) as Record<string, unknown>;
}

const VALID_ANSWERS = {
  reaction: {
    choice: "approved",
    confidence: 0.9,
    probabilities: { approved: 0.9, corrected: 0.1 },
  },
  corrected: { noul: false },
  mood: { score: 2, probabilities: [0.1, 0.3, 0.6] },
};

describe("answersProblem table (plan step 4)", () => {
  test("valid answers for every asked id give no problem", () => {
    expect(answersProblem(QUESTIONS, VALID_ANSWERS)).toBeNull();
  });

  test("an asked id left out is reported as missing", () => {
    const rest = { reaction: VALID_ANSWERS.reaction, corrected: VALID_ANSWERS.corrected };
    expect(answersProblem(QUESTIONS, rest)).toBe("mood: missing");
  });

  test("a choice outside the criteria is reported", () => {
    const bad = { ...VALID_ANSWERS, reaction: { choice: "not-an-option" } };
    expect(answersProblem(QUESTIONS, bad)).toBe("reaction: choice not in criteria");
  });

  test("a noul given as a number in [0, 1] is valid", () => {
    expect(
      answersProblem(QUESTIONS, { ...VALID_ANSWERS, corrected: { noul: 0.7 } })
    ).toBeNull();
  });

  test("a score past the last level index is reported", () => {
    expect(answersProblem(QUESTIONS, { ...VALID_ANSWERS, mood: { score: 3 } })).toBe(
      "mood: score is not a level index"
    );
  });

  test("null answers are reported as not an object", () => {
    expect(answersProblem(QUESTIONS, null)).toBe("answers is not an object");
  });

  test("an extra answer for an id that was not asked is ignored", () => {
    expect(
      answersProblem(QUESTIONS, { ...VALID_ANSWERS, extra: { choice: "x" } })
    ).toBeNull();
  });
});

describe("judgeRequestJson table (plan step 4)", () => {
  test("a noul question with a caller and a string state parses", () => {
    expect(
      judgeRequestJson.safeParse({
        caller: "cli-smoke",
        state: "hello",
        questions: { q: { type: "noul", instructions: "Is it a greeting?" } },
      }).success
    ).toBe(true);
  });

  test("a fallback key is rejected, since a parse function cannot travel in JSON", () => {
    expect(
      judgeRequestJson.safeParse({
        caller: "cli-smoke",
        state: "hello",
        questions: { q: { type: "noul", instructions: "Is it a greeting?" } },
        fallback: {},
      }).success
    ).toBe(false);
  });

  test("a numeric state is rejected", () => {
    expect(
      judgeRequestJson.safeParse({ caller: "x", state: 1, questions: {} }).success
    ).toBe(false);
  });

  test("a score question with an object state parses", () => {
    expect(
      judgeRequestJson.safeParse({
        caller: "x",
        state: { a: 1 },
        questions: { s: { type: "score", instructions: "?", criteria: ["lo", "hi"] } },
      }).success
    ).toBe(true);
  });
});

describe("retry backoff table (plan step 5)", () => {
  async function sleepsOnEvery429(): Promise<number[]> {
    on();
    const sleeps: number[] = [];
    await judge(
      { ...base, fallback },
      {
        http: http({}, 429).fn,
        infer: infer().fn,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }
    );

    return sleeps;
  }

  test("attempt 0 waits 1000 ms", async () => {
    expect((await sleepsOnEvery429())[0]).toBe(1000);
  });

  test("attempt 1 waits 2000 ms", async () => {
    expect((await sleepsOnEvery429())[1]).toBe(2000);
  });

  test("attempt 3 waits 8000 ms", async () => {
    expect((await sleepsOnEvery429())[3]).toBe(8000);
  });
});

describe("inputTokensOf table (plan step 5)", () => {
  async function loggedTokens(reply: unknown): Promise<unknown> {
    on({ callers: { t: "live" } });
    await judge({ ...base, fallback }, deps(http(reply), infer()));

    return events("judge_call")[0]?.inputTokens;
  }

  test("a numeric usage.input_tokens is the input token count", async () => {
    expect(await loggedTokens({ usage: { input_tokens: 1000 } })).toBe(1000);
  });

  test("a reply without usage counts 0 input tokens", async () => {
    expect(await loggedTokens({ answers: {} })).toBe(0);
  });

  test("a non-numeric input_tokens counts 0 input tokens", async () => {
    expect(await loggedTokens({ usage: { input_tokens: "9" } })).toBe(0);
  });
});

describe("the fallback request table (plan step 6)", () => {
  test("a caller's own fallback request is run exactly, the same reference", async () => {
    const f = infer();
    await judge({ ...base, fallback }, deps(http(), f));
    expect(f.calls[0]).toBe(FALLBACK_REQUEST);
  });

  test("with no fallback the rendered request is a small-tier call with the caller's JSON state", async () => {
    const f = infer();
    await judge(
      { caller: "t", state: { message: "m" }, questions: QUESTIONS },
      deps(http(), f)
    );
    expect(f.calls[0]?.tier).toBe("small");
    expect(f.calls[0]?.caller).toBe("t");
    expect(f.calls[0]?.timeout).toBe(90_000);
    expect(f.calls[0]?.user).toBe('{\n  "message": "m"\n}');
  });

  test("a string state is the rendered user text as given", async () => {
    const call = await renderedCall({
      caller: "t",
      state: "plain",
      questions: QUESTIONS,
    });
    expect(call?.user).toBe("plain");
  });

  test("three questions give a maxTokens of 300", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: QUESTIONS });
    expect(call?.maxTokens).toBe(300);
  });
});

describe("renderedMaxTokens table (plan step 6)", () => {
  test("one question gives 200", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: { q: NOUL } });
    expect(call?.maxTokens).toBe(200);
  });

  test("no questions gives 200", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: {} });
    expect(call?.maxTokens).toBe(200);
  });

  test("three questions give 300", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: QUESTIONS });
    expect(call?.maxTokens).toBe(300);
  });

  test("five questions give 500", async () => {
    const call = await renderedCall({
      caller: "t",
      state: "s",
      questions: { q1: NOUL, q2: NOUL, q3: NOUL, q4: NOUL, q5: NOUL },
    });
    expect(call?.maxTokens).toBe(500);
  });
});

describe("stateText table (plan step 6)", () => {
  test("a string state is rendered as is", async () => {
    const call = await renderedCall({ caller: "t", state: "hello", questions: {} });
    expect(call?.user).toBe("hello");
  });

  test("an object state is rendered as indented JSON", async () => {
    const call = await renderedCall({
      caller: "t",
      state: { message: "UNIQUE-STATE" },
      questions: {},
    });
    expect(call?.user).toBe('{\n  "message": "UNIQUE-STATE"\n}');
  });

  test("an empty object state is rendered as {}", async () => {
    const call = await renderedCall({ caller: "t", state: {}, questions: {} });
    expect(call?.user).toBe("{}");
  });
});

describe("answerSchema table (plan step 6)", () => {
  test("a choice question becomes an enum of its criteria", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: QUESTIONS });
    expect(schemaProps(call).reaction).toEqual({ enum: ["corrected", "approved"] });
  });

  test("a noul question becomes a boolean", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: QUESTIONS });
    expect(schemaProps(call).corrected).toEqual({ type: "boolean" });
  });

  test("a score question becomes an integer from 0 to its last level", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: QUESTIONS });
    expect(schemaProps(call).mood).toEqual({ type: "integer", minimum: 0, maximum: 2 });
  });
});

describe("renderedSystem table (plan step 6)", () => {
  test("a choice question names its type and lists its option", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: QUESTIONS });
    expect(String(call?.system)).toContain("reaction (choice): How did the user react?");
    expect(String(call?.system)).toContain("- corrected: it was wrong");
  });

  test("a noul question names its type and asks for true or false", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: QUESTIONS });
    expect(String(call?.system)).toContain("corrected (noul): Is it wrong?");
    expect(String(call?.system)).toContain("Answer true or false.");
  });

  test("a score question lists each level by its index", async () => {
    const call = await renderedCall({ caller: "t", state: "s", questions: QUESTIONS });
    expect(String(call?.system)).toContain("- 0: low");
    expect(String(call?.system)).toContain("- 2: high");
  });

  test("a structured criterion is rendered as key: value pairs with arrays joined by semicolons", async () => {
    const questions = {
      c: {
        type: "choice",
        instructions: "pick",
        criteria: { c: { means: "x", covers: ["a", "b"] } },
      },
    } as const;
    const call = await renderedCall({ caller: "t", state: "s", questions });
    expect(String(call?.system)).toContain("means: x; covers: a; b");
  });
});

describe("answersFromReply table (plan step 6)", () => {
  async function renderedResult(output: string): Promise<JudgeResult> {
    return judge(
      { caller: "t", state: "s", questions: QUESTIONS },
      deps(http(), infer(output))
    );
  }

  test("a reply with every question maps to the answer types", async () => {
    const result = await renderedResult(
      '{"reaction":"approved","corrected":true,"mood":1}'
    );
    expect(result.answers).toEqual({
      reaction: { choice: "approved" },
      corrected: { noul: true },
      mood: { score: 1 },
    });
  });

  test("a reply with a choice outside the criteria gives no answers", async () => {
    const result = await renderedResult('{"reaction":"nope","corrected":true,"mood":1}');
    expect(result.success).toBe(false);
    expect(result.answers).toBeUndefined();
  });

  test("a reply that is not JSON gives no answers", async () => {
    const result = await renderedResult("not json");
    expect(result.success).toBe(false);
    expect(result.answers).toBeUndefined();
  });

  test("JSON inside surrounding text is still read", async () => {
    const result = await renderedResult(
      'text {"reaction":"corrected","corrected":false,"mood":0} text'
    );
    expect(result.answers).toEqual({
      reaction: { choice: "corrected" },
      corrected: { noul: false },
      mood: { score: 0 },
    });
  });
});

describe("judge() scenario table (plan step 8)", () => {
  test("no settings: the fallback answers and System One is never called", async () => {
    const h = http();
    const f = infer();
    const result = await judge({ ...base, fallback }, deps(h, f));
    expect(result.route).toBe("fallback");
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
    expect(f.calls).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
    expect(events("judge_call")[0]?.failure).toBeNull();
  });

  test("live with a key: System One answers and the fallback does not run", async () => {
    on();
    const h = http();
    const f = infer();
    const result = await judge({ ...base, fallback }, deps(h, f));
    expect(result.route).toBe("system-one");
    expect(result.answers).toEqual(ANSWERS);
    expect(f.calls).toHaveLength(0);
    expect(h.calls).toHaveLength(1);
  });

  test("live with no key: the fallback answers and the event says no-key", async () => {
    settings({ provider: "typesafe", callers: { t: "live" } });
    const h = http();
    const f = infer();
    const result = await judge({ ...base, fallback }, deps(h, f));
    expect(result.route).toBe("fallback");
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
    expect(f.calls).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
    expect(events("judge_call")[0]?.failure).toBe("no-key");
  });

  test("live with an unknown provider: the fallback answers and the event says unknown-provider", async () => {
    settings({ provider: "nonesuch", callers: { t: "live" } });
    const h = http();
    const f = infer();
    const result = await judge({ ...base, fallback }, deps(h, f));
    expect(result.route).toBe("fallback");
    expect(f.calls).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
    expect(events("judge_call")[0]?.failure).toBe("unknown-provider");
  });

  test("live with 429 on every try: five POSTs, then the fallback, rate-limited", async () => {
    on();
    const h = http({}, 429);
    const f = infer();
    const result = await judge({ ...base, fallback }, deps(h, f));
    expect(result.route).toBe("fallback");
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
    expect(f.calls).toHaveLength(1);
    expect(h.calls).toHaveLength(5);
    expect(events("judge_call")[0]?.failure).toBe("rate-limited");
  });

  test("live with a hanging call and a 50 ms timeout: the fallback answers, timeout", async () => {
    on();
    let hangs = 0;
    const hanging = (async () => {
      hangs++;

      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const f = infer();
    const quick = { ...fallback, request: { ...FALLBACK_REQUEST, timeout: 50 } };
    const result = await judge(
      { ...base, fallback: quick },
      { http: hanging, infer: f.fn, sleep: noSleep }
    );
    expect(result.route).toBe("fallback");
    expect(f.calls).toHaveLength(1);
    expect(hangs).toBe(1);
    expect(events("judge_call")[0]?.failure).toBe("timeout");
  });

  test("shadow with a key: both sides run, the fallback's answers are returned, and the event holds System One's answers and the cost", async () => {
    on({ callers: { t: "shadow" } });
    const h = http();
    const f = infer();
    const result = await judge({ ...base, fallback }, deps(h, f));
    expect(result.route).toBe("fallback");
    expect(result.answers).toEqual({ reaction: { choice: "corrected" } });
    expect(f.calls).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
    const ev = events("judge_call")[0];
    expect(ev?.failure).toBeNull();
    expect(ev?.systemOneAnswers).toEqual(ANSWERS);
    expect(ev?.costUsd as number).toBeCloseTo(0.000042, 9);
  });

  test("off for an unlisted caller: the fallback's failure is returned as success false, with no answers", async () => {
    on({ callers: { other: "live" } });
    const h = http();
    const f = infer('{"reaction":"corrected"}', false);
    const result = await judge({ ...base, fallback }, deps(h, f));
    expect(result.success).toBe(false);
    expect(result.route).toBe("fallback");
    expect(result.answers).toBeUndefined();
    expect(f.calls).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
    expect(events("judge_call")[0]?.failure).toBeNull();
  });

  test("shadow with a key and a fallback that throws: one event with System One's answers and no fallback answers", async () => {
    on({ callers: { t: "shadow" } });
    const h = http();
    const calls: InferCall[] = [];
    const throwing: Infer = async (call) => {
      calls.push(call);
      throw new Error("infer broke");
    };
    const result = await judge({ ...base, fallback }, deps(h, { fn: throwing }));
    expect(result.success).toBe(false);
    expect(result.answers).toBeUndefined();
    expect(result.route).toBe("fallback");
    expect(calls).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
    const logged = events("judge_call");
    expect(logged).toHaveLength(1);
    expect(logged[0]?.systemOneAnswers).toEqual(ANSWERS);
    expect(logged[0]?.fallbackAnswers).toBeUndefined();
  });
});

describe("boundedState table (plan step 8)", () => {
  function capturing(seen: unknown[]): JudgeAdapter {
    return {
      defaultModel: "fake-1",
      keyNames: [],
      ask: async (input) => {
        seen.push(input.state);

        return { answers: ANSWERS };
      },
    };
  }

  async function sentState(state: Req["state"]): Promise<unknown> {
    const seen: unknown[] = [];
    JUDGE_ADAPTERS.fake = capturing(seen);
    settings({ provider: "fake", callers: { t: "live" } });
    await judge({ ...base, state }, deps(http(), infer()));

    return seen[0];
  }

  test("an object whose message is over 800 characters is cut to 800", async () => {
    expect(await sentState({ message: "x".repeat(2000) })).toEqual({
      message: "x".repeat(800),
    });
  });

  test("the other fields of an object state are kept as they are", async () => {
    expect(await sentState({ message: "hi", reply_end: "r" })).toEqual({
      message: "hi",
      reply_end: "r",
    });
  });

  test("a string state is never cut", async () => {
    expect(await sentState("x".repeat(2000))).toEqual("x".repeat(2000));
  });

  test("a message that is not a string is left unchanged", async () => {
    expect(await sentState({ message: 5 })).toEqual({ message: 5 });
  });
});

describe("judgeMode table (plan step 8)", () => {
  async function modeOf(): Promise<unknown> {
    await judge({ ...base, fallback }, deps(http(), infer()));

    return events("judge_call")[0]?.mode;
  }

  test("no settings: the caller is off", async () => {
    expect(await modeOf()).toBe("off");
  });

  test("a caller listed as shadow is shadow", async () => {
    on({ callers: { t: "shadow" } });
    expect(await modeOf()).toBe("shadow");
  });

  test("only another caller listed as live leaves this caller off", async () => {
    settings({ provider: "typesafe", callers: { other: "live" } });
    expect(await modeOf()).toBe("off");
  });

  test("a mode that is not shadow or live is off", async () => {
    settings({ provider: "typesafe", callers: { t: "on" } });
    expect(await modeOf()).toBe("off");
  });
});

describe("systemOneCost table (plan step 8)", () => {
  test("jev-1.14.0 with 1000 input tokens costs 0.000042", async () => {
    on({ callers: { t: "shadow" } });
    await judge(
      { ...base, fallback },
      deps(http({ answers: ANSWERS, usage: { input_tokens: 1000 } }), infer())
    );
    expect(events("judge_call")[0]?.costUsd as number).toBeCloseTo(0.000042, 9);
  });

  test("jev-1.14.0 with 1 000 000 input tokens costs 0.042", async () => {
    on({ callers: { t: "shadow" } });
    await judge(
      { ...base, fallback },
      deps(http({ answers: ANSWERS, usage: { input_tokens: 1_000_000 } }), infer())
    );
    expect(events("judge_call")[0]?.costUsd as number).toBeCloseTo(0.042, 9);
  });

  test("an unpriced model costs 0", async () => {
    JUDGE_ADAPTERS.fake = {
      defaultModel: "fake-1",
      keyNames: [],
      ask: async () => ({ answers: ANSWERS, inputTokens: 10 }),
    };
    settings({ provider: "fake", callers: { t: "shadow" } });
    await judge({ ...base, fallback }, deps(http(), infer()));
    expect(events("judge_call")[0]?.costUsd).toBe(0);
  });
});

describe("judgment helper rows (plan step 9)", () => {
  test("a reaction judgment has caller reaction, the exchange as state, the reaction question and the session", () => {
    const req = reactionJudgment("CI is green.", "ci is not green btw", "s1");
    expect(req.caller).toBe("reaction");
    expect(req.state).toEqual({
      reply_end: "CI is green.",
      message: "ci is not green btw",
    });
    expect(Object.keys(req.questions)).toEqual(["reaction"]);
    expect(req.questions.reaction?.type).toBe("choice");
    expect(req.sessionId).toBe("s1");
  });

  test("without a session the judgment's sessionId is undefined", () => {
    const req = reactionJudgment("CI is green.", "ci is not green btw");
    expect(req.sessionId).toBeUndefined();
  });
});

describe("judgment builders table (plan step 9)", () => {
  test("reactionJudgment keeps the reaction request as its fallback", () => {
    const req = reactionJudgment("CI is green.", "ci is not green btw", "s1");
    expect(req.fallback?.request).toEqual(
      reactionRequest("CI is green.", "ci is not green btw", "s1")
    );
  });

  test("correctionCheckJudgment does not cut the message; judge() does", () => {
    const req = correctionCheckJudgment("r", "x".repeat(900));
    expect(req.caller).toBe("correction-check");
    expect(req.state).toEqual({ reply_end: "r", message: "x".repeat(900) });
    expect(req.fallback?.request).toEqual(
      correctionCheckRequest("r", "x".repeat(900), undefined)
    );
  });

  test("correctionKindJudgment adds the first reader's issue to the state", () => {
    const req = correctionKindJudgment("r", "m", "Said CI was green");
    expect(req.caller).toBe("correction-kind");
    expect(req.state).toEqual({
      reply_end: "r",
      message: "m",
      first_reader_issue: "Said CI was green",
    });
    expect(req.fallback?.request).toEqual(
      correctionKindRequest("r", "m", "Said CI was green", undefined)
    );
  });
});

function parserOf(req: JudgeRequest): (output: string) => unknown {
  if (!req.fallback) throw new Error("no fallback");

  return req.fallback.parse;
}

describe("fallback parsers table (plan step 9)", () => {
  const reaction = (output: string) => parserOf(reactionJudgment("r", "m"))(output);
  const corrected = (output: string) =>
    parserOf(correctionCheckJudgment("r", "m"))(output);
  const kind = (output: string) =>
    parserOf(correctionKindJudgment("r", "m", "i"))(output);

  test("a reaction output with a known label maps to a choice", () => {
    expect(reaction('{"reaction":"corrected","issue":"x"}')).toEqual({
      reaction: { choice: "corrected" },
    });
  });

  test("a reaction output with an unknown label gives null", () => {
    expect(reaction('{"reaction":"nope"}')).toBeNull();
  });

  test("a corrected output with a corrected label is noul true", () => {
    expect(corrected('{"reaction":"corrected","issue":"x"}')).toEqual({
      corrected: { noul: true },
    });
  });

  test("a corrected output with any other label is noul false", () => {
    expect(corrected('{"reaction":"not-corrected","issue":""}')).toEqual({
      corrected: { noul: false },
    });
  });

  test("a corrected output that is not JSON gives null", () => {
    expect(corrected("not json")).toBeNull();
  });

  test("a kind output with a known kind maps to a choice", () => {
    expect(kind('{"kind":"unverified-claim","suggested":"","description":""}')).toEqual({
      kind: { choice: "unverified-claim" },
    });
  });

  test("a kind output that is cut off gives null", () => {
    expect(kind("{")).toBeNull();
  });
});

describe("label mapper table (plan step 9)", () => {
  test("a fallback reaction output maps to its label", () => {
    const result: JudgeResult = {
      success: true,
      route: "fallback",
      answers: { reaction: { choice: "corrected" } },
      fallbackOutput: '{"reaction":"corrected","issue":"Said CI was green"}',
    };
    expect(reactionLabelOf(result)).toEqual({
      reaction: "corrected",
      issue: "Said CI was green",
    });
  });

  test("a System One answer with no fallback output is no label", () => {
    const result: JudgeResult = {
      success: true,
      route: "system-one",
      answers: { reaction: { choice: "praised" } },
    };
    expect(reactionLabelOf(result)).toBeNull();
  });

  test("a failed fallback is no label", () => {
    expect(reactionLabelOf({ success: false, route: "fallback" })).toBeNull();
  });

  test("a fallback correction check output maps to its label", () => {
    const result: JudgeResult = {
      success: true,
      route: "fallback",
      fallbackOutput: '{"reaction":"not-corrected","issue":""}',
      answers: { corrected: { noul: false } },
    };
    expect(correctionCheckOf(result)).toEqual({ reaction: "follow-up", issue: "" });
  });

  test("a System One correction check with no fallback output is no label", () => {
    const result: JudgeResult = {
      success: true,
      route: "system-one",
      answers: { corrected: { noul: true } },
    };
    expect(correctionCheckOf(result)).toBeNull();
  });

  test("a fallback kind output maps to its kind", () => {
    const result: JudgeResult = {
      success: true,
      route: "fallback",
      fallbackOutput: '{"kind":"unverified-claim","suggested":"","description":""}',
      answers: { kind: { choice: "unverified-claim" } },
    };
    expect(correctionKindOf(result)).toEqual({
      kind: "unverified-claim",
      suggested: "",
      description: "",
    });
  });

  test("a failed fallback whose output names an unknown kind maps to other", () => {
    const result: JudgeResult = {
      success: false,
      route: "fallback",
      fallbackOutput: '{"kind":"bogus kind"}',
    };
    expect(correctionKindOf(result)).toEqual({
      kind: "other",
      suggested: "bogus kind",
      description: "",
    });
  });
});
