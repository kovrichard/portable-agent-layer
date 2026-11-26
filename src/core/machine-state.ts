/**
 * What belongs to this machine alone: everything under `state/`, and the same
 * files where an install that has not moved yet keeps them, in `memory/state`.
 * Export skips them, import refuses them, and the move to `state/` takes them.
 * A folder ends in "/".
 */
const STATE_FILES = [
  "collector-cursors.json",
  "transcript-copies.json",
  "antigravity-conversations.json",
  "auto-update.json",
  "auto-update.log",
  "auto-update.lock",
  "collect.lock",
  "debug-enabled",
  "sessions.json",
  "session-names.json",
  "last-responses.json",
  "parked-prompt-context.json",
  "interaction-sessions.json",
  "captured-learnings.json",
  "entity-extraction.json",
  "scheduled-prompts-fired.json",
  "last-exchange/",
  "transcript-handoff/",
  "waiting-on-user/",
  "reply-sent-back/",
  "progress/",
] as const;

const FORMER_STATE = "memory/state/";

function isFormerStateFile(normalizedPath: string): boolean {
  if (!normalizedPath.startsWith(FORMER_STATE)) return false;
  const rest = normalizedPath.slice(FORMER_STATE.length);

  return STATE_FILES.some((entry) =>
    entry.endsWith("/") ? rest.startsWith(entry) : rest === entry
  );
}

/** `normalizedPath` is relative to the PAL home, with forward slashes. */
export function isMachineLocalState(normalizedPath: string): boolean {
  return normalizedPath.startsWith("state/") || isFormerStateFile(normalizedPath);
}
