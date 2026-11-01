/**
 * UserPromptSubmit handler: inject the prompt-time context into the prompt.
 *
 * Called from UserPromptOrchestrator. Prints a `<system-reminder>` block to stdout
 * (Claude Code prepends UserPromptSubmit hook stdout to the prompt). Fail-closed:
 * any error produces empty output, never blocks the prompt.
 */

import { promptRulesReminder } from "../lib/adaptation-steering";
import { promptContextResponse } from "../lib/agent";
import { dueNudgeReminder } from "../lib/daily-nudge";
import { getEntityReminder } from "../lib/entity-cards";
import { observeTurn } from "../lib/interaction";
import { logDebug, logError } from "../lib/log";
import { parkPromptContext } from "../lib/parked-context";
import { progressTreePromptLine } from "../lib/progress-tree-context";
import { isSystemText } from "../lib/prompt-text";
import { getRepoStateReminder } from "../lib/repo-state";
import { runModePromptLine } from "../lib/run-mode-gate";
import { scheduledPromptsReminder } from "../lib/scheduled-prompts";
import { isEnabled } from "../lib/settings";
import { getSkillReminder } from "../lib/skill-match";
import { getSteeringReminder } from "../lib/steering";
import { getWallClockReminder } from "../lib/wall-clock";

const BUDGET_MS = 250;

/** Run sync work on the prompt path, containing any throw. A synchronous call cannot
 *  be preempted on a single thread, so the budget is measured and logged, never
 *  enforced — an overrun still returns its result rather than being discarded.
 *  @lintignore exported for test/inject-retrieval.test.ts */
export function withinBudget<T>(work: () => T, ms: number): T | null {
  const started = performance.now();
  try {
    return work();
  } catch (err) {
    logError("inject-retrieval", err);
    return null;
  } finally {
    const elapsed = performance.now() - started;
    if (elapsed > ms) {
      logDebug("inject-retrieval", `over budget: ${elapsed.toFixed(0)}ms > ${ms}ms`);
    }
  }
}

/** MUST be called at most once per hook run — the JSON shapes are a single object
 *  on stdout, so all prompt-time context is merged before this call. */
function writeForAgent(reminder: string, sessionId?: string): void {
  const response = promptContextResponse(reminder);
  if (response) process.stdout.write(response);
  else if (sessionId) parkPromptContext(sessionId, reminder);
}

/** Merge every prompt-time source — the wall clock, the repo state, contextual steering, skill
 *  matches, entity cards — into one payload, or null when none of them
 *  produced anything. The clock leads: it is the only part that is true of the
 *  moment rather than of the prompt.
 *  @lintignore dynamically imported by opencode plugin */
export async function getPromptContext(
  prompt: string,
  sessionId?: string
): Promise<string | null> {
  const userText = isSystemText(prompt) ? "" : prompt;
  const parts = [
    getWallClockReminder(),
    withinBudget(() => runModePromptLine(process.cwd()), BUDGET_MS),
    userText &&
      withinBudget(() => scheduledPromptsReminder(process.cwd(), sessionId), BUDGET_MS),
    userText && withinBudget(() => promptRulesReminder(userText, sessionId), BUDGET_MS),
    withinBudget(() => getRepoStateReminder(), BUDGET_MS),
    withinBudget(() => progressTreePromptLine(userText, undefined, sessionId), BUDGET_MS),
    userText && withinBudget(() => observeTurn(userText, sessionId), BUDGET_MS),
    withinBudget(() => dueNudgeReminder(), BUDGET_MS),
    userText && getSteeringReminder(userText),
    userText && getSkillReminder(userText),
    userText &&
      isEnabled("entityCards") &&
      withinBudget(() => getEntityReminder(userText), BUDGET_MS),
  ].filter((p): p is string => Boolean(p));

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Gather all prompt-time context and do the one per-agent write. Returns the
 *  combined reminder that was injected, or null if there was nothing to inject. */
export async function injectPromptContext(
  prompt: string,
  sessionId?: string
): Promise<string | null> {
  const combined = await getPromptContext(prompt, sessionId);
  if (combined) writeForAgent(combined, sessionId);
  return combined;
}
