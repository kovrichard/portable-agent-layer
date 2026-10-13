/**
 * A project's history as events: its registration, its dated decisions, and
 * each ISC it closed or retired as the commitment kept or dropped. The live
 * commands and the backfill build the same rows, so both give one id.
 */

import type { RecordAttribution } from "../../hooks/lib/actor";
import { appendEvent } from "../../hooks/lib/events";
import type { ProjectProgress } from "../../hooks/lib/projects";
import { parseIscs } from "./project-isc";

export interface HistoryRow {
  id: string;
  ts: string;
  type: "project" | "commitment" | "decision";
  project: string;
  fields: Record<string, unknown>;
  content?: Record<string, unknown>;
}

const ARCHIVE_HEADING = /^### (Archived|Retired) (\d{4}-\d{2}-\d{2})$/;
const DECISION_LINE = /^- (\d{4}-\d{2}-\d{2}): (.+)$/;

const dayStart = (day: string) => `${day}T00:00:00.000Z`;

function shortHash(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 12);
}

export function registrationRow(
  project: Pick<ProjectProgress, "name" | "created" | "status">
): HistoryRow {
  return {
    id: `project:${project.name}:registered`,
    ts: project.created,
    type: "project",
    project: project.name,
    fields: { change: "registered", status: project.status },
  };
}

export function decisionRow(project: string, day: string, text: string): HistoryRow {
  return {
    id: `decision:${project}:${day}:${shortHash(text)}`,
    ts: dayStart(day),
    type: "decision",
    project,
    fields: { words: text.split(/\s+/).length },
    content: { text },
  };
}

export function decisionRows(project: ProjectProgress): HistoryRow[] {
  return (project.decisions ?? "").split("\n").flatMap((line) => {
    const decision = DECISION_LINE.exec(line);
    return decision ? [decisionRow(project.name, decision[1], decision[2])] : [];
  });
}

export function closedIscRows(project: ProjectProgress): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let heading: RegExpExecArray | null = null;
  for (const line of (project.changelog ?? "").split("\n")) {
    heading = ARCHIVE_HEADING.exec(line) ?? heading;
    const [isc] = parseIscs(line);
    if (!heading || !isc) continue;
    const outcome = heading[1] === "Retired" ? "dropped" : "kept";
    rows.push({
      id: `commitment:${project.name}:${isc.id}:${outcome}:${heading[2]}`,
      ts: dayStart(heading[2]),
      type: "commitment",
      project: project.name,
      fields: {
        iscProject: project.name,
        isc: isc.id,
        outcome,
        surface: null,
        snoozeDays: null,
      },
      content: { text: isc.text },
    });
  }
  return rows;
}

export function emitHistoryRow(
  row: HistoryRow,
  attribution: Partial<RecordAttribution> = {}
): string | null {
  return appendEvent(row.type, row.fields, {
    id: row.id,
    ts: row.ts,
    session: null,
    channel: null,
    cwd: "",
    project: row.project,
    attribution,
    ...(row.content && { content: row.content }),
  });
}
