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

import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isRecaptureWorthwhile,
  learningSlug,
  markCaptured,
  readCapture,
} from "../lib/capture-store";
import { stringify } from "../lib/frontmatter";
import { canInfer, inference } from "../lib/inference";
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

/** @lintignore exercised directly by test/session-intelligence.test.ts */
export async function captureSessionIntelligence(
  transcript: string,
  sessionId?: string
): Promise<void> {
  const messages = parseMessages(transcript);
  if (messages.length < 6 || transcript.length < 2000) return;

  if (sessionId && !isRecaptureWorthwhile(readCapture(sessionId), messages.length)) {
    return;
  }

  // Skip if no inference path is available (no CLI binary AND no API key)
  if (!canInfer()) {
    logDebug("session-intelligence", "Skipped: canInfer() false (no CLI + no API key)");
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
  const numberedMessages = userWindow.map((m, i) => `${i + 1}. ${m}`).join("\n");
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
      user: `User messages:\n${numberedMessages}\n\nLast AI response:\n${assistantWindow}`,
      maxTokens: 350,
      timeout: 90000,
      jsonSchema: INTELLIGENCE_SCHEMA,
      caller: "session-intelligence",
      sessionId,
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
  const slug = learningSlug(title);
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
    const prev = readCapture(sessionId);
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

// Detached child entry point — re-reads transcript from tmp path, then unlinks it.
if (process.argv[2] === "--run") {
  const sid = process.argv[3];
  const transcriptPath = process.argv[4];
  if (transcriptPath) {
    const { readFile, unlink } = await import("node:fs/promises");
    try {
      const transcript = await readFile(transcriptPath, "utf-8");
      await captureSessionIntelligence(transcript, sid === "" ? undefined : sid);
    } catch (err) {
      logError("session-intelligence:run", err);
    } finally {
      await unlink(transcriptPath).catch(() => {});
    }
  }
  process.exit(0);
}
