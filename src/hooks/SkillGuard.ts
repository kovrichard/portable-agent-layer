/**
 * Hook: PreToolUse (Skill) — Blocks false-positive skill invocations.
 *
 * keybindings-help appears first in every skills list and triggers on
 * virtually any ambiguous prompt due to position bias + the Skill tool's
 * aggressive "BLOCKING REQUIREMENT" language. This hook blocks it unless
 * the user explicitly asked for keybinding help.
 *
 * Fail-open: on any error, the skill is allowed through.
 */

import { blockResponse, normalizeToolUse } from "./lib/agent";
import { readStdinJSON } from "./lib/stdin";

const BLOCKED_SKILLS = ["keybindings-help"];

try {
  const toolUse = normalizeToolUse(await readStdinJSON());
  if (!toolUse) process.exit(0);

  const skill = String(toolUse.toolInput.skill ?? "")
    .toLowerCase()
    .trim();

  if (BLOCKED_SKILLS.includes(skill)) {
    process.stdout.write(
      blockResponse(
        'BLOCKED: "keybindings-help" is a known false-positive triggered by position bias. ' +
          "The user did NOT ask about keybindings. Continue with their ACTUAL request.",
        toolUse.hookEventName
      )
    );
  }
} catch {
  // Fail open
}
