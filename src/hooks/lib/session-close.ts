import {
  spawnTranscriptPreserve,
  stageSessionTranscript,
} from "../../bronze/transcript-preserve";
import { logError } from "../../core/log";
import { logSessionEnd } from "../../usage/session-events";
import { autoUpdateOnClose } from "./auto-update";
import { startSyncIfDue } from "./sync-trigger";

export interface SessionCloseInput {
  reason?: string;
  transcript_path?: string;
}

export interface SessionCloseSteps {
  logEnd: (input: SessionCloseInput | null) => void;
  autoUpdate: (reason: string | undefined) => void;
  startSync: () => void;
  spawnPreserve: () => void;
  stageTranscript: (transcriptPath: string | undefined) => unknown;
}

const defaultSteps: SessionCloseSteps = {
  logEnd: (input) => logSessionEnd(input),
  autoUpdate: autoUpdateOnClose,
  startSync: () => startSyncIfDue("end"),
  spawnPreserve: spawnTranscriptPreserve,
  stageTranscript: (transcriptPath) => stageSessionTranscript(transcriptPath),
};

function guarded(step: () => unknown): void {
  try {
    step();
  } catch (err) {
    logError("SessionClose", err);
  }
}

/**
 * The cheap steps run first: the agent cancels a session-end hook that overruns
 * its budget, and the transcript copy is the one step whose time grows with the
 * session.
 */
export function closeSession(
  input: SessionCloseInput | null,
  steps: SessionCloseSteps = defaultSteps
): void {
  guarded(() => {
    steps.logEnd(input);
    steps.autoUpdate(input?.reason);
    steps.startSync();
  });
  guarded(steps.spawnPreserve);
  guarded(() => steps.stageTranscript(input?.transcript_path));
}
