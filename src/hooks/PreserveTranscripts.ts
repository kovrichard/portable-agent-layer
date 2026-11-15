/**
 * Spawned, never awaited — copies Claude Code transcripts into PAL's content
 * store in a process of its own, so no session waits on the gzip.
 */

import { preserveTranscriptsOnce } from "../bronze/transcript-preserve";
import { logError } from "../core/log";
import { recordHookRunOnExit } from "../usage/hook-run";

recordHookRunOnExit();

try {
  preserveTranscriptsOnce();
} catch (err) {
  logError("PreserveTranscripts", err);
}
