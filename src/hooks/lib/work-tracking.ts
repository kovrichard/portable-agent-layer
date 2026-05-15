/**
 * Structured work tracking: session history + per-project history.
 * Used by both Claude Code (StopOrchestrator) and opencode (plugin).
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";

// ── Session Records ──────────────────────────────────────────────

export interface SessionRecord {
  sessionId: string;
  name: string;
  ts: string;
  cwd: string;
  status: "completed" | "in-progress";
  summary: string;
  artifacts: string[];
  handoff: string;
  messageCount: number;
  projectId?: string;
}

const MAX_SESSIONS = 50;
const MAX_ARTIFACTS = 20;

function sessionsPath(): string {
  return resolve(ensureDir(paths.state()), "sessions.json");
}

function readSessions(): SessionRecord[] {
  const p = sessionsPath();
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function writeSession(record: SessionRecord): void {
  const sessions = readSessions();
  // Replace existing record with same sessionId, or append
  const idx = sessions.findIndex((s) => s.sessionId === record.sessionId);
  if (idx >= 0) {
    sessions[idx] = record;
  } else {
    sessions.push(record);
  }
  // Prune to last N
  const pruned = sessions.slice(-MAX_SESSIONS);
  writeFileSync(sessionsPath(), JSON.stringify(pruned, null, 2), "utf-8");
}

/** Detect session completion status from last assistant message */
export function detectStatus(lastAssistant: string): SessionRecord["status"] {
  const completionSignals =
    /\b(done|all set|let me know|ready to|complete|finished|that's it|looks good|should be good|merged|shipped|deployed)\b/i;
  return completionSignals.test(lastAssistant) ? "completed" : "in-progress";
}

/** Extract file paths mentioned in assistant messages */
export function extractArtifacts(
  messages: { role: string; content: string | unknown }[]
): string[] {
  const seen = new Set<string>();
  const artifacts: string[] = [];

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const text = typeof msg.content === "string" ? msg.content : "";
    // Match file paths: /absolute/paths and relative/paths with extensions
    const pathMatches = text.match(/(?:\/[\w./-]+\.\w+|[\w./-]+\/[\w.-]+\.\w+)/g);
    if (!pathMatches) continue;
    for (const p of pathMatches) {
      // Skip URLs, common noise
      if (p.includes("://") || p.includes("node_modules")) continue;
      if (!seen.has(p)) {
        seen.add(p);
        artifacts.push(p);
      }
      if (artifacts.length >= MAX_ARTIFACTS) return artifacts;
    }
  }

  return artifacts;
}

/** Strip code blocks, paths, and technical noise from text */
function cleanForHandoff(text: string): string {
  return (
    text
      // Remove fenced code blocks
      .replace(/```[\s\S]*?```/g, "")
      // Remove inline code
      .replace(/`[^`]+`/g, "")
      // Remove file paths
      .replace(/(?:\/[\w./-]+\.\w+)/g, "")
      // Remove markdown formatting
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/^#+\s*/gm, "")
      // Remove tool call artifacts
      .replace(/^\s*[-*]\s*`[^`]+`.*$/gm, "")
      // Collapse whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Extract handoff notes from last assistant message */
export function extractHandoff(lastAssistant: string): string {
  // Look for explicit next-steps / TODO / remaining sections
  const sectionMatch = new RegExp(
    /(?:next steps?|todo|remaining|what's left|still need|want me to)[:\s]*\n([\s\S]{10,300}?)(?:\n\n|\n(?=[A-Z#]))/i
  ).exec(lastAssistant);
  if (sectionMatch) return cleanForHandoff(sectionMatch[1]);

  // Look for closing question/offer (common assistant pattern)
  const closingMatch = new RegExp(
    /(?:want (?:me to|to)|shall I|should I|ready to|anything else|let me know)[^\n]*$/im
  ).exec(lastAssistant);

  const cleaned = cleanForHandoff(lastAssistant);

  // Use last meaningful paragraph
  const paragraphs = cleaned
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 15 && p.length <= 300);

  if (closingMatch) return closingMatch[0].trim();
  const last = paragraphs.at(-1);
  if (last !== undefined) return last;
  if (cleaned.length > 200) return cleaned.slice(-200).trim();
  return cleaned;
}

// ── Per-Project History ──────────────────────────────────────────

interface ProjectHistoryEntry {
  date: string;
  title: string;
  summary: string;
  insights: string;
}

/** Convert a cwd path to a filesystem-safe slug (last directory segment) */
function cwdToSlug(cwd: string): string {
  const normalized = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || "unknown";
}

/** Append a learning entry to the project's history.jsonl */
export function appendProjectHistory(cwd: string, entry: ProjectHistoryEntry): void {
  const slug = cwdToSlug(cwd);
  const dir = ensureDir(resolve(paths.projectHistory(), slug));
  const historyPath = resolve(dir, "history.jsonl");
  const line = `${JSON.stringify(entry)}\n`;
  appendFileSync(historyPath, line, "utf-8");
}

/** Read the project history for a given cwd */
export function readProjectHistory(cwd: string, limit = 15): ProjectHistoryEntry[] {
  const slug = cwdToSlug(cwd);
  const historyPath = resolve(paths.projectHistory(), slug, "history.jsonl");
  if (!existsSync(historyPath)) return [];
  try {
    const lines = readFileSync(historyPath, "utf-8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line) as ProjectHistoryEntry);
  } catch {
    return [];
  }
}
