/**
 * UserPromptSubmit handler: inject the top-N matching prior lessons into the prompt.
 *
 * Called from UserPromptOrchestrator. Reads the retrieval index, ranks the prompt
 * against the corpus, prints a `<system-reminder>` block to stdout (Claude Code
 * prepends UserPromptSubmit hook stdout to the prompt). Fail-closed: any error
 * produces empty output, never blocks the prompt.
 */

import { isCodex, isCursor } from "../lib/agent";
import { logDebug, logError } from "../lib/log";
import { runRetrieval } from "../lib/retrieval";
import { ensureIndex } from "../lib/retrieval-index";
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

/** Returns the retrieval reminder string, or null if nothing to inject.
 *  @lintignore exercised directly by test/inject-retrieval.test.ts */
export async function getRetrievalReminder(prompt: string): Promise<string | null> {
  if (!prompt?.trim()) return null;
  if (!isEnabled("learningInjection")) return null;

  const result = withinBudget(() => {
    const index = ensureIndex();
    if (index.corpusSize === 0) return null;
    return runRetrieval(prompt, index, process.cwd());
  }, BUDGET_MS);

  if (!result?.reminder) return null;

  logDebug(
    "inject-retrieval",
    `${result.matches.length} matches; top score=${result.matches[0]?.confidence.toFixed(3)}`
  );

  return result.reminder;
}

/** Write a reminder to stdout in the correct format for the current agent.
 *  Claude Code: plain text. Cursor: { additional_context }. Codex: hookSpecificOutput JSON.
 *  MUST be called at most once per hook run — Cursor/Codex expect a single JSON
 *  object on stdout, so all prompt-time context is merged before this call. */
function writeForAgent(reminder: string): void {
  if (isCursor()) {
    process.stdout.write(JSON.stringify({ additional_context: reminder }));
  } else if (isCodex()) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: reminder,
        },
      })
    );
  } else {
    process.stdout.write(`${reminder}\n`);
  }
}

/** Merge every prompt-time source — the wall clock, contextual steering, skill
 *  matches, prior-lesson retrieval — into one payload, or null when none of them
 *  produced anything. The clock leads: it is the only part that is true of the
 *  moment rather than of the prompt.
 *  @lintignore dynamically imported by opencode plugin */
export async function getPromptContext(prompt: string): Promise<string | null> {
  const parts = [
    getWallClockReminder(),
    getSteeringReminder(prompt),
    getSkillReminder(prompt),
    await getRetrievalReminder(prompt),
  ].filter((p): p is string => Boolean(p));

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Gather all prompt-time context and do the one per-agent write. Returns the
 *  combined reminder that was injected, or null if there was nothing to inject. */
export async function injectPromptContext(prompt: string): Promise<string | null> {
  const combined = await getPromptContext(prompt);
  if (combined) writeForAgent(combined);
  return combined;
}
