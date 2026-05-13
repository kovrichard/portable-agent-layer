/**
 * UserPromptSubmit handler: inject the top-N matching prior lessons into the prompt.
 *
 * Called from UserPromptOrchestrator. Reads the retrieval index, ranks the prompt
 * against the corpus, prints a `<system-reminder>` block to stdout (Claude Code
 * prepends UserPromptSubmit hook stdout to the prompt). Fail-closed: any error or
 * timeout produces empty output, never blocks the prompt.
 */

import { logDebug, logError } from "../lib/log";
import { runRetrieval } from "../lib/retrieval";
import { ensureIndex } from "../lib/retrieval-index";
import { isEnabled } from "../lib/settings";

const TIMEOUT_MS = 250;

function withTimeout<T>(work: () => T, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    try {
      const result = work();
      clearTimeout(timer);
      resolve(result);
    } catch (err) {
      clearTimeout(timer);
      logError("inject-retrieval", err);
      resolve(null);
    }
  });
}

/** Returns the retrieval reminder string, or null if nothing to inject. */
export async function getRetrievalReminder(prompt: string): Promise<string | null> {
  if (!prompt?.trim()) return null;
  if (!isEnabled("learningInjection")) return null;

  const result = await withTimeout(() => {
    const index = ensureIndex();
    if (index.corpusSize === 0) return null;
    return runRetrieval(prompt, index, process.cwd());
  }, TIMEOUT_MS);

  if (!result?.reminder) return null;

  logDebug(
    "inject-retrieval",
    `${result.matches.length} matches; top score=${result.matches[0]?.confidence.toFixed(3)}`
  );

  return result.reminder;
}

/** Claude Code / Cursor path: write reminder to stdout for hook prepend. */
export async function injectRetrieval(prompt: string): Promise<void> {
  const reminder = await getRetrievalReminder(prompt);
  if (!reminder) return;
  process.stdout.write(`${reminder}\n`);
}
