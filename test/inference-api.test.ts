import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildOpenAiBody,
  inferenceViaApi,
  inferenceViaOpenAiApi,
} from "../src/hooks/lib/inference-api";
import type { InferenceOptions, InferenceResult } from "../src/hooks/lib/inference-types";
import { debugHome } from "./lib/fake-spawn";
import { restoreEnv, savedEnv } from "./lib/inference-dispatch-fixture";

const BASELINE = savedEnv();
const KEY_ENV = ["PAL_ANTHROPIC_API_KEY", "PAL_OPENAI_API_KEY"];
let home = { home: "", log: () => "" };

interface Sent {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

type Responder = (init: RequestInit) => Promise<Response> | Response;
type Route = (opts: InferenceOptions) => Promise<InferenceResult>;

function clearKeys() {
  for (const name of KEY_ENV) delete process.env[name];
}

beforeEach(() => {
  restoreEnv(BASELINE);
  clearKeys();
  home = debugHome(import.meta.file);
});

async function post(
  respond: Responder,
  route: Route,
  opts: InferenceOptions,
  key: Record<string, string> = {}
): Promise<{ result: InferenceResult; sent: Sent[] }> {
  const realFetch = globalThis.fetch;
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init, body: JSON.parse(String(init.body)) });

    return respond(init);
  }) as typeof fetch;
  Object.assign(process.env, key);

  try {
    return { result: await route(opts), sent };
  } finally {
    globalThis.fetch = realFetch;
    clearKeys();
  }
}

const json = (value: unknown, status = 200) => Response.json(value, { status });

function waitForAbort(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new Error("aborted by timer")));
  });
}

function brokenErrorBody(): Response {
  return {
    ok: false,
    status: 502,
    text: () => Promise.reject(new Error("no body")),
  } as unknown as Response;
}

interface RouteCase {
  name: string;
  keyEnv: string;
  call: Route;
  logSource: string;
  reply: (text: string, usage?: unknown) => unknown;
  malformed: unknown[];
}

const ROUTES: RouteCase[] = [
  {
    name: "anthropic",
    keyEnv: "PAL_ANTHROPIC_API_KEY",
    call: inferenceViaApi,
    logSource: "inference",
    reply: (text, usage) => ({ content: [{ text }], usage }),
    malformed: [null, { content: [] }, { content: [{}] }],
  },
  {
    name: "openai",
    keyEnv: "PAL_OPENAI_API_KEY",
    call: inferenceViaOpenAiApi,
    logSource: "inference:openai",
    reply: (text, usage) => ({ choices: [{ message: { content: text } }], usage }),
    malformed: [null, { choices: [] }, { choices: [{}] }, { choices: [{ message: {} }] }],
  },
];

