/**
 * Every entity in the knowledge store, first seen when it was created. The
 * live event shares its id, so an entity already logged is skipped.
 */

import { entityEventId, logEntityFirstSeen } from "../../../hooks/lib/entity-events";
import { type Entity, list, seenEntity } from "../../knowledge/lib";
import { emitUnseen } from "./rows";

interface EntityRow {
  entity: Entity;
  ts: string;
}

function emitEntity(row: EntityRow): void {
  logEntityFirstSeen(seenEntity(row.entity), {
    ts: row.ts,
    session: null,
    channel: null,
    cwd: "",
    attribution: { machine: "unknown", actor: "unknown", runtime: "unknown" },
  });
}

/** Appends the entities not yet logged and returns how many. */
export function backfillEntities(known: Set<string>, since?: string): number {
  const rows = list()
    .filter((entity) => entity.frontmatter.created)
    .map((entity) => ({ entity, ts: entity.frontmatter.created }));
  return emitUnseen(rows, (row) => entityEventId(row.entity), emitEntity, known, since);
}
