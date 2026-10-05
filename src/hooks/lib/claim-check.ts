/**
 * Whether a reply claims a result (tests pass, CI green, it works now) or a status
 * (not pushed, merged, live) that no command in the same turn could have shown.
 * Precision over recall: a hedged sentence or a question is never a claim, and an
 * unreadable turn is never unbacked.
 */

import { isSystemText } from "./prompt-text";
import { isCodexInjectedContext } from "./transcript";

const CLAIM_RE =
  /\b(?:tests?|suite|ci|checks?|builds?|gates?|pipeline)\b.*\b(?:pass(?:es|ed)?|green|succeed(?:s|ed)?)\b|\bverified\b|\b(?:works|working) now\b|\bnow works\b/i;
const HEDGED_RE =
  /\b(?:not|no longer|fail(?:s|ed|ing)?|until|when|if|unless|should|would|will|might|could|may)\b|n't\b/i;

const stateClaim = (states: string) =>
  new RegExp(
    String.raw`(?:\b(?:is|are|was|were|been|not|yet|still|already|now)|n't|n’t|'s|’s)\s+(?:${states})\b|\bun(?:${states})\b`,
    "i"
  );
const VERSION_CONTROL_CLAIM_RE = stateClaim("committed|pushed|merged|released|tagged");
const DEPLOY_CLAIM_RE = stateClaim("deployed|live|installed|shipped");
const STATUS_HEDGED_RE =
  /\b(?:once|until|when|if|unless|should|would|will|might|could|may)\b/i;
const READS_VERSION_CONTROL_RE = /\b(?:git|gh)\b/;

const COMMAND_TOOLS = new Set([
  "Bash",
  "BashOutput",
  "Monitor",
  "PowerShell",
  "exec",
  "shell",
  "exec_command",
]);

export type ClaimVerdict = "none" | "backed" | "unbacked" | "unknown";

export interface ClaimCheck {
  verdict: ClaimVerdict;
  claims: string[];
}

function statements(reply: string): string[] {
  return reply
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.endsWith("?"))
    .map((s) => s.replace(/[.!]+$/, ""));
}

/** A quoted claim is being talked about, not made. */
function withoutQuotes(sentence: string): string {
  return sentence.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, "");
}

export function resultClaims(reply: string): string[] {
  return statements(reply).filter((s) => {
    const own = withoutQuotes(s);
    return CLAIM_RE.test(own) && !HEDGED_RE.test(own);
  });
}

/** A checklist item states a goal and a line ending in a colon introduces one. */
function isGoalOrHeading(sentence: string): boolean {
  return /^[-*]\s*\[[ xX]\]/.test(sentence) || /:\**$/.test(sentence);
}

function isStatusClaim(sentence: string): boolean {
  const own = withoutQuotes(sentence);
  if (isGoalOrHeading(own)) return false;
  return (
    (VERSION_CONTROL_CLAIM_RE.test(own) || DEPLOY_CLAIM_RE.test(own)) &&
    !STATUS_HEDGED_RE.test(own)
  );
}

export function statusClaims(reply: string): string[] {
  return statements(reply).filter(isStatusClaim);
}

/** What is committed, pushed, merged or released only git can say. */
export function isVersionControlClaim(claim: string): boolean {
  return VERSION_CONTROL_CLAIM_RE.test(withoutQuotes(claim));
}

interface TranscriptLine {
  type?: string;
  message?: { content?: unknown };
  payload?: {
    type?: string;
    role?: string;
    name?: string;
    content?: unknown;
    input?: unknown;
    arguments?: unknown;
    action?: unknown;
  };
}

function parsed(line: string): TranscriptLine | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function blocks(
  content: unknown
): { type?: string; name?: string; text?: string; input?: unknown }[] {
  return Array.isArray(content) ? content : [];
}

function promptText(entry: TranscriptLine): string | null {
  if (entry.type === "user") {
    const content = entry.message?.content;
    if (typeof content === "string") return content;
    const texts = blocks(content).filter((b) => b.type === "text");
    return texts.length ? texts.map((b) => b.text ?? "").join(" ") : null;
  }
  if (entry.type === "response_item" && entry.payload?.role === "user") {
    return blocks(entry.payload.content)
      .map((b) => b.text ?? "")
      .join(" ");
  }
  return null;
}

function isUserPrompt(entry: TranscriptLine): boolean {
  const text = promptText(entry);
  return text !== null && !isSystemText(text) && !isCodexInjectedContext(text);
}

const ran = (input: unknown) => JSON.stringify(input ?? {});

function commandsIn(entry: TranscriptLine): string[] {
  if (entry.type === "assistant")
    return blocks(entry.message?.content)
      .filter((b) => b.type === "tool_use" && COMMAND_TOOLS.has(b.name ?? ""))
      .map((b) => ran(b.input));
  const call = entry.payload;
  if (entry.type !== "response_item" || !call) return [];
  const input = call.input ?? call.arguments ?? call.action;
  if (call.type === "local_shell_call") return [ran(input)];
  const isCall = call.type === "function_call" || call.type === "custom_tool_call";
  return isCall && COMMAND_TOOLS.has(call.name ?? "") ? [ran(input)] : [];
}

function isTurnEntry(entry: TranscriptLine): boolean {
  return ["user", "assistant", "response_item"].includes(entry.type ?? "");
}

/** What each command this turn ran. Null when no line reads as a turn, so an
 *  unknown transcript format never counts as none. */
export function commandsThisTurn(lines: string[]): string[] | null {
  const entries = lines.map(parsed).filter((e): e is TranscriptLine => e !== null);
  if (!entries.some(isTurnEntry)) return null;
  let commands: string[] = [];
  for (const entry of entries) {
    if (isUserPrompt(entry)) commands = [];
    commands.push(...commandsIn(entry));
  }
  return commands;
}

function isBacked(claim: string, commands: string[]): boolean {
  if (!isVersionControlClaim(claim)) return commands.length > 0;
  return commands.some((command) => READS_VERSION_CONTROL_RE.test(command));
}

export function checkClaims(reply: string, commands: string[] | null): ClaimCheck {
  const claims = statements(reply).filter(
    (s) => resultClaims(s).length > 0 || isStatusClaim(s)
  );
  if (claims.length === 0) return { verdict: "none", claims };
  if (commands === null) return { verdict: "unknown", claims };
  const unbacked = claims.filter((claim) => !isBacked(claim, commands));
  return unbacked.length > 0
    ? { verdict: "unbacked", claims: unbacked }
    : { verdict: "backed", claims };
}