describe.each(ROUTES)("$name route", (route) => {
  const keyed = (respond: Responder, opts: InferenceOptions = { user: "hi" }) =>
    post(respond, route.call, opts, { [route.keyEnv]: "sk-test" });

  test("without a key it never calls out", async () => {
    const { result, sent } = await post(() => json({}), route.call, { user: "hi" });

    expect(result).toStrictEqual({ success: false });
    expect(sent).toHaveLength(0);
  });

  test("reads the key from the PAL .env file", async () => {
    writeFileSync(resolve(home.home, ".env"), `${route.keyEnv}=sk-file\n`);
    const { result, sent } = await post(() => json(route.reply("ok")), route.call, {
      user: "hi",
    });

    expect(result.output).toBe("ok");
    expect(JSON.stringify(sent[0].init.headers)).toContain("sk-file");
  });

  test("returns the trimmed reply with no usage when none is reported", async () => {
    const { result, sent } = await keyed(() => json(route.reply("  hello \n")));

    expect(result).toStrictEqual({ success: true, output: "hello", usage: undefined });
    expect(sent[0].init.method).toBe("POST");
  });

  test("an empty reply fails but keeps the usage", async () => {
    const usage = { prompt_tokens: 3, input_tokens: 3 };
    const { result } = await keyed(() => json(route.reply("   ", usage)));

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.usage?.inputTokens).toBe(3);
  });

  test("a malformed reply fails without throwing", async () => {
    for (const body of route.malformed) {
      const { result } = await keyed(() => json(body));

      expect(result).toStrictEqual({ success: false, usage: undefined });
    }

    expect(home.log()).not.toContain("ERROR");
  });

  test("a reply with no content fails", async () => {
    const { result } = await keyed(() => json({}));

    expect(result).toStrictEqual({ success: false, usage: undefined });
  });

  test("an HTTP error logs the status and at most 200 characters of the body", async () => {
    const { result } = await keyed(() => new Response("b".repeat(300), { status: 429 }));

    expect(result).toStrictEqual({ success: false });
    expect(home.log()).toContain(
      `ERROR ${route.logSource}: HTTP 429: ${"b".repeat(200)}\n`
    );
  });

  test("an HTTP error with an unreadable body logs the status alone", async () => {
    const { result } = await keyed(brokenErrorBody);

    expect(result).toStrictEqual({ success: false });
    expect(home.log()).toContain(`ERROR ${route.logSource}: HTTP 502: \n`);
  });

  test("a network failure is logged", async () => {
    const { result } = await keyed(() => {
      throw new Error("connection refused");
    });

    expect(result).toStrictEqual({ success: false });
    expect(home.log()).toContain(`ERROR ${route.logSource}: connection refused`);
  });

  test("the timeout aborts the request", async () => {
    const { result } = await keyed(waitForAbort, { user: "hi", timeout: 10 });

    expect(result).toStrictEqual({ success: false });
    expect(home.log()).toContain(`ERROR ${route.logSource}: aborted by timer`);
  });
});

describe("inferenceViaApi", () => {
  const anthropic = (respond: Responder, opts: InferenceOptions = { user: "hi" }) =>
    post(respond, inferenceViaApi, opts, { PAL_ANTHROPIC_API_KEY: "sk-ant" });
  const ok = () => json({ content: [{ text: "ok" }] });

  test("posts the messages request with the key and API version", async () => {
    const { sent } = await anthropic(ok);

    expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent[0].init.headers).toEqual({
      "x-api-key": "sk-ant",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(sent[0].body).toEqual({
      model: expect.any(String),
      max_tokens: 200,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("adds the system prompt, token cap and schema when given", async () => {
    const schema = { type: "object" };
    const { sent } = await anthropic(ok, {
      user: "hi",
      system: "be brief",
      maxTokens: 50,
      jsonSchema: schema,
    });

    expect(sent[0].body).toMatchObject({
      max_tokens: 50,
      system: "be brief",
      output_config: { format: { type: "json_schema", schema } },
    });
  });

  test("maps the reported usage", async () => {
    const usage = { input_tokens: 4, output_tokens: 2 };
    const { result } = await anthropic(() => json({ content: [{ text: "ok" }], usage }));

    expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 2 });
  });
});

describe("inferenceViaOpenAiApi", () => {
  const openai = (respond: Responder) =>
    post(
      respond,
      inferenceViaOpenAiApi,
      { user: "hi" },
      { PAL_OPENAI_API_KEY: "sk-oai" }
    );

  test("posts the chat completion with a bearer key", async () => {
    const { sent } = await openai(() =>
      json({ choices: [{ message: { content: "ok" } }] })
    );

    expect(sent[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent[0].init.headers).toEqual({
      Authorization: "Bearer sk-oai",
      "content-type": "application/json",
    });
    expect(sent[0].body).toEqual(buildOpenAiBody({ user: "hi" }));
  });

  test("maps the reported usage", async () => {
    const usage = { prompt_tokens: 5, completion_tokens: 1 };
    const { result } = await openai(() =>
      json({ choices: [{ message: { content: "ok" } }], usage })
    );

    expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 1 });
  });
});

describe("buildOpenAiBody", () => {
  test("defaults to a 500-token user-only request", () => {
    expect(buildOpenAiBody({ user: "hi" })).toEqual({
      model: expect.any(String),
      max_tokens: 500,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("puts the system message first and asks for strict schema output", () => {
    const schema = { type: "object" };
    const body = buildOpenAiBody({
      user: "hi",
      system: "sys",
      maxTokens: 9,
      jsonSchema: schema,
    });

    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(body.max_tokens).toBe(9);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "structured_response", strict: true, schema },
    });
  });
});
