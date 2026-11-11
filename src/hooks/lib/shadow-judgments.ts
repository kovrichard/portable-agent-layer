/**
 * The session-status, entity-precheck and rule-recurring judgments as System One questions, each with its caller's current request as the fallback.
 */

import type { RequestedTurn } from "./adaptation-turns";
import { parseExtraction } from "./entity-extraction";
import type {
  JudgeAnswers,
  JudgeFallback,
  JudgeQuestion,
  JudgeRequest,
  JudgeState,
} from "./judgment";

type InferenceRequest = JudgeFallback["request"];

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

const NAMES_ENTITY_QUESTION: JudgeQuestion = {
  type: "noul",
  instructions: "Does `messages` name a person or a company?",
  criteria: {
    true: "at least one individual or one organisation is mentioned by name",
    false:
      "no person or company is named; names of tools, products, programming languages and places do not count",
  },
};

const RECURRING_QUESTION: JudgeQuestion = {
  type: "noul",
  instructions:
    "`newest` is a correction the user just made to an AI assistant's reply, and `earlier` are the user's earlier corrections. Is `newest` the same kind of mistake as at least one earlier correction?",
  criteria: {
    true: "one instruction to the assistant would have prevented both `newest` and an earlier correction",
    false:
      "`newest` only shares a topic with the earlier corrections, or `earlier` is empty",
  },
};

function jsonOf(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

function sessionStatusAnswers(output: string): JudgeAnswers | null {
  const parsed = jsonOf(output);
  if (typeof parsed !== "object" || parsed === null) return null;
  const status = (parsed as { status?: unknown }).status;
  if (status !== "in-progress" && status !== "completed") return null;
  return { status: { choice: status } };
}

function namesEntityAnswers(output: string): JudgeAnswers | null {
  if (jsonOf(output) === undefined) return null;
  return { names_entity: { noul: parseExtraction(output).length > 0 } };
}

function recurringAnswers(output: string): JudgeAnswers | null {
  const parsed = jsonOf(output);
  if (typeof parsed !== "object" || parsed === null) return null;
  const { widens, recurring } = parsed as { widens?: unknown; recurring?: unknown };
  if (typeof widens === "string" && widens.length > 0) return null;
  if (typeof recurring !== "boolean") return null;
  return { recurring: { noul: recurring } };
}

function correctionState(correction: RequestedTurn): Record<string, string> {
  return {
    ...(correction.prompt ? { request: correction.prompt } : {}),
    reply_end: correction.replyEnd,
    user_message: correction.message,
    what_was_wrong: correction.issue,
  };
}

function shadowJudgment(
  caller: string,
  state: JudgeState,
  questions: Record<string, JudgeQuestion>,
  request: InferenceRequest,
  parse: (output: string) => JudgeAnswers | null
): JudgeRequest {
  return {
    caller,
    state,
    questions,
    sessionId: request.sessionId,
    fallback: { request, parse },
  };
}

export function sessionStatusJudgment(
  userMessages: string,
  lastReply: string,
  request: InferenceRequest
): JudgeRequest {
  return shadowJudgment(
    "session-status",
    { user_messages: userMessages, last_reply: lastReply },
    { status: SESSION_STATUS_QUESTION },
    request,
    sessionStatusAnswers
  );
}

export function entityPrecheckJudgment(
  messages: string,
  request: InferenceRequest
): JudgeRequest {
  return shadowJudgment(
    "entity-precheck",
    { messages },
    { names_entity: NAMES_ENTITY_QUESTION },
    request,
    namesEntityAnswers
  );
}

export function ruleRecurringJudgment(
  corrections: RequestedTurn[],
  request: InferenceRequest
): JudgeRequest {
  const [newest] = corrections.slice(-1);
  return shadowJudgment(
    "rule-recurring",
    {
      newest: correctionState(newest),
      earlier: corrections.slice(0, -1).map(correctionState),
    },
    { recurring: RECURRING_QUESTION },
    request,
    recurringAnswers
  );
}
