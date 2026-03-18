/**
 * Stop handler: LLM-powered session reflection.
 * Uses Haiku to extract corrections, preferences, and project state changes
 * from the session transcript — things regex-based handlers miss.
 *
 * Requires ANTHROPIC_API_KEY. Silently skips if unavailable.
 */

import { parseMessages, extractContent } from "../lib/transcript";
import { inference } from "../lib/inference";
import { paths } from "../lib/paths";
import { logDebug, logError } from "../lib/log";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { Message } from "../lib/transcript";

/** Trim transcript to last ~4000 chars of user messages for Haiku context */
function buildTranscriptExcerpt(messages: Message[]): string {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => extractContent(m))
    .filter((t) => t.length > 10);

  let result = "";
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const candidate = userMessages[i] + "\n---\n" + result;
    if (candidate.length > 4000) break;
    result = candidate;
  }
  return result.trim();
}

interface ReflectionOutput {
  wisdom?: Array<{ domain: string; text: string }>;
  telos?: Array<{ file: string; change: string }>;
}

const SYSTEM_PROMPT = `You analyze AI assistant session transcripts to extract what should be remembered for future sessions.

Extract TWO types of items:

1. **wisdom** — Corrections, preferences, or principles the user stated or implied. These are things the AI got wrong and the user corrected, or workflow preferences the user revealed. Each item needs a domain (coding, git, communication, tools, workflow, sales, project, general) and the principle as a concise statement.

2. **telos** — Project state changes. If a project changed status (e.g. from "Sales" to "Active"), a new project appeared, or a goal was achieved/changed. Each item needs the TELOS file name (PROJECTS.md, GOALS.md, CHALLENGES.md, MISSION.md, BELIEFS.md) and a description of what changed.

Rules:
- Only extract things that are REUSABLE across future sessions, not one-off task details
- Corrections from the user are high-value — always capture these
- If nothing meaningful happened, return empty arrays
- Be concise — each text/change should be one sentence`;

const REFLECTION_SCHEMA = {
  type: "object",
  properties: {
    wisdom: {
      type: "array",
      items: {
        type: "object",
        properties: {
          domain: { type: "string" },
          text: { type: "string" },
        },
        required: ["domain", "text"],
        additionalProperties: false,
      },
    },
    telos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          change: { type: "string" },
        },
        required: ["file", "change"],
        additionalProperties: false,
      },
    },
  },
  required: ["wisdom", "telos"],
  additionalProperties: false,
} as const;

export async function captureReflection(transcript: string): Promise<void> {
  const messages = parseMessages(transcript);
  if (messages.length < 4) return;

  const excerpt = buildTranscriptExcerpt(messages);
  if (excerpt.length < 100) return;

  const result = await inference({
    system: SYSTEM_PROMPT,
    user: excerpt,
    maxTokens: 500,
    timeout: 10_000,
    jsonSchema: REFLECTION_SCHEMA,
  });

  if (!result.success || !result.output) {
    logDebug("reflection", `Inference failed or empty (success=${result.success})`);
    return;
  }

  let parsed: ReflectionOutput;
  try {
    parsed = JSON.parse(result.output);
  } catch (err) {
    logError("reflection", `Failed to parse output: ${result.output}`);
    return;
  }

  // Write wisdom items to frames
  if (parsed.wisdom?.length) {
    for (const item of parsed.wisdom.slice(0, 5)) {
      const domain = item.domain || "general";
      const framesDir = paths.wisdom();
      const filepath = resolve(framesDir, `${domain}.md`);

      const entry = `- ${item.text} [CRYSTAL: 90%]\n`;
      const existing = existsSync(filepath)
        ? readFileSync(filepath, "utf-8")
        : "";

      // Dedup by first 60 chars
      if (existing.includes(item.text.slice(0, 60))) continue;

      writeFileSync(filepath, existing + entry, "utf-8");
      logDebug("reflection", `Wisdom added to ${domain}: ${item.text.slice(0, 60)}`);
    }
  }

  // Write TELOS update flags for next session
  if (parsed.telos?.length) {
    const pendingPath = resolve(paths.state(), "pending-telos-update.json");
    const existing = existsSync(pendingPath)
      ? JSON.parse(readFileSync(pendingPath, "utf-8"))
      : [];

    const updates = [
      ...existing,
      ...parsed.telos.slice(0, 3).map((t) => ({
        file: t.file,
        change: t.change,
        ts: new Date().toISOString(),
      })),
    ];

    writeFileSync(pendingPath, JSON.stringify(updates, null, 2), "utf-8");
  }
}
