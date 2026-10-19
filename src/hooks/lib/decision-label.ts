/**
 * Whether a turn settled a decision. Code can see that a turn committed or
 * opened a PR, but a decision is only words, so the progress-tree gate asks the
 * small model and sends the turn back when nothing was recorded.
 */

export interface DecisionLabel {
  decision: boolean;
  what: string;
}

const DECISION_SYSTEM = `You read one turn of a working session between a user and an AI assistant: the user's message and the end of the assistant's reply. Say whether the turn settled a decision.

A decision is a choice between alternatives about the work that holds beyond this turn: a policy, a design, a direction, a scope (what is in, out, parked or dropped), or a standing way of working. Examples: "make them opt in for now", "we only track new posts, not past ones", "we don't need the predictor", "PRs go to canary from now on".

A decision is often a few words that answer something open earlier: picking one of the options the assistant offered, keeping something where it is, saying something is not needed or should wait, changing how a thing behaves. Read the reply to see what the user's words settled; a short message can still be a decision.

These are not decisions:
- a go-ahead or approval of a plan or of the assistant's proposals as they stand ("go", "yes pls", "build all of them", "ok to both, build it"), unless it also picks between alternatives or changes the plan;
- where the work goes (which branch or PR) and other bookkeeping the assistant handles;
- a plain request for work ("fix CI", "push and open a PR", "plan it", "list our tasks"), including which step comes first;
- a question, even one about what to decide or what was decided before;
- a fact, a status report, or an idea floated for discussion;
- a recommendation or proposal from the assistant that the user has not accepted;
- small implementation choices the assistant makes while working.

Most turns settle no decision. When unsure, answer false.

Set what to the decision in under fifteen words, or to an empty string when there is none.`;

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "boolean" },
    what: { type: "string" },
  },
  required: ["decision", "what"],
  additionalProperties: false,
} as const;

const MESSAGE_MAX = 1500;
const REPLY_END_MAX = 1500;

export function decisionUser(message: string, reply: string) {
  return `The user's message:\n<message>\n${message.slice(0, MESSAGE_MAX)}\n</message>\n\nThe end of the assistant's reply:\n<reply_end>\n${reply.slice(-REPLY_END_MAX)}\n</reply_end>`;
}

export function decisionRequest(message: string, reply: string, sessionId?: string) {
  return {
    system: DECISION_SYSTEM,
    user: decisionUser(message, reply),
    maxTokens: 100,
    timeout: 60_000,
    jsonSchema: DECISION_SCHEMA,
    caller: "decision-label",
    sessionId,
  };
}

export function parseDecision(output: string | null | undefined): DecisionLabel | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (typeof parsed.decision !== "boolean") return null;
    const what = typeof parsed.what === "string" ? parsed.what.trim() : "";
    return { decision: parsed.decision, what: parsed.decision ? what : "" };
  } catch {
    return null;
  }
}
