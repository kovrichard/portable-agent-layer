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

import { isPalSpawnedInference } from "../core/spawn-guard";
import { recordHookRunOnExit } from "../usage/hook-run";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { closeSession, type SessionCloseInput } from "./lib/session-close";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

if (isPalSpawnedInference()) process.exit(0);

if (duplicatesCursorHooks()) process.exit(0);

closeSession(await readStdinJSON<SessionCloseInput>());
