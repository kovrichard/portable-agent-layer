/**
 * A commitment is an ISC: completing it keeps it, retiring it drops it, and a
 * snooze puts it off. Each change of state is one event, whichever surface made it.
 */

import { appendEvent, logQuietly } from "./events";

export type CommitmentOutcome = "kept" | "dropped" | "snoozed" | "reopened";

export function logCommitment(
  iscProject: string,
  isc: number,
  outcome: CommitmentOutcome,
  surface: "cli" | "control-room",
  snoozeDays: number | null = null
): void {
  logQuietly("commitment", () =>
    appendEvent("commitment", { iscProject, isc, outcome, surface, snoozeDays })
  );
}
