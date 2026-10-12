import type { RecordAttribution } from "../../../hooks/lib/actor";

export type AttributedRow = Partial<RecordAttribution> & { ts: string };

/** The origin a row was written with; a field it never carried is unknown, not this machine's. */
export function recordedAttribution(row: AttributedRow): Partial<RecordAttribution> {
  return {
    machine: row.machine ?? "unknown",
    actor: row.actor ?? "unknown",
    runtime: row.runtime ?? "unknown",
    ...(row.authority && { authority: row.authority }),
  };
}

/** Emits each row whose id is not logged yet and that falls on or after `since`; returns how many. */
export function emitUnseen<Row extends AttributedRow>(
  rows: Row[],
  idOf: (row: Row) => string,
  emit: (row: Row, id: string) => void,
  known: Set<string>,
  since?: string
): number {
  const from = new Date(since ?? 0).toISOString();
  let emitted = 0;
  for (const row of rows) {
    const id = idOf(row);
    if (known.has(id) || row.ts < from) continue;
    known.add(id);
    emit(row, id);
    emitted++;
  }
  return emitted;
}
