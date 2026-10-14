/**
 * The kind of mistake a confirmed correction points at. Rates of each kind
 * before and after an opinion is approved measure whether the opinion works, so
 * the set is closed; a correction that fits none lands in `other` with the
 * model's own name for it, which a later check can promote to a kind.
 */

const NAMED_KINDS = {
  "missed-the-question":
    "the reply did not answer what the user asked, or buried the answer",
  "unverified-claim":
    "the reply stated a fact or the state of something (tests pass, CI is green, a tool is missing, a fix is merged) that was wrong or never checked",
  "off-instruction":
    "the reply went against an instruction the user gave before it: it reordered their steps, worked on a different target than the one they named, changed the scope, or put the work somewhere else, such as a separate PR",
  "revisited-decision":
    "the reply proposed or kept something the user had already ruled out or decided against earlier",
  "stopped-short":
    "the reply deferred, paused or handed back work the user wanted done now, or waited for something (a merge, a review, an answer) instead of starting",
  "wrong-format":
    "the reply ignored the shape or length the user asked for, such as a table, a list or one line, or padded the answer",
  "no-verdict":
    "the user wanted a judgement and the reply gave none: it agreed without reasoning, listed options without picking one, or criticised without an alternative",
  "dismissed-user-view":
    "the reply argued past or brushed aside the user's own view or hypothesis",
  "undefined-reference":
    "the reply used a term, name, number or id the user did not know or had not been told; the user says they don't know it, or asks what it is or to list it",
  "skipped-existing":
    "the reply designed or built something without checking what already exists: code, a mechanism, a tool, a convention or prior art",
  "status-quo-bias":
    "the reply treated the current setup as a fixed constraint instead of considering a better design",
} as const;

type NamedKind = keyof typeof NAMED_KINDS;
export type CorrectionKindName = NamedKind | "other";

export const CORRECTION_KINDS = [
  ...(Object.keys(NAMED_KINDS) as NamedKind[]),
  "other",
] as const satisfies readonly CorrectionKindName[];

export interface CorrectionKind {
  kind: CorrectionKindName;
  suggested: string;
  description: string;
}

const KIND_LINES = Object.entries(NAMED_KINDS)
  .map(([kind, meaning]) => `- ${kind}: ${meaning}.`)
  .join("\n");

export const CORRECTION_KIND_SYSTEM = `The user corrected an AI assistant's reply. Name the kind of mistake the reply made.

Pick the one kind that best explains why the user had to correct the reply:
${KIND_LINES}
- other: none of the kinds above fits.

Judge the mistake, not the topic: a wrong claim about CI is unverified-claim, and a question about CI the reply never answered is missed-the-question.

The user's correction is often a question itself. That alone does not make it missed-the-question: missed-the-question means the reply failed to answer something the user had asked before the reply. When the correction asks a new question, find the mistake that made the user ask it.

When kinds overlap, prefer the most specific one:
- the user does not know something the reply referred to: undefined-reference, even when they ask about it;
- the user says they meant a different thing than the reply worked on: off-instruction;
- the user reminds the reply of something agreed or ruled out earlier ("didn't we say", "we discussed"): revisited-decision;
- the reply put off work the user wanted now: stopped-short, even when it also changed the order.

Pick a kind only when its description fits the mistake itself. When a kind fits only loosely, answer other.

For other, set suggested to a short lowercase kebab-case name for the mistake, and description to one sentence saying what the reply did wrong. For any other kind, set both to an empty string.`;

const CORRECTION_KIND_SCHEMA = {
  type: "object",
  properties: {
    kind: { enum: [...CORRECTION_KINDS] },
    suggested: { type: "string" },
    description: { type: "string" },
  },
  required: ["kind", "suggested", "description"],
  additionalProperties: false,
} as const;

export function correctionKindSchema() {
  return CORRECTION_KIND_SCHEMA;
}

const MESSAGE_MAX = 800;

export function correctionKindUser(replyEnd: string, message: string, issue: string) {
  return `The end of the assistant's reply:\n<reply_end>\n${replyEnd}\n</reply_end>\n\nThe user's correction:\n<message>\n${message.slice(0, MESSAGE_MAX)}\n</message>\n\nWhat the reply got wrong, in a first reader's words:\n<issue>\n${issue}\n</issue>`;
}

export function correctionKindRequest(
  replyEnd: string,
  message: string,
  issue: string,
  sessionId?: string
) {
  return {
    system: CORRECTION_KIND_SYSTEM,
    user: correctionKindUser(replyEnd, message, issue),
    maxTokens: 200,
    timeout: 90_000,
    jsonSchema: CORRECTION_KIND_SCHEMA,
    caller: "correction-kind",
    sessionId,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isCorrectionKind(value: unknown): value is CorrectionKindName {
  return CORRECTION_KINDS.includes(value as CorrectionKindName);
}

function unlistedKind(kind: unknown, description: string): CorrectionKind | null {
  const suggested = text(kind);
  return suggested ? { kind: "other", suggested, description } : null;
}

export function parseCorrectionKind(
  output: string | null | undefined
): CorrectionKind | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const description = text(parsed.description);
    if (!isCorrectionKind(parsed.kind)) return unlistedKind(parsed.kind, description);
    if (parsed.kind !== "other")
      return { kind: parsed.kind, suggested: "", description: "" };
    return { kind: "other", suggested: text(parsed.suggested), description };
  } catch {
    return null;
  }
}
