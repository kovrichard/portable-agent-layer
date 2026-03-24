/**
 * UserPromptSubmit handler: generates a 4-word name for the session.
 *
 * Architecture (fast-exit):
 * - First prompt: instant deterministic name from keywords (<10ms),
 *   then spawns a detached background process to upgrade via inference.
 * - Subsequent prompts: no-op (name already set).
 *
 * This avoids the 1-5s inference latency that previously blocked every first prompt.
 */

import { spawn } from "node:child_process";
import { inference } from "../lib/inference";
import { logDebug, logError } from "../lib/log";
import {
  extractFallbackName,
  readSessionNames,
  writeSessionName,
} from "../lib/session-names";
import { logTokenUsage } from "../lib/token-usage";

const NAME_PROMPT =
  "You generate concise 4-word session titles for AI coding sessions. " +
  "Output EXACTLY 4 words in Title Case, no punctuation. Describe the specific task. " +
  'Example: "Fix Session Name Generation", "Debug Auth Token Refresh"';

export async function captureSessionName(
  message: string,
  sessionId: string
): Promise<void> {
  if (!sessionId) return;

  // Skip if this session is already named (non-untitled)
  const names = readSessionNames();
  const existing = names[sessionId];
  if (existing && existing !== "untitled session") return;

  // Try deterministic name from this message's keywords
  const name = extractFallbackName(message);
  if (name === "untitled session") return; // not enough keywords yet
  writeSessionName(sessionId, name);
  logDebug("session-name", `Named from prompt: "${name}"`);

  // Spawn detached background process to upgrade with Haiku inference
  if (!process.env.ANTHROPIC_API_KEY) return;
  try {
    const promptB64 = Buffer.from(message.slice(0, 800)).toString("base64");
    const child = spawn(
      "bun",
      [import.meta.filename, "--upgrade", sessionId, promptB64, name],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, CLAUDECODE: undefined },
      }
    );
    child.unref();
    logDebug("session-name", "Spawned background Haiku upgrade");
  } catch {
    // Non-critical — deterministic name is already stored
  }
}

/**
 * Background upgrade mode: called via --upgrade flag from a detached subprocess.
 * Runs inference for a better name, writes only if the name hasn't changed since spawn.
 */
async function upgradeWithInference(
  sessionId: string,
  promptB64: string,
  expectedName: string
): Promise<void> {
  try {
    // Version guard: if name changed since we were spawned, skip
    const currentNames = readSessionNames();
    if (currentNames[sessionId] !== expectedName) return;

    const promptText = Buffer.from(promptB64, "base64").toString("utf-8");
    const result = await inference({
      system: NAME_PROMPT,
      user: `Generate a 4-word title for: "${promptText}"`,
      maxTokens: 20,
      timeout: 10000,
    });

    if (result.usage) logTokenUsage("session-name", result.usage);
    if (!result.success || !result.output) return;

    let label = result.output
      .replace(/^["']|["']$/g, "")
      .replace(/[.!?,;:]/g, "")
      .trim();

    const words = label.split(/\s+/).slice(0, 4);
    label = words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    const allSubstantial = words.every((w) => w.length >= 3);
    if (!label || words.length !== 4 || !allSubstantial) return;

    // Only write if name hasn't changed (re-read under guard)
    const freshNames = readSessionNames();
    if (freshNames[sessionId] !== expectedName) return;

    writeSessionName(sessionId, label);
    logDebug("session-name", `Background upgrade: "${label}"`);
  } catch (err) {
    logError("session-name:upgrade", err);
  }
}

// Background upgrade entry point
if (process.argv[2] === "--upgrade") {
  const sid = process.argv[3];
  const prompt = process.argv[4];
  const expected = process.argv[5];
  if (sid && prompt && expected !== undefined) {
    await upgradeWithInference(sid, prompt, expected);
  }
  process.exit(0);
}
