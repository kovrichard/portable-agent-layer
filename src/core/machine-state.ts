/**
 * State under memory/ that belongs to this machine and cannot be rebuilt, so it
 * stays where it is but never crosses machines: export skips it, import refuses it.
 * A folder ends in "/".
 */
const MACHINE_LOCAL_STATE = [
  "memory/state/collector-cursors.json",
  "memory/state/transcript-copies.json",
  "memory/state/antigravity-conversations.json",
  "memory/state/auto-update.json",
  "memory/state/auto-update.log",
  "memory/state/auto-update.lock",
  "memory/state/last-exchange/",
] as const;

export function isMachineLocalState(relPath: string): boolean {
  const rel = relPath.replaceAll("\\", "/").replace(/^\.\//, "");

  return MACHINE_LOCAL_STATE.some((entry) =>
    entry.endsWith("/") ? rel.startsWith(entry) : rel === entry
  );
}
