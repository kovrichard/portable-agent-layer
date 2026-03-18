/**
 * Stop handler: saves session state so the next session can pick up.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "../lib/paths";
import { now } from "../lib/time";
import {
  extractContent,
  extractLastAssistant,
  extractLastUser,
  parseMessages,
} from "../lib/transcript";

export async function captureWork(transcript: string): Promise<void> {
  try {
    const messages = parseMessages(transcript);
    if (messages.length === 0) return;

    const lastUser = extractLastUser(messages);
    const lastAssistant = extractLastAssistant(messages);

    const stateDir = ensureDir(paths.state());
    writeFileSync(
      resolve(stateDir, "current-work.json"),
      JSON.stringify(
        {
          ts: now(),
          last_user: extractContent(lastUser).slice(0, 300),
          last_assistant: extractContent(lastAssistant).slice(0, 300),
          cwd: process.cwd(),
        },
        null,
        2
      )
    );
  } catch {
    // Non-critical
  }
}
