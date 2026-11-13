/**
 * Hook: Claude Code PostToolUse on Bash. After a git command it hands the agent
 * the checkout's state as it is now. Never blocks; silent on any error.
 */

import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { recordHookRunOnExit } from "./lib/hook-run";
import { postGitInfoResponse } from "./lib/post-git-info";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

if (duplicatesCursorHooks()) process.exit(0);

try {
  const response = postGitInfoResponse(await readStdinJSON<Record<string, unknown>>());
  if (response) process.stdout.write(response);
} catch {
  process.exit(0);
}
