/**
 * Auto-trigger for self-model synthesis — runs daily.
 *
 * Spawns synthesis as a DETACHED child instead of awaiting it inline. A cold
 * `claude -p` Sonnet spawn routinely exceeds a minute; awaiting it inside the
 * Stop hook forced a tight 30s timeout that killed every synthesis and fell
 * back to a raw data dump. Detaching lets self-model.ts use a real 90s budget
 * without blocking session end. self-model.ts carries its own 24h TTL guard,
 * so this is safe to call every session. Respects dynamicContext.selfModel.
 */

import { resolve } from "node:path";
import { spawnDetachedInference } from "../lib/detached-inference";
import { logDebug } from "../lib/log";
import { assets } from "../lib/paths";
import { isEnabled } from "../lib/settings";

export function checkSelfModelTrigger(): void {
  if (!isEnabled("selfModel")) {
    logDebug("self-model-trigger", "Disabled in pal-settings.json");
    return;
  }

  const scriptPath = resolve(assets.tools(), "self-model.ts");
  spawnDetachedInference(scriptPath, [], "self-model");
}
