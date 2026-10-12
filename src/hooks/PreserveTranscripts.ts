/**
 * Spawned, never awaited — copies Claude Code transcripts into PAL's content
 * store in a process of its own, so no session waits on the gzip.
 */

import { logError } from "./lib/log";
import { preserveTranscriptsOnce } from "./lib/transcript-preserve";

try {
  preserveTranscriptsOnce();
} catch (err) {
  logError("PreserveTranscripts", err);
}
