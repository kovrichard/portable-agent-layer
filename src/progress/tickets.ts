/**
 * A project's ISCs as an append-only log, `<slug>/tickets.jsonl`. ISA.md is one
 * file that every machine rewrites whole, so two machines closing tickets
 * between syncs would collide in it; lines in a log merge instead.
 *
 * Each line is one ticket's full state after a change. Replay keeps the newest
 * line per ticket, ordered by `at` and then by the line itself, never by its
 * position: a synced line lands wherever it arrives.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ISC_BOX,
  type Isc,
  type IscStatus,
  iscLine,
  isIscLine,
  parseIscs,
} from "./isc-line";

export interface TicketState {
  /** Absent on an imported line, so any later change outranks it. */
  at?: string;
  ticket: string;
  status: IscStatus;
  text: string;
  /** When it last opened or closed: its place in Criteria, its archive date. */
  since?: string;
  /** The number it had before ids were random. */
  was?: string;
}

export interface TicketSections {
  criteria: string;
  changelog: string;
}

export function serializeTicket(state: TicketState): string {
  const { at, ticket, status, text, since, was } = state;

  return JSON.stringify({ at, ticket, status, text, since, was });
}

function parseTicketLine(line: string): TicketState | null {
  try {
    const state = JSON.parse(line) as TicketState;
    const valid =
      typeof state.ticket === "string" &&
      typeof state.text === "string" &&
      Object.hasOwn(ISC_BOX, state.status);

    return valid ? state : null;
  } catch {
    return null;
  }
}

interface LoggedState {
  state: TicketState;
  line: string;
}

function outranks(a: LoggedState, b: LoggedState): boolean {
  const atA = a.state.at ?? "";
  const atB = b.state.at ?? "";

  return atA === atB ? a.line > b.line : atA > atB;
}

const ARCHIVE_HEADING = /^### (Archived|Retired) (\d{4}-\d{2}-\d{2})\s*$/;

/** The date heading each archived ticket line sits under. */
function archiveDates(changelog: string): Map<string, string> {
  const dates = new Map<string, string>();
  let date: string | undefined;

  for (const line of changelog.split("\n")) {
    date = ARCHIVE_HEADING.exec(line)?.[2] ?? date;
    const [isc] = parseIscs(line);
    if (isc && date) dates.set(isc.id, date);
  }

  return dates;
}

export function replayTickets(log: string): TicketState[] {
  const newest = new Map<string, LoggedState>();

  for (const line of log.split("\n")) {
    const state = parseTicketLine(line);
    if (!state) continue;
    const held = newest.get(state.ticket);
    if (!held || outranks({ state, line }, held))
      newest.set(state.ticket, { state, line });
  }

  return [...newest.values()].map((logged) => logged.state);
}

function readTicketLog(file: string): TicketState[] | null {
  return existsSync(file) ? replayTickets(readFileSync(file, "utf-8")) : null;
}

function appendTicketStates(file: string, states: TicketState[]): void {
  if (states.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, states.map((s) => `${serializeTicket(s)}\n`).join(""));
}

function oldNumber(state: TicketState): number {
  return state.was === undefined ? Number.POSITIVE_INFINITY : Number(state.was);
}

function byPlace(a: TicketState, b: TicketState): number {
  const since = (a.since ?? "").localeCompare(b.since ?? "");
  if (since !== 0) return since;
  const number = oldNumber(a) - oldNumber(b);
  if (number !== 0 && !Number.isNaN(number)) return number;

  return a.ticket.localeCompare(b.ticket);
}

const lineOf = (state: TicketState) =>
  iscLine({ id: state.ticket, text: state.text, status: state.status });

function archiveBlocks(closed: TicketState[]): string {
  const blocks = new Map<string, string[]>();

  for (const state of closed) {
    const kind = state.status === "retired" ? "Retired" : "Archived";
    const heading = `### ${kind} ${(state.since ?? "").slice(0, 10)}`;
    blocks.set(heading, [...(blocks.get(heading) ?? []), lineOf(state)]);
  }

  return [...blocks]
    .map(([heading, lines]) => [heading, ...lines].join("\n"))
    .join("\n\n");
}

