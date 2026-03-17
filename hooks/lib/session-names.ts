/**
 * Session naming utilities — 4-word headline per session, stored in session-names.json.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { paths } from "./paths";

export interface SessionNames {
  [sessionId: string]: string;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "is", "it", "this", "that", "i", "you", "we", "can",
  "do", "not", "be", "from", "by", "as", "are", "was", "were", "my",
  "me", "just", "so", "if", "how", "what", "when", "its",
]);

/** Deterministic fallback: extract up to 4 keywords from a prompt */
export function extractFallbackName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return words.slice(0, 4).join(" ") || "untitled session";
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
