/**
 * judge(): typed questions answered by the configured System One model, the small tier as fallback, every call logged as judge_call.
 */

import { inference } from "./inference";
import { logJudgeCall } from "./judge-events";
import { fallbackFor } from "./judge-fallback";
import {
  answersProblem,
  type JudgeAdapter,
  type JudgeAnswers,
  type JudgeFallback,
  type JudgeMode,
  type JudgeRequest,
  type JudgeResult,
  type JudgeState,
  SystemOneError,
  type SystemOneFailure,
} from "./judgment";
import { logError } from "./log";
import { costOfUsage } from "./models";
import { withPalEnv } from "./pal-env";
import { systemOneSettings } from "./settings";
import { typesafeAdapter } from "./system-one-typesafe";

export type { JudgeAdapter } from "./judgment";
export { TYPESAFE_DEFAULT_MODEL } from "./system-one-typesafe";

export const JUDGE_ADAPTERS: Record<string, JudgeAdapter> = { typesafe: typesafeAdapter };

interface JudgeDeps {
  http?: typeof fetch;
  infer?: typeof inference;
  sleep?: (ms: number) => Promise<void>;
}

const MESSAGE_MAX = 800;
const DEFAULT_DEADLINE_MS = 15_000;

function boundedState(state: JudgeState): JudgeState {
  if (typeof state === "object") {
    const message = state.message;
    if (typeof message === "string")
      return { ...state, message: message.slice(0, MESSAGE_MAX) };
  }

  return state;
}

function judgeMode(caller: string): JudgeMode {
  const mode = systemOneSettings()?.callers?.[caller];

  return mode === "shadow" || mode === "live" ? mode : "off";
}

function systemOneCost(model: string, inputTokens: number): number {
  return costOfUsage(model, {
    input: inputTokens,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
  });
}

type SystemOneSetup =
  | { adapter: JudgeAdapter; provider: string; model: string; apiKey: string }
  | { failure: SystemOneFailure; provider: string | null; model: string | null };

function resolveSystemOne(): SystemOneSetup {
  const settings = systemOneSettings();
  const provider = settings?.provider;
  if (typeof provider !== "string" || !provider) {
    return { failure: "no-provider", provider: null, model: null };
  }

  if (!Object.hasOwn(JUDGE_ADAPTERS, provider)) {
    return { failure: "unknown-provider", provider, model: null };
  }

  const adapter = JUDGE_ADAPTERS[provider];
  const configured = settings?.model;
  const model =
    typeof configured === "string" && configured ? configured : adapter.defaultModel;
  let apiKey = "";

  if (adapter.keyNames.length > 0) {
    const env = withPalEnv();
    const found = adapter.keyNames.map((name) => env[name]).find(Boolean);
    if (!found) return { failure: "no-key", provider, model };
    apiKey = found;
  }

  return { adapter, provider, model, apiKey };
}

async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SystemOneError("timeout"));
    }, ms);
  });

  try {
    return await Promise.race([work(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

interface SystemOneOutcome {
  provider: string | null;
  model: string | null;
  answers?: JudgeAnswers;
  inputTokens: number | null;
  latencyMs: number | null;
  failure: SystemOneFailure | null;
}

async function askSystemOne(
  request: JudgeRequest,
  deadlineMs: number,
  http: typeof fetch,
  sleep: (ms: number) => Promise<void>
): Promise<SystemOneOutcome> {
  const setup = resolveSystemOne();
  if ("failure" in setup) {
    return {
      provider: setup.provider,
      model: setup.model,
      inputTokens: null,
      latencyMs: null,
      failure: setup.failure,
    };
  }

  const { adapter, provider, model, apiKey } = setup;
  const started = performance.now();

  try {
    const reply = await withDeadline(
      (signal) =>
        adapter.ask({
          model,
          state: request.state,
          questions: request.questions,
          apiKey,
          http,
          sleep,
          signal,
        }),
      deadlineMs
    );
    const inputTokens = reply.inputTokens ?? 0;
    const latencyMs = Math.round(performance.now() - started);

    if (answersProblem(request.questions, reply.answers) !== null) {
      return { provider, model, inputTokens, latencyMs, failure: "bad-answer" };
    }

    return {
      provider,
      model,
      answers: reply.answers,
      inputTokens,
      latencyMs,
      failure: null,
    };
  } catch (err) {
    const failure = err instanceof SystemOneError ? err.failure : "http";

    return {
      provider,
      model,
      inputTokens: null,
      latencyMs: Math.round(performance.now() - started),
      failure,
    };
  }
}

interface FallbackOutcome {
  answers?: JudgeAnswers;
  output?: string;
}

async function runFallback(
  fallback: JudgeFallback,
  infer: typeof inference
): Promise<FallbackOutcome> {
  let result: Awaited<ReturnType<typeof inference>>;

  try {
    result = await infer(fallback.request);
  } catch (err) {
    logError("judge:fallback", err);

    return {};
  }

  if (!result.success || !result.output) return {};
  const output = result.output;
  let answers: JudgeAnswers | null;

  try {
    answers = fallback.parse(output);
  } catch {
    answers = null;
  }

  return { output, answers: answers ?? undefined };
}

const NOT_RUN: SystemOneOutcome = {
  provider: null,
  model: null,
  inputTokens: null,
  latencyMs: null,
  failure: null,
};

export async function judge(
  request: JudgeRequest,
  deps: JudgeDeps = {}
): Promise<JudgeResult> {
  const http = deps.http ?? fetch;
  const infer = deps.infer ?? inference;
  const sleep = deps.sleep ?? Bun.sleep;
  const bounded = { ...request, state: boundedState(request.state) };
  const mode = judgeMode(request.caller);
  const fallback = fallbackFor(bounded);
  const deadlineMs = fallback.request.timeout ?? DEFAULT_DEADLINE_MS;

  let one: SystemOneOutcome = NOT_RUN;
  let fb: FallbackOutcome | undefined;

  if (mode === "off") {
    fb = await runFallback(fallback, infer);
  } else if (mode === "shadow") {
    [one, fb] = await Promise.all([
      askSystemOne(bounded, deadlineMs, http, sleep),
      runFallback(fallback, infer),
    ]);
  } else {
    one = await askSystemOne(bounded, deadlineMs, http, sleep);
    if (!one.answers) fb = await runFallback(fallback, infer);
  }

  const result: JudgeResult =
    mode === "live" && one.answers
      ? { success: true, route: "system-one", answers: one.answers }
      : {
          success: Boolean(fb?.answers),
          route: "fallback",
          answers: fb?.answers,
          fallbackOutput: fb?.output,
        };

  logJudgeCall(
    {
      caller: request.caller,
      mode,
      route: result.route,
      provider: one.provider,
      model: one.model,
      inputTokens: one.inputTokens,
      costUsd:
        one.inputTokens === null || one.model === null
          ? null
          : systemOneCost(one.model, one.inputTokens),
      latencyMs: one.latencyMs,
      failure: one.failure,
      systemOneAnswers: one.answers,
      fallbackAnswers: fb?.answers,
    },
    request.sessionId
  );

  return result;
}
