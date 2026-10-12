/**
 * What each project's ISA still records about its own history. An ISC's
 * opening was never dated, so it cannot be backfilled; a close already
 * streamed live as a commitment is not logged twice.
 */

import { eventsSince } from "../../../hooks/lib/events";
import { readAllProjects } from "../../../hooks/lib/projects";
import {
  closedIscRows,
  decisionRows,
  emitHistoryRow,
  type HistoryRow,
  registrationRow,
} from "../project-history";
import { emitUnseen, recordedAttribution } from "./rows";

const commitmentKey = (fields: Record<string, unknown>) =>
  `${fields.iscProject}:${fields.isc}:${fields.outcome}`;

function liveCommitments(): Set<string> {
  return new Set(eventsSince("commitment", new Date(0)).map(commitmentKey));
}

function emitHistory(row: HistoryRow): void {
  emitHistoryRow(row, recordedAttribution(row));
}

/** Appends the project history not yet logged and returns how many events. */
export function backfillProjects(known: Set<string>, since?: string): number {
  const live = liveCommitments();
  const rows = readAllProjects()
    .flatMap((project) => [
      registrationRow(project),
      ...closedIscRows(project),
      ...decisionRows(project),
    ])
    .filter((row) => row.type !== "commitment" || !live.has(commitmentKey(row.fields)));
  return emitUnseen(rows, (row) => row.id, emitHistory, known, since);
}
