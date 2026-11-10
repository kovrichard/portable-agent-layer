/**
 * Spawned, never awaited — copies Claude Code transcripts into PAL's content
 * store in a process of its own, so no session waits on the gzip.
 */

import { recordHookRunOnExit } from "./lib/hook-run";
import { logError } from "./lib/log";
import { preserveTranscriptsOnce } from "./lib/transcript-preserve";

recordHookRunOnExit();

try {
  preserveTranscriptsOnce();
} catch (err) {
  logError("PreserveTranscripts", err);
}
