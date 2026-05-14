/**
 * Stop handler: unified session intelligence capture.
 *
 * Produces: title, summary, insights via Haiku.
 * Writes: session learning file, project history.
 *
 * Relationship notes → written in ALGORITHM LEARN phase via relationship-note.ts
 * Handoff notes     → written in ALGORITHM LEARN phase via handoff-note.ts
 *
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stringify } from "../lib/frontmatter";
import { hasApiKey, inference } from "../lib/inference";
import { categorizeLearning } from "../lib/learning-category";
import { logDebug, logError } from "../lib/log";
import { ensureDir, paths } from "../lib/paths";
import { fileTimestamp, monthPath } from "../lib/time";
import { logTokenUsage } from "../lib/token-usage";
import {
  extractContent,
  extractLastAssistant,
  extractLastUser,
  parseMessages,
} from "../lib/transcript";
import { appendProjectHistory, detectStatus } from "../lib/work-tracking";

// ── Dedup tracking ──

interface CaptureEntry {
  filepath: string;
  messageCount: number;
}

const MIN_NEW_MESSAGES = 10;

function capturedPath(): string {
  return resolve(paths.state(), "captured-learnings.json");
}

function getPreviousCapture(sessionId: string): CaptureEntry | null {
  const p = capturedPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    if (Array.isArray(raw)) return null;
    const entry = raw[sessionId];
    if (!entry) return null;
    if (typeof entry === "string") return { filepath: entry, messageCount: 0 };
    return entry as CaptureEntry;
  } catch {
    return null;
  }
}

function markCaptured(sessionId: string, filepath: string, messageCount: number): void {
  const p = capturedPath();
  let data: Record<string, CaptureEntry> = {};
  try {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      if (!Array.isArray(raw) && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw)) {
          data[k] =
            typeof v === "string"
              ? { filepath: v, messageCount: 0 }
              : (v as CaptureEntry);
        }
      }
    }
  } catch {
    /* start fresh */
  }
  data[sessionId] = { filepath, messageCount };
  const entries = Object.entries(data);
  if (entries.length > 50) data = Object.fromEntries(entries.slice(-50));
  writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-");
}

// ── JSON schema for merged Haiku call ──

const INTELLIGENCE_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    title: { type: "string" as const, description: "Short session title, 5-10 words" },
    summary: {
      type: "string" as const,
      description:
        "What the AI did for the user, 2-4 sentences, AI perspective using 'we'",
    },
    insights: {
      type: "string" as const,
      description:
        "What worked, what was surprising, what to do differently, 2-3 bullet points",
    },
    handoff: {
      type: "string" as const,
      description:
        "If status is in-progress: what remains to be done, key decisions made, blockers. If completed: empty string.",
    },
  },
  required: ["title", "summary", "insights", "handoff"] as const,
};

interface IntelligenceOutput {
  title: string;
  summary: string;
  insights: string;
  handoff: string;
}

// ── Main handler ──

export async function captureSessionIntelligence(
  transcript: string,
  sessionId?: string
): Promise<void> {
  const messages = parseMessages(transcript);
  if (messages.length < 6 || transcript.length < 2000) return;

  // Dedup check
  if (sessionId) {
    const prev = getPreviousCapture(sessionId);
    if (prev && messages.length - prev.messageCount < MIN_NEW_MESSAGES) return;
  }

  // Skip if no API key
  if (!hasApiKey()) {
    logDebug("session-intelligence", "Skipped: no PAL_ANTHROPIC_API_KEY");
    return;
  }

  // Extract transcript windows
  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => extractContent(m))
    .filter((t) => t.length > 0);

  const lastAssistant = extractLastAssistant(messages);
  const lastAssistantText = extractContent(lastAssistant);
  const lastUser = extractLastUser(messages);
  const status = detectStatus(lastAssistantText);

  const userWindow = userMessages.slice(-10).map((t) => t.slice(0, 200));
  const assistantWindow = lastAssistantText.slice(0, 600);

  if (userWindow.length < 3) return;

  // Single Haiku call
  logDebug("session-intelligence", "Calling inference...");
  let output: IntelligenceOutput | null = null;
  try {
    const result = await inference({
      system: [
        "You analyze a session between a human user and an AI assistant. Sessions may involve coding, research, writing, planning, analysis, or any other task.",
        `Session status: ${status}.`,
        "Produce ALL of the following:",
        "1. title: short title (5-10 words) describing what was accomplished",
        "2. summary: what the AI did for the user (2-4 sentences, AI perspective using 'we')",
        "3. insights: what worked, what was surprising, what to do differently (2-3 points, no markdown)",
        status === "in-progress"
          ? "4. handoff: what remains unfinished — decisions made so far, next steps, blockers (2-4 sentences)"
          : "4. handoff: empty string (session completed)",
      ].join("\n"),
      user: `User messages:\n${userWindow.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\nLast AI response:\n${assistantWindow}`,
      maxTokens: 350,
      timeout: 15000,
      jsonSchema: INTELLIGENCE_SCHEMA,
    });

    if (result.usage) logTokenUsage("session-intelligence", result.usage);

    if (result.success && result.output) {
      output = JSON.parse(result.output) as IntelligenceOutput;
    }
  } catch (err) {
    logError("session-intelligence", err);
  }

  // Fallbacks
  const title = output?.title || extractContent(lastUser).slice(0, 80) || "session";
  const summary = output?.summary || lastAssistantText.slice(0, 600);
  const insights = output?.insights || "";
  // ── Write session learning file ──

  const category = categorizeLearning(title, summary);
  const slug = slugify(title);
  const dir = ensureDir(resolve(paths.sessionLearning(), monthPath()));
  const filename = `${fileTimestamp()}_${category}_${slug}.md`;

  const meta: Record<string, unknown> = {
    title,
    category,
    date: new Date().toISOString().slice(0, 10),
    cwd: process.cwd(),
  };
  if (sessionId) meta.session = sessionId;

  const body = [
    "## What Was Done",
    summary,
    "",
    "## Insights",
    insights || "*No insights captured.*",
  ].join("\n");

  const content = stringify(meta, body);

  // Remove previous capture for this session
  if (sessionId) {
    const prev = getPreviousCapture(sessionId);
    if (prev?.filepath && existsSync(prev.filepath)) {
      try {
        await unlink(prev.filepath);
      } catch {
        /* ignore */
      }
    }
  }

  const filepath = resolve(dir, filename);
  await writeFile(filepath, content, "utf-8");

  // Append to per-project history
  appendProjectHistory(process.cwd(), {
    date: new Date().toISOString().slice(0, 10),
    title,
    summary,
    insights,
  });

  if (sessionId) markCaptured(sessionId, filepath, messages.length);
  logDebug("session-intelligence", `Learning captured: ${title}`);
}
