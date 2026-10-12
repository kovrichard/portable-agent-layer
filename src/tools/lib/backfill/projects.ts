/**
 * What each project's ISA still records about its own history: when it was
 * registered, the day each ISC was closed or retired, and its dated decisions.
 * An ISC's opening was never dated, so it cannot be backfilled.
 */

import { appendEvent } from "../../../hooks/lib/events";
import { type ProjectProgress, readAllProjects } from "../../../hooks/lib/projects";
import { parseIscs } from "../project-isc";
import { emitUnseen, recordedAttribution } from "./rows";

interface HistoryRow {
  id: string;
  ts: string;
  type: "project" | "isc" | "decision";
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

function registration(project: ProjectProgress): HistoryRow {
  return {
    id: `project:${project.name}:registered`,
    ts: project.created,
    type: "project",
    project: project.name,
    fields: { change: "registered", status: project.status },
  };
}

function closedIscs(project: ProjectProgress): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let heading: RegExpExecArray | null = null;
  for (const line of (project.changelog ?? "").split("\n")) {
    heading = ARCHIVE_HEADING.exec(line) ?? heading;
    const [isc] = parseIscs(line);
    if (!heading || !isc) continue;
    const change = heading[1] === "Retired" ? "retired" : "done";
    rows.push({
      id: `isc:${project.name}:${isc.id}:${change}:${heading[2]}`,
      ts: dayStart(heading[2]),
      type: "isc",
      project: project.name,
      fields: { isc: isc.id, change },
      content: { text: isc.text },
    });
  }
  return rows;
}

function decisions(project: ProjectProgress): HistoryRow[] {
  return (project.decisions ?? "").split("\n").flatMap((line) => {
    const decision = DECISION_LINE.exec(line);
    if (!decision) return [];
    const [, day, text] = decision;
    return [
      {
        id: `decision:${project.name}:${day}:${shortHash(text)}`,
        ts: dayStart(day),
        type: "decision" as const,
        project: project.name,
        fields: { words: text.split(/\s+/).length },
        content: { text },
      },
    ];
  });
}

function emitHistory(row: HistoryRow, id: string): void {
  appendEvent(row.type, row.fields, {
    id,
    ts: row.ts,
    session: null,
    channel: null,
    cwd: "",
    project: row.project,
    attribution: recordedAttribution(row),
    ...(row.content && { content: row.content }),
  });
}

/** Appends the project history not yet logged and returns how many events. */
export function backfillProjects(known: Set<string>, since?: string): number {
  const rows = readAllProjects().flatMap((project) => [
    registration(project),
    ...closedIscs(project),
    ...decisions(project),
  ]);
  return emitUnseen(rows, (row) => row.id, emitHistory, known, since);
}
