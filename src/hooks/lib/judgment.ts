/**
 * The words every System One judgment shares: questions, answers, requests, results, the adapter contract and the answer check.
 */

import { z } from "zod";
import type { inference } from "./inference";

type InferenceRequest = Parameters<typeof inference>[0];

export type JudgeState = string | Record<string, unknown>;
type Instructions = string | Readonly<Record<string, string>>;
type Criterion =
  | string
  | readonly string[]
  | Readonly<Record<string, string | readonly string[]>>;
type ChoiceQuestion = {
  type: "choice";
  instructions: Instructions;
  criteria: Readonly<Record<string, Criterion>>;
};
type NoulQuestion = {
  type: "noul";
  instructions: Instructions;
  criteria?: { true?: Criterion; false?: Criterion };
};
type ScoreQuestion = {
  type: "score";
  instructions: Instructions;
  criteria: readonly Criterion[];
};
export type JudgeQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;
export type JudgeQuestions = Readonly<Record<string, JudgeQuestion>>;
type ChoiceAnswer = {
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};
type NoulAnswer = { noul: boolean | number };
type ScoreAnswer = {
  score: number;
  confidence?: number;
  probabilities?: Record<string, number> | number[];
};
type JudgeAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;
export type JudgeAnswers = Record<string, JudgeAnswer>;
export interface JudgeFallback {
  request: InferenceRequest;
  parse(output: string): JudgeAnswers | null;
}
export interface JudgeRequest {
  caller: string;
  state: JudgeState;
  questions: JudgeQuestions;
  sessionId?: string;
  fallback?: JudgeFallback;
}
export type JudgeRoute = "system-one" | "fallback";
export type JudgeMode = "off" | "shadow" | "live";
export interface JudgeResult {
  success: boolean;
  route: JudgeRoute;
  answers?: JudgeAnswers;
  fallbackOutput?: string;
}
export type SystemOneFailure =
  | "no-provider"
  | "unknown-provider"
  | "no-key"
  | "http"
  | "timeout"
  | "rate-limited"
  | "bad-answer";
export interface SystemOneAsk {
  model: string;
  state: JudgeState;
  questions: JudgeQuestions;
  apiKey: string;
  http: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}
export interface JudgeAdapter {
  defaultModel: string;
  keyNames: string[];
  ask(input: SystemOneAsk): Promise<{ answers: JudgeAnswers; inputTokens?: number }>;
}

export class SystemOneError extends Error {
  readonly failure: SystemOneFailure;

  constructor(failure: SystemOneFailure, detail?: string) {
    super(detail ?? failure);
    this.failure = failure;
  }
}

export function answersProblem(
  questions: JudgeQuestions,
  answers: unknown
): string | null {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return "answers is not an object";
  }
  const map = answers as Record<string, unknown>;
  for (const [id, q] of Object.entries(questions)) {
    const a = map[id];
    if (typeof a !== "object" || a === null) return `${id}: missing`;
    const problem = problemOf(id, q, a);
    if (problem !== null) return problem;
  }
  return null;
}

function problemOf(id: string, q: JudgeQuestion, a: object): string | null {
  if (q.type === "choice") {
    const choice = (a as { choice?: unknown }).choice;
    const ok = typeof choice === "string" && Object.hasOwn(q.criteria, choice);
    return ok ? null : `${id}: choice not in criteria`;
  }
  if (q.type === "noul") {
    const noul = (a as { noul?: unknown }).noul;
    const ok =
      typeof noul === "boolean" ||
      (typeof noul === "number" && Number.isFinite(noul) && noul >= 0 && noul <= 1);
    return ok ? null : `${id}: noul is not a boolean or a number in [0, 1]`;
  }
  const score = (a as { score?: unknown }).score;
  const ok =
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= q.criteria.length - 1;
  return ok ? null : `${id}: score is not a level index`;
}

const criterion = z.union([
  z.string(),
  z.array(z.string()),
  z.record(z.string(), z.union([z.string(), z.array(z.string())])),
]);
const instructions = z.union([z.string(), z.record(z.string(), z.string())]);
const question = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    instructions,
    criteria: z.record(z.string(), criterion),
  }),
  z.object({
    type: z.literal("noul"),
    instructions,
    criteria: z
      .object({ true: criterion.optional(), false: criterion.optional() })
      .optional(),
  }),
  z.object({
    type: z.literal("score"),
    instructions,
    criteria: z.array(criterion).min(1),
  }),
]);

export const judgeRequestJson = z.strictObject({
  caller: z.string().min(1),
  state: z.union([z.string(), z.record(z.string(), z.unknown())]),
  questions: z.record(z.string(), question),
  sessionId: z.string().optional(),
});
