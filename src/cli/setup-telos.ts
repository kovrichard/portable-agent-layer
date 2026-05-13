/**
 * Interactive TELOS setup — prompts for personal context during `pal install`.
 * Skips any step whose TELOS file already has real content.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as clack from "@clack/prompts";
import { palHome } from "../hooks/lib/paths";
import { hasRealContent, SETUP_STEPS, STEP_ORDER } from "../hooks/lib/setup";

/** Prompt for missing TELOS context. Skips any step whose file already has real content. */
export async function promptTelos(): Promise<void> {
  // Skip interactive prompts in non-TTY environments (tests, CI)
  if (!process.stdin.isTTY) return;

  const home = palHome();
  const pending = STEP_ORDER.filter(
    (key) => !hasRealContent(resolve(home, SETUP_STEPS[key].file))
  );

  if (pending.length === 0) {
    clack.log.info("TELOS already configured");
    return;
  }

  clack.intro("Personal Context Setup");
  clack.note(
    "Answer in a sentence or two — you can edit the files in ~/.pal/telos/ for more detail later.",
    "Quick setup"
  );

  for (const key of pending) {
    const step = SETUP_STEPS[key];
    const title = key.charAt(0).toUpperCase() + key.slice(1);

    const answer = await clack.text({
      message: step.question,
      placeholder: step.hint,
    });

    if (clack.isCancel(answer)) {
      clack.cancel("Setup cancelled");
      return;
    }

    const filePath = resolve(home, step.file);
    writeFileSync(filePath, `# ${title}\n\n${answer}\n`, "utf-8");
  }

  clack.outro("Personal context saved ✓");
}
