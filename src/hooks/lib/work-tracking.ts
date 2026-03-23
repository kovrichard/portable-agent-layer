/**
 * Structured work tracking: session history + persistent projects.
 * Used by both Claude Code (StopOrchestrator) and opencode (plugin).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";
import { now } from "./time";

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

export function readSessions(): SessionRecord[] {
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

/** Filter sessions within the last N hours */
export function recentSessions(hours: number): SessionRecord[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return readSessions().filter((s) => new Date(s.ts).getTime() > cutoff);
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
    const pathMatches = text.match(/(?:\/[\w./-]+\.[\w]+|[\w./-]+\/[\w.-]+\.[\w]+)/g);
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
      .replace(/(?:\/[\w./-]+\.[\w]+)/g, "")
      // Remove markdown formatting
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/^[#]+\s*/gm, "")
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
  const sectionMatch = lastAssistant.match(
    /(?:next steps?|todo|remaining|what's left|still need|want me to)[:\s]*\n([\s\S]{10,300}?)(?:\n\n|\n(?=[A-Z#]))/i
  );
  if (sectionMatch) return cleanForHandoff(sectionMatch[1]);

  // Look for closing question/offer (common assistant pattern)
  const closingMatch = lastAssistant.match(
    /(?:want (?:me to|to)|shall I|should I|ready to|anything else|let me know)[^\n]*$/im
  );

  const cleaned = cleanForHandoff(lastAssistant);

  // Use last meaningful paragraph
  const paragraphs = cleaned
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 15 && p.length <= 300);

  if (closingMatch) return closingMatch[0].trim();
  if (paragraphs.length > 0) return paragraphs[paragraphs.length - 1];
  if (cleaned.length > 200) return cleaned.slice(-200).trim();
  return cleaned;
}

// ── Persistent Projects ──────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  created: string;
  updated: string;
  status: "active" | "paused" | "completed";
  objectives: string[];
  decisions: string[];
  completed: string[];
  blockers: string[];
  nextSteps: string[];
  handoff: string;
  sessions: string[];
}

function projectsPath(): string {
  return resolve(ensureDir(paths.state()), "projects.json");
}

export function readProjects(): Record<string, Project> {
  const p = projectsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

export function writeProject(project: Project): void {
  const projects = readProjects();
  project.updated = now();
  projects[project.id] = project;
  writeFileSync(projectsPath(), JSON.stringify(projects, null, 2), "utf-8");
}

export function activeProjects(): Project[] {
  return Object.values(readProjects()).filter((p) => p.status === "active");
}

export function staleProjects(days = 7): Project[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return Object.values(readProjects()).filter(
    (p) => p.status === "active" && new Date(p.updated).getTime() < cutoff
  );
}
