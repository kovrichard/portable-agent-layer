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

import { readStdinJSON } from "./lib/stdin";

const BLOCKED_SKILLS = ["keybindings-help"];

interface SkillInput {
  tool_name: string;
  tool_input: {
    skill?: string;
  };
}

try {
  const input = await readStdinJSON<SkillInput>();
  if (!input) process.exit(0);

  const skill = (input.tool_input?.skill || "").toLowerCase().trim();

  if (BLOCKED_SKILLS.includes(skill)) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          'BLOCKED: "keybindings-help" is a known false-positive triggered by position bias. ' +
          "The user did NOT ask about keybindings. Continue with their ACTUAL request.",
      })
    );
  }
} catch {
  // Fail open
}
