/**
 * Hook: session end — the moment PAL updates itself.
 *
 * Every agent PAL targets fires one of these when a session is done: Claude's
 * SessionEnd, Cursor's sessionEnd, Codex's SessionEnd, Copilot's sessionEnd.
 * opencode has no session-end event and calls the same library function from its
 * plugin when the server is disposed.
 *
 * Closing is the right moment because the work is over: the reinstall cannot
 * rewrite the config of a session still in use, and opening PAL costs nothing.
 */

import { autoUpdateOnClose } from "./lib/auto-update";
import { logError } from "./lib/log";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

if (isPalSpawnedInference()) process.exit(0);

try {
  const input = await readStdinJSON<{ reason?: string }>();
  autoUpdateOnClose(input?.reason);
} catch (err) {
  logError("SessionClose", err);
}
