/**
 * Hook: Claude Code PostToolUse on Bash. After a git command it hands the agent
 * the checkout's state as it is now. Never blocks; silent on any error.
 */

import { postGitInfoResponse } from "../context/post-git-info";
import { recordHookRunOnExit } from "../usage/hook-run";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

if (duplicatesCursorHooks()) process.exit(0);

try {
  const response = postGitInfoResponse(await readStdinJSON<Record<string, unknown>>());
  if (response) process.stdout.write(response);
} catch {
  process.exit(0);
}
