/**
 * Whether a reply claims a result (tests pass, CI green, it works now) that no
 * command in the same turn could have shown. Precision over recall: a hedged or
 * negated sentence is never a claim, and an unreadable turn is never unbacked.
 */

import { isSystemText } from "./prompt-text";
import { isCodexInjectedContext } from "./transcript";

const CLAIM_RE =
  /\b(?:tests?|suite|ci|checks?|builds?|gates?|pipeline)\b.*\b(?:pass(?:es|ed)?|green|succeed(?:s|ed)?)\b|\bverified\b|\b(?:works|working) now\b|\bnow works\b/i;
const HEDGED_RE =
  /\b(?:not|no longer|fail(?:s|ed|ing)?|until|when|if|unless|should|would|will|might|could|may)\b|n't\b/i;

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

function sentences(reply: string): string[] {
  return reply
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean);
}

/** A quoted claim is being talked about, not made. */
function withoutQuotes(sentence: string): string {
  return sentence.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, "");
}

export function resultClaims(reply: string): string[] {
  return sentences(reply).filter((s) => {
    const own = withoutQuotes(s);
    return CLAIM_RE.test(own) && !HEDGED_RE.test(own);
  });
}

interface TranscriptLine {
  type?: string;
  message?: { content?: unknown };
  payload?: { type?: string; role?: string; name?: string; content?: unknown };
}

function parsed(line: string): TranscriptLine | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function blocks(content: unknown): { type?: string; name?: string; text?: string }[] {
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

function commandsIn(entry: TranscriptLine): number {
  if (entry.type === "assistant")
    return blocks(entry.message?.content).filter(
      (b) => b.type === "tool_use" && COMMAND_TOOLS.has(b.name ?? "")
    ).length;
  const call = entry.payload;
  if (entry.type !== "response_item" || !call) return 0;
  if (call.type === "local_shell_call") return 1;
  const isCall = call.type === "function_call" || call.type === "custom_tool_call";
  return isCall && COMMAND_TOOLS.has(call.name ?? "") ? 1 : 0;
}

function isTurnEntry(entry: TranscriptLine): boolean {
  return ["user", "assistant", "response_item"].includes(entry.type ?? "");
}

/** Null when no line reads as a turn, so an unknown transcript format never counts as zero. */
export function commandsThisTurn(lines: string[]): number | null {
  const entries = lines.map(parsed).filter((e): e is TranscriptLine => e !== null);
  if (!entries.some(isTurnEntry)) return null;
  let commands = 0;
  for (const entry of entries) {
    if (isUserPrompt(entry)) commands = 0;
    commands += commandsIn(entry);
  }
  return commands;
}

export function checkClaims(reply: string, commands: number | null): ClaimCheck {
  const claims = resultClaims(reply);
  if (claims.length === 0) return { verdict: "none", claims };
  if (commands === null) return { verdict: "unknown", claims };
  return { verdict: commands > 0 ? "backed" : "unbacked", claims };
}
