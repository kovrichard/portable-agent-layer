/**
 * UserPromptSubmit handler: a message that names a PAL surface is judged in a
 * detached child, whose verdict only lands in bronze (shadow mode).
 */

import { isSystemText, stripInjectedTags } from "../../core/prompt-text";
import { spawnDetachedInference } from "../../inference/detached-inference";
import { canInfer } from "../../inference/inference";
import { judge } from "../../inference/judge";
import { namesPalSurface, palBugJudgment } from "../../report/pal-bug";

interface SignalDeps {
  spawn: typeof spawnDetachedInference;
  canInfer: () => boolean;
}

const DEFAULT_DEPS: SignalDeps = { spawn: spawnDetachedInference, canInfer };

function isCommand(message: string): boolean {
  return /^[/$`{]/.test(message);
}

export function capturePalBugSignal(
  message: string,
  sessionId?: string,
  deps: SignalDeps = DEFAULT_DEPS
): void {
  const cleaned = stripInjectedTags(message).trim();
  if (isSystemText(cleaned) || isCommand(cleaned) || !namesPalSurface(cleaned)) return;

  if (!deps.canInfer()) return;
  deps.spawn(
    import.meta.filename,
    ["--pal-bug", sessionId ?? "", Buffer.from(cleaned).toString("base64")],
    "pal-bug"
  );
}

export async function judgePalBug(
  message: string,
  sessionId?: string,
  deps?: Parameters<typeof judge>[1]
): Promise<void> {
  await judge(palBugJudgment(message, sessionId), deps);
}

if (process.argv[2] === "--pal-bug") {
  const message = Buffer.from(process.argv[4] ?? "", "base64").toString("utf-8");
  if (message) await judgePalBug(message, process.argv[3] || undefined);

  process.exit(0);
}
