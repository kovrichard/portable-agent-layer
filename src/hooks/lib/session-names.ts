/**
 * Session naming utilities — 4-word headline per session, stored in session-names.json.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

interface SessionNames {
  [sessionId: string]: string;
}

// Noise words that produce garbage session names — extended from original PAI
const NOISE_WORDS = new Set([
  // Articles, pronouns, prepositions
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "from",
  "by",
  "as",
  "is",
  "it",
  "its",
  "this",
  "that",
  "i",
  "you",
  "we",
  "my",
  "me",
  "your",
  "our",
  "they",
  "them",
  "those",
  "these",
  // Common verbs (too generic for names)
  "can",
  "do",
  "not",
  "be",
  "are",
  "was",
  "were",
  "just",
  "so",
  "if",
  "how",
  "what",
  "when",
  "where",
  "which",
  "who",
  "have",
  "has",
  "had",
  "will",
  "would",
  "could",
  "should",
  "been",
  "being",
  "having",
  "getting",
  "making",
  // Filler words
  "there",
  "here",
  "some",
  "all",
  "any",
  "each",
  "every",
  "both",
  "more",
  "most",
  "less",
  "much",
  "many",
  "few",
  "really",
  "actually",
  "basically",
  "pretty",
  "very",
  "quite",
  "super",
  "totally",
  "completely",
  "okay",
  "yeah",
  "yes",
  "sure",
  "fine",
  "good",
  "bad",
  "great",
  "nice",
  "hey",
  "well",
  "now",
  "then",
  "still",
  "even",
  "already",
  "yet",
  "ago",
  // Generic task words (too vague)
  "thing",
  "things",
  "something",
  "nothing",
  "anything",
  "everything",
  "stuff",
  "way",
  "kind",
  "sort",
  "type",
  "part",
  "whole",
  "point",
  // Common non-topic words
  "need",
  "want",
  "please",
  "help",
  "work",
  "working",
  "doing",
  "going",
  "like",
  "know",
  "think",
  "right",
  "look",
  "see",
  "try",
  "let",
  "get",
  "set",
  "put",
  "use",
  "run",
  "make",
  "tell",
  "show",
  "give",
  "keep",
  "start",
  "stop",
  "move",
  "turn",
  "pull",
  "push",
  "open",
  "close",
  "guess",
  "maybe",
  "probably",
  "mean",
  "means",
  "called",
  "used",
  "using",
  // Tool/system artifacts
  "output",
  "file",
  "result",
  "tool",
  "input",
  "content",
  "contents",
  "invoke",
]);

/** Strip system-injected artifacts from prompt before naming */
function sanitizePrompt(prompt: string): string {
  return prompt
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " ")
    .replace(/\b[0-9a-f]{7,}\b/gi, " ")
    .replace(/(?:\/[\w.-]+){2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic fallback: extract up to 4 meaningful keywords, Title Case */
export function extractFallbackName(prompt: string): string {
  const sanitized = sanitizePrompt(prompt);
  const words = sanitized
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !NOISE_WORDS.has(w.toLowerCase()));

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(w);
    }
    if (unique.length >= 4) break;
  }

  if (unique.length === 0) return "untitled session";

  return unique
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function namesFilePath(): string {
  return resolve(paths.state(), "session-names.json");
}

export function readSessionNames(): SessionNames {
  const filepath = namesFilePath();
  if (!existsSync(filepath)) return {};
  try {
    return JSON.parse(readFileSync(filepath, "utf-8")) as SessionNames;
  } catch {
    return {};
  }
}

export function writeSessionName(sessionId: string, name: string): void {
  const names = readSessionNames();
  names[sessionId] = name;
  writeFileSync(namesFilePath(), JSON.stringify(names, null, 2), "utf-8");
}
