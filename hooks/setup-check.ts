/**
 * CLI helper: check setup state and output results.
 *
 * Usage:
 *   bun run hooks/setup-check.ts status     → "complete" or "incomplete"
 *   bun run hooks/setup-check.ts init        → create setup.json if missing
 *   bun run hooks/setup-check.ts prompt      → output setup prompt (if incomplete)
 *
 * Used by shell scripts to avoid duplicating setup logic.
 */

import {
  buildSetupPrompt,
  ensureSetupState,
  isSetupComplete,
  readSetupState,
} from "./lib/setup";

const command = process.argv[2] ?? "status";

switch (command) {
  case "status": {
    const state = readSetupState();
    console.log(state && isSetupComplete(state) ? "complete" : "incomplete");
    break;
  }
  case "init": {
    ensureSetupState();
    break;
  }
  case "prompt": {
    const state = readSetupState();
    if (state) {
      const prompt = buildSetupPrompt(state);
      if (prompt) console.log(prompt);
    }
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
