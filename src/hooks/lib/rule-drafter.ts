/**
 * The rule drafter: after a confirmed correction, the small model decides
 * whether it repeats an earlier one and, if so, drafts a rule that would have
 * prevented them all.
 */

import type { CandidateInput } from "./adaptation-candidates";
import type { Turn } from "./adaptation-turns";

const MIN_CITED = 2;
const EVIDENCE_MESSAGE_MAX = 200;

export interface Correction extends Turn {
  /** The user's request the corrected reply answered, when it was logged. */
  prompt: string;
}

export interface KnownRule {
  when: string;
  steering: string;
  status: string;
}

const DRAFTER_SYSTEM_PROMPT = `You turn an AI assistant's repeated mistakes into one rule that prevents them.

You get the corrections the user made recently, numbered and oldest first. Each has the end of the assistant's reply the user corrected, the user's correcting message, what the reply got wrong, and, when known, the user's request the reply answered. The newest one just happened.

Decide whether the newest correction is the same kind of mistake as at least one earlier correction. Same kind means one instruction would have prevented both, not that they share a topic.

If it is not, or a known rule already covers it, set recurring to false, say why in reason in one sentence, leave the text fields empty and set cites to [].

If it is, draft one rule:
- when: the situation, in one sentence.
- side and pattern: a case-insensitive JavaScript regular expression for that situation. Side "reply" matches the end of the assistant's reply; side "prompt" matches the user's request. It must match the cited corrections, stay general enough to catch the next one, and not match ordinary turns.
- steering: the instruction to the assistant, imperative, at most two sentences.
- check: how to tell from a reply whether the instruction was followed, in one sentence.
- cites: the numbers of the corrections this rule would have prevented, including the newest.
- reason: why these corrections are the same mistake, in one sentence.`;

const DRAFTER_SCHEMA = {
  type: "object",
  properties: {
    recurring: { type: "boolean" },
    reason: { type: "string" },
    when: { type: "string" },
    side: { enum: ["prompt", "reply"] },
    pattern: { type: "string" },
    steering: { type: "string" },
    check: { type: "string" },
    cites: { type: "array", items: { type: "integer" } },
  },
  required: [
    "recurring",
    "reason",
    "when",
    "side",
    "pattern",
    "steering",
    "check",
    "cites",
  ],
  additionalProperties: false,
} as const;

function precedingRequest(turns: Turn[], index: number): string {
  const session = turns[index].session;
  for (let i = index - 1; i >= 0; i--) {
    if (turns[i].session === session) return turns[i].message;
  }
  return "";
}

export function correctionsToDraftFrom(turns: Turn[]): Correction[] {
  return turns.flatMap((turn, index) =>
    turn.confirmed === true ? [{ ...turn, prompt: precedingRequest(turns, index) }] : []
  );
}

export function canRepeat(corrections: Correction[]): boolean {
  return corrections.length >= MIN_CITED;
}

function correctionBlock(correction: Correction, n: number, newest: boolean): string {
  const request = correction.prompt ? `<request>${correction.prompt}</request>\n` : "";
  return `<correction n="${n}"${newest ? ' newest="true"' : ""}>\n${request}<reply_end>${correction.replyEnd}</reply_end>\n<user_message>${correction.message}</user_message>\n<what_was_wrong>${correction.issue}</what_was_wrong>\n</correction>`;
}

function knownRulesBlock(known: KnownRule[]): string {
  const lines = known.map((rule) => `- ${rule.status}: ${rule.when}. ${rule.steering}`);
  return `Known rules:\n${lines.length ? lines.join("\n") : "none"}`;
}

export function drafterRequest(
  corrections: Correction[],
  known: KnownRule[],
  sessionId?: string
) {
  const last = corrections.length - 1;
  const blocks = corrections.map((c, n) => correctionBlock(c, n, n === last));
  return {
    system: DRAFTER_SYSTEM_PROMPT,
    user: `${blocks.join("\n\n")}\n\n${knownRulesBlock(known)}`,
    tier: "small" as const,
    maxTokens: 600,
    timeout: 90_000,
    jsonSchema: DRAFTER_SCHEMA,
    caller: "rule-drafter",
    sessionId,
  };
}

interface DraftOutput {
  recurring: boolean;
  when: string;
  side: "prompt" | "reply";
  pattern: string;
  steering: string;
  check: string;
  cites: number[];
}

const REGEX_LITERAL = /^\/(.+)\/[a-z]*$/s;

function bareExpression(pattern: string): string {
  return REGEX_LITERAL.exec(pattern)?.[1] ?? pattern;
}

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return pattern.trim() !== "";
  } catch {
    return false;
  }
}

function validCites(cites: unknown, count: number): number[] | null {
  if (!Array.isArray(cites)) return null;
  const distinct = [...new Set(cites)];
  const inRange = distinct.every((n) => Number.isInteger(n) && n >= 0 && n < count);
  const citesNewest = distinct.includes(count - 1);
  return inRange && citesNewest && distinct.length >= MIN_CITED
    ? (distinct as number[]).sort((a, b) => a - b)
    : null;
}

function parseOutput(output: string): DraftOutput | null {
  try {
    return JSON.parse(output) as DraftOutput;
  } catch {
    return null;
  }
}

function hasText(...fields: unknown[]): boolean {
  return fields.every((field) => typeof field === "string" && field.trim() !== "");
}

export function parseDraft(
  output: string | null | undefined,
  corrections: Correction[]
): CandidateInput | null {
  const draft = output ? parseOutput(output) : null;
  if (draft?.recurring !== true) return null;
  const cites = validCites(draft.cites, corrections.length);
  const sideOk = draft.side === "prompt" || draft.side === "reply";
  if (!cites || !sideOk || !hasText(draft.pattern)) return null;
  const pattern = bareExpression(draft.pattern);
  if (!isValidPattern(pattern)) return null;
  if (!hasText(draft.when, draft.steering, draft.check)) return null;
  return {
    when: draft.when.trim(),
    trigger: { side: draft.side, pattern },
    steering: draft.steering.trim(),
    check: draft.check.trim(),
    evidence: cites.map((n) => {
      const cited = corrections[n];
      return `${cited.issue}: ${cited.message.slice(0, EVIDENCE_MESSAGE_MAX)}`;
    }),
  };
}
