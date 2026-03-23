/**
 * Stop handler: writes a structured learning file for significant sessions.
 * Dedup: only writes once per session ID (tracks in a marker file).
 * Threshold: >2000 chars transcript + at least 6 messages.
 * Output: memory/learning/session/YYYY-MM/{datetime}_work_{slug}.md
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "../lib/frontmatter";
import { inference } from "../lib/inference";
import { categorizeLearning } from "../lib/learning-category";
import { ensureDir, paths } from "../lib/paths";
import { fileTimestamp, monthPath } from "../lib/time";
import { logTokenUsage } from "../lib/token-usage";
import {
  extractContent,
  extractLastAssistant,
  extractLastUser,
  parseMessages,
} from "../lib/transcript";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-");
}

const MIN_NEW_MESSAGES = 10;

interface CaptureEntry {
  filepath: string;
  messageCount: number;
}

/** Get the previously captured entry for a session, if any */
function getPreviousCapture(sessionId: string): CaptureEntry | null {
  const markerPath = resolve(paths.state(), "captured-learnings.json");
  if (!existsSync(markerPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(markerPath, "utf-8"));
    if (Array.isArray(raw)) return null;
    const entry = raw[sessionId];
    if (!entry) return null;
    // Migrate old string format
    if (typeof entry === "string") return { filepath: entry, messageCount: 0 };
    return entry as CaptureEntry;
  } catch {
    return null;
  }
}

function markCaptured(sessionId: string, filepath: string, messageCount: number): void {
  const markerPath = resolve(paths.state(), "captured-learnings.json");
  let data: Record<string, CaptureEntry> = {};
  try {
    if (existsSync(markerPath)) {
      const raw = JSON.parse(readFileSync(markerPath, "utf-8"));
      if (!Array.isArray(raw) && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === "string") {
            data[k] = { filepath: v, messageCount: 0 };
          } else {
            data[k] = v as CaptureEntry;
          }
        }
      }
    }
  } catch {
    /* start fresh */
  }
  data[sessionId] = { filepath, messageCount };
  // Keep last 50
  const entries = Object.entries(data);
  if (entries.length > 50) {
    data = Object.fromEntries(entries.slice(-50));
  }
  writeFileSync(markerPath, JSON.stringify(data, null, 2), "utf-8");
}

export async function captureWorkLearning(
  transcript: string,
  sessionId?: string
): Promise<void> {
  if (transcript.length < 2000) return;

  const messages = parseMessages(transcript);
  if (messages.length < 6) return;

  // Skip if not enough new messages since last capture
  if (sessionId) {
    const prev = getPreviousCapture(sessionId);
    if (prev && messages.length - prev.messageCount < MIN_NEW_MESSAGES) return;
  }

  const lastUser = extractLastUser(messages);
  const lastAssistant = extractLastAssistant(messages);

  const rawTitle = extractContent(lastUser).slice(0, 80) || "session";
  const rawSummary = extractContent(lastAssistant).slice(0, 600);

  // Generate title, summary, and insights in a single inference call
  let title = rawTitle;
  let summary = rawSummary;
  let insights = "";
  try {
    const userMessages = messages
      .filter((m) => m.role === "user")
      .map((m) => extractContent(m).slice(0, 100))
      .slice(-8)
      .join("\n");
    const result = await inference({
      system:
        "You summarize AI coding sessions between a human user and an AI assistant. The 'Human messages' are what the user said. The 'AI response' is what the assistant said. Produce: 1) a short title (5-10 words) describing what was accomplished, 2) a summary of what the AI assistant did for the user (2-4 sentences, write from the AI's perspective using 'we'), 3) insights — what worked well, what was surprising, or what should be done differently next time (2-3 bullet points, no markdown).",
      user: `Human messages:\n${userMessages}\n\nAI response:\n${rawSummary.slice(0, 400)}`,
      maxTokens: 300,
      timeout: 15000,
      jsonSchema: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          title: { type: "string" as const },
          summary: { type: "string" as const },
          insights: { type: "string" as const },
        },
        required: ["title", "summary", "insights"],
      },
    });
    if (result.usage) logTokenUsage("work-learning", result.usage);
    if (result.success && result.output) {
      const parsed = JSON.parse(result.output) as {
        title?: string;
        summary?: string;
        insights?: string;
      };
      if (parsed.title) title = parsed.title.slice(0, 100);
      if (parsed.summary) summary = parsed.summary;
      if (parsed.insights) insights = parsed.insights;
    }
  } catch {
    // Fallback to raw values
  }
  const category = categorizeLearning(title, summary);

  const slug = slugify(title);
  const dir = ensureDir(resolve(paths.sessionLearning(), monthPath()));
  const filename = `${fileTimestamp()}_${category}_${slug}.md`;

  const meta: Record<string, unknown> = {
    title,
    category,
    date: new Date().toISOString().slice(0, 10),
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

  // Remove previous capture for this session (overwrite on continued conversations)
  if (sessionId) {
    const prev = getPreviousCapture(sessionId);
    if (prev?.filepath && existsSync(prev.filepath)) {
      try {
        unlinkSync(prev.filepath);
      } catch {
        /* ignore */
      }
    }
  }

  const filepath = resolve(dir, filename);
  writeFileSync(filepath, content, "utf-8");

  if (sessionId) markCaptured(sessionId, filepath, messages.length);
}
