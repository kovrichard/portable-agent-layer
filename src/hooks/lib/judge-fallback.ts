/**
 * The small-tier fallback of a judgment: the caller's own evaluated request, or the questions rendered into a prompt with a JSON schema.
 */

import { parseJsonFromOutput } from "./inference";
import {
  answersProblem,
  type JudgeAnswers,
  type JudgeFallback,
  type JudgeQuestion,
  type JudgeQuestions,
  type JudgeRequest,
  type JudgeState,
} from "./judgment";

const RENDERED_TIMEOUT_MS = 90_000;
const TOKENS_PER_QUESTION = 100;
const MIN_RENDERED_TOKENS = 200;

export function fallbackFor(request: JudgeRequest): JudgeFallback {
  if (request.fallback) return request.fallback;

  return {
    request: {
      system: renderedSystem(request.questions),
      user: stateText(request.state),
      tier: "small",
      maxTokens: renderedMaxTokens(request.questions),
      timeout: RENDERED_TIMEOUT_MS,
      jsonSchema: answerSchema(request.questions),
      caller: request.caller,
      sessionId: request.sessionId,
    },
    parse: (output) => answersFromReply(request.questions, output),
  };
}

function renderedMaxTokens(questions: JudgeQuestions): number {
  return Math.max(
    MIN_RENDERED_TOKENS,
    TOKENS_PER_QUESTION * Object.keys(questions).length
  );
}

function stateText(state: JudgeState): string {
  return typeof state === "string" ? state : JSON.stringify(state, null, 2);
}

function answerSchema(questions: JudgeQuestions): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "choice") properties[id] = { enum: Object.keys(q.criteria) };
    else if (q.type === "noul") properties[id] = { type: "boolean" };
    else properties[id] = { type: "integer", minimum: 0, maximum: q.criteria.length - 1 };
  }

  return {
    type: "object",
    properties,
    required: Object.keys(questions),
    additionalProperties: false,
  };
}

function renderedSystem(questions: JudgeQuestions): string {
  const blocks = Object.entries(questions).map(([id, q]) => questionBlock(id, q));

  return [
    "Answer each question about the state in the user message. Reply with one JSON object keyed by question id.",
    blocks.join("\n\n"),
  ].join("\n\n");
}

function questionBlock(id: string, q: JudgeQuestion): string {
  const head = `${id} (${q.type}): ${instructionText(q.instructions)}`;

  if (q.type === "choice") {
    const options = Object.entries(q.criteria).map(
      ([k, c]) => `- ${k}: ${criterionText(c)}`
    );

    return [head, "Pick one of:", ...options].join("\n");
  }

  if (q.type === "noul") {
    const lines: string[] = [];

    if (q.criteria?.true !== undefined)
      lines.push(`- true: ${criterionText(q.criteria.true)}`);

    if (q.criteria?.false !== undefined)
      lines.push(`- false: ${criterionText(q.criteria.false)}`);

    return [head, "Answer true or false.", ...lines].join("\n");
  }
  const levels = q.criteria.map((c, i) => `- ${i}: ${criterionText(c)}`);

  return [head, "Answer the number of the level:", ...levels].join("\n");
}

function instructionText(i: JudgeQuestion["instructions"]): string {
  if (typeof i === "string") return i;

  return Object.entries(i)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function criterionText(c: unknown): string {
  if (typeof c === "string") return c;

  if (Array.isArray(c)) return c.join("; ");

  return Object.entries(c as Record<string, string | string[]>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`)
    .join("; ");
}

function answersFromReply(
  questions: JudgeQuestions,
  output: string
): JudgeAnswers | null {
  const parsed = parseJsonFromOutput(output);
  if (typeof parsed !== "object" || parsed === null) return null;
  const map = parsed as Record<string, unknown>;
  const built: JudgeAnswers = {};

  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "choice") built[id] = { choice: map[id] as string };
    else if (q.type === "noul") built[id] = { noul: map[id] as boolean };
    else built[id] = { score: map[id] as number };
  }

  return answersProblem(questions, built) === null ? built : null;
}
