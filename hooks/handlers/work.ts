/**
 * Stop handler: saves session state so the next session can pick up.
 */

import { writeFileSync } from "fs";
import { resolve } from "path";
import { paths, ensureDir } from "../lib/paths";
import { now } from "../lib/time";

export async function captureWork(transcript: string): Promise<void> {
  try {
    const messages = JSON.parse(transcript);
    if (!Array.isArray(messages)) return;

    const lastUser = messages.filter((m: any) => m.role === "user").pop();
    const lastAssistant = messages
      .filter((m: any) => m.role === "assistant")
      .pop();

    const extract = (msg: any): string => {
      if (!msg) return "";
      return typeof msg.content === "string"
        ? msg.content.slice(0, 300)
        : JSON.stringify(msg.content).slice(0, 300);
    };

    const stateDir = ensureDir(paths.state());
    writeFileSync(
      resolve(stateDir, "current-work.json"),
      JSON.stringify(
        {
          ts: now(),
          last_user: extract(lastUser),
          last_assistant: extract(lastAssistant),
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
