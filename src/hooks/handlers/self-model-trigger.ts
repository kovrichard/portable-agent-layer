/**
 * Auto-trigger for self-model synthesis — runs daily.
 * writeSelfModel has a 24h TTL guard, so this is safe to call every session.
 */

import { writeSelfModel } from "../../tools/self-model";
import { logDebug } from "../lib/log";

export async function checkSelfModelTrigger(): Promise<void> {
  try {
    const result = await writeSelfModel(30);
    if (result.skipped) {
      logDebug("self-model-trigger", "Skipped — last synthesis < 24h ago");
    } else {
      logDebug("self-model-trigger", `Self-model written: ${result.path}`);
    }
  } catch {
    // Non-critical — self-model is best-effort
  }
}
