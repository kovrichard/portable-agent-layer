/**
 * Spawned, never awaited — copies Claude Code transcripts into PAL's content
 * store in a process of its own, so no session waits on the gzip.
 */

import { logError } from "../core/log";
import { recordHookRunOnExit } from "./lib/hook-run";
import { preserveTranscriptsOnce } from "./lib/transcript-preserve";

recordHookRunOnExit();

try {
  preserveTranscriptsOnce();
} catch (err) {
  logError("PreserveTranscripts", err);
}