const joinParts = (...parts: string[]) => parts.filter(Boolean).join("\n\n");

/** Criteria and Changelog as they read: the ISA's own text, then the tickets. */
export function renderTickets(
  tickets: TicketState[],
  rest: TicketSections
): TicketSections {
  const placed = [...tickets].sort(byPlace);
  const open = placed.filter((t) => t.status === "open").map(lineOf);

  return {
    criteria: joinParts(rest.criteria, open.join("\n")),
    changelog: joinParts(
      rest.changelog,
      archiveBlocks(placed.filter((t) => t.status !== "open"))
    ),
  };
}

/** A section with its ticket lines and archive headings taken out. */
export function withoutTickets(section: string): string {
  return section
    .split("\n")
    .filter((line) => !isIscLine(line) && !ARCHIVE_HEADING.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasTicketLines(sections: TicketSections): boolean {
  return [sections.criteria, sections.changelog].some((s) =>
    s.split("\n").some(isIscLine)
  );
}

/** A clock that never repeats or goes back for one ticket, so its newest change wins. */
function stampAfter(previous: string | undefined, now: Date): string {
  if (!previous || now.toISOString() > previous) return now.toISOString();

  return new Date(Date.parse(previous) + 1).toISOString();
}

/**
 * A ticket that keeps its status keeps its place. One new to the log keeps the
 * date of the archive heading it was written under; any other move is now.
 */
function sinceFor(
  before: TicketState | undefined,
  isc: Isc,
  at: string,
  archivedOn: string | undefined
): string | undefined {
  if (before) return before.status === isc.status ? before.since : at;

  return isc.status === "open" ? at : (archivedOn ?? at);
}

/**
 * The states to append so the log reads as the given sections. A ticket the
 * sections leave out is left as it is: tickets close or retire, never vanish.
 */
export function ticketChanges(
  current: TicketState[],
  sections: TicketSections,
  now: Date
): TicketState[] {
  const held = new Map(current.map((t) => [t.ticket, t]));
  const archivedOn = archiveDates(sections.changelog);
  const seen = new Set<string>();
  const changes: TicketState[] = [];

  for (const isc of [...parseIscs(sections.criteria), ...parseIscs(sections.changelog)]) {
    if (seen.has(isc.id)) continue;
    seen.add(isc.id);
    const before = held.get(isc.id);
    if (before?.status === isc.status && before.text === isc.text) continue;
    const at = stampAfter(before?.at, now);
    const since = sinceFor(before, isc, at, archivedOn.get(isc.id));
    changes.push({
      at,
      ticket: isc.id,
      status: isc.status,
      text: isc.text,
      since,
      was: before?.was,
    });
  }

  return changes;
}

const ticketLogIn = (projectDir: string) => resolve(projectDir, "tickets.jsonl");

/** The sections as read, tickets rendered in; null while the project has no log. */
export function readTicketSections(
  projectDir: string,
  stored: TicketSections
): TicketSections | null {
  const tickets = readTicketLog(ticketLogIn(projectDir));
  if (!tickets) return null;

  return renderTickets(tickets, {
    criteria: withoutTickets(stored.criteria),
    changelog: withoutTickets(stored.changelog),
  });
}

/**
 * Appends what changed in the tickets and returns the sections ISA.md keeps.
 * Null for a project with no log whose ISA.md still holds ticket lines: those
 * stay in ISA.md until it is migrated.
 */
export function writeTicketSections(
  projectDir: string,
  sections: TicketSections,
  storedHasTickets: () => boolean,
  now: Date = new Date()
): TicketSections | null {
  const file = ticketLogIn(projectDir);
  const current = readTicketLog(file);
  if (!current && storedHasTickets()) return null;
  appendTicketStates(file, ticketChanges(current ?? [], sections, now));

  return {
    criteria: withoutTickets(sections.criteria),
    changelog: withoutTickets(sections.changelog),
  };
}
