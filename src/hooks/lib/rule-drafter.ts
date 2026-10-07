/**
 * The rule drafter: after a confirmed correction, the small model decides
 * whether it repeats an earlier one and, if so, drafts a rule that would have
 * prevented them all.
 */

import type { CandidateInput } from "./adaptation-candidates";
import type { RuleTrigger } from "./adaptation-rules";
import { type RequestedTurn, type Turn, withRequests } from "./adaptation-turns";
import { firesOn } from "./rule-proof";

const MIN_CITED = 2;
const MIN_CITED_FOR_WIDENING = 1;
const EVIDENCE_MESSAGE_MAX = 200;

type Correction = RequestedTurn;

export interface KnownRule {
  id: string;
  when: string;
  trigger: RuleTrigger;
  steering: string;
  check?: string;
  status: string;
  widens?: string;
}

const DRAFTER_SYSTEM_PROMPT = `You turn an AI assistant's repeated mistakes into one rule that prevents them.

You get the corrections the user made recently, numbered and oldest first. Each has the end of the assistant's reply the user corrected, the user's correcting message, what the reply got wrong, and, when known, the user's request the reply answered. The newest one just happened. Then the known rules; an approved rule shows its trigger and whether that trigger fires on the newest correction.

First check the approved rules. If one would have prevented the newest correction but its trigger does not fire on it, widen that rule: set recurring to true, widens to its id, pattern to a case-insensitive JavaScript regular expression on the rule's side that matches the newest correction (it is added to the rule's trigger as an alternative, so do not repeat the existing trigger), cites to the corrections the widened rule would have prevented, including the newest, and reason. Leave when, steering and check empty.

If an approved rule would have prevented it and its trigger fires on it, the rule fired and was not followed; a new rule will not help. Set recurring to false.

Otherwise set widens to an empty string and decide whether the newest correction is the same kind of mistake as at least one earlier correction. Same kind means one instruction would have prevented both, not that they share a topic.

If it is not, or another known rule already covers it, set recurring to false, say why in reason in one sentence, leave the text fields empty and set cites to [].

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
    widens: { type: "string" },
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
    "widens",
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

export function correctionsToDraftFrom(turns: Turn[]): Correction[] {
  return withRequests(turns).filter((turn) => turn.confirmed === true);
}

export function canRepeat(corrections: Correction[]): boolean {
  return corrections.length >= MIN_CITED;
}

function missedApprovedRules(corrections: Correction[], known: KnownRule[]): KnownRule[] {
  const newest = corrections.at(-1);
  if (!newest) return [];
  return known.filter(
    (rule) => rule.status === "approved" && !firesOn(rule.trigger, newest)
  );
}

export function canWiden(corrections: Correction[], known: KnownRule[]): boolean {
  return missedApprovedRules(corrections, known).length > 0;
}

function correctionBlock(correction: Correction, n: number, newest: boolean): string {
  const request = correction.prompt ? `<request>${correction.prompt}</request>\n` : "";
  return `<correction n="${n}"${newest ? ' newest="true"' : ""}>\n${request}<reply_end>${correction.replyEnd}</reply_end>\n<user_message>${correction.message}</user_message>\n<what_was_wrong>${correction.issue}</what_was_wrong>\n</correction>`;
}

function knownRuleLine(rule: KnownRule, newest: Correction | undefined): string {
  if (rule.widens)
    return `- draft widening of rule ${rule.widens}: ${rule.trigger.pattern}`;
  if (rule.status !== "approved")
    return `- ${rule.status}: ${rule.when}. ${rule.steering}`;
  const fires = newest && firesOn(rule.trigger, newest) ? "yes" : "no";
  return `- approved rule ${rule.id}: ${rule.when}. ${rule.steering} Trigger on the ${rule.trigger.side}: ${rule.trigger.pattern}. Fires on the newest correction: ${fires}.`;
}

function knownRulesBlock(known: KnownRule[], newest: Correction | undefined): string {
  const lines = known.map((rule) => knownRuleLine(rule, newest));
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
    user: `${blocks.join("\n\n")}\n\n${knownRulesBlock(known, corrections[last])}`,
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
  widens?: string;
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

function validCites(cites: unknown, count: number, minCited: number): number[] | null {
  if (!Array.isArray(cites)) return null;
  const distinct = [...new Set(cites)];
  const inRange = distinct.every((n) => Number.isInteger(n) && n >= 0 && n < count);
  const citesNewest = distinct.includes(count - 1);
  return inRange && citesNewest && distinct.length >= minCited
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

function citedEvidence(cites: number[], corrections: Correction[]): string[] {
  return cites.map((n) => {
    const cited = corrections[n];
    return `${cited.issue}: ${cited.message.slice(0, EVIDENCE_MESSAGE_MAX)}`;
  });
}

function parseNewRule(
  draft: DraftOutput,
  corrections: Correction[]
): CandidateInput | null {
  const cites = validCites(draft.cites, corrections.length, MIN_CITED);
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
    evidence: citedEvidence(cites, corrections),
  };
}

function parseWidening(
  draft: DraftOutput,
  corrections: Correction[],
  known: KnownRule[]
): CandidateInput | null {
  const rule = missedApprovedRules(corrections, known).find((r) => r.id === draft.widens);
  const cites = validCites(draft.cites, corrections.length, MIN_CITED_FOR_WIDENING);
  if (!rule || !cites || !hasText(draft.pattern)) return null;
  const addition = bareExpression(draft.pattern);
  if (!isValidPattern(addition)) return null;
  const trigger = { ...rule.trigger, pattern: `${rule.trigger.pattern}|${addition}` };
  const newest = corrections.at(-1);
  if (!newest || !firesOn(trigger, newest)) return null;
  return {
    when: rule.when,
    trigger,
    steering: rule.steering,
    check: rule.check ?? "",
    evidence: citedEvidence(cites, corrections),
    widens: rule.id,
  };
}

export function parseDraft(
  output: string | null | undefined,
  corrections: Correction[],
  known: KnownRule[] = []
): CandidateInput | null {
  const draft = output ? parseOutput(output) : null;
  if (draft?.recurring !== true) return null;
  return draft.widens
    ? parseWidening(draft, corrections, known)
    : parseNewRule(draft, corrections);
}
