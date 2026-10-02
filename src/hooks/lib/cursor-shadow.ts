/**
 * cursor-agent runs every hook in ~/.claude/settings.json next to its own
 * ~/.cursor/hooks.json. With PAL registered in both, each Cursor prompt ran PAL
 * twice, so the copy started from the Claude config stands down.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentFromArgv, inCursorAgent } from "./agent";
import { platform } from "./paths";

const PAL_HOOK = /\/src\/hooks\/\w+\.ts\b/;

function cursorRunsPalHooks(): boolean {
  try {
    return PAL_HOOK.test(
      readFileSync(resolve(platform.cursorDir(), "hooks.json"), "utf-8")
    );
  } catch {
    return false;
  }
}

function isClaudeRegistrationInCursor(): boolean {
  return agentFromArgv() === "claude" && inCursorAgent();
}

/** True for the Claude-config copy of a hook that Cursor's own PAL hooks also run. */
export function duplicatesCursorHooks(): boolean {
  return isClaudeRegistrationInCursor() && cursorRunsPalHooks();
}
