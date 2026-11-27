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
  allDigits,
  ID_ALPHABET,
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

const STATUS_RANK: Record<IscStatus, number> = { open: 0, done: 1, retired: 2 };

/**
 * Newer wins. Imported lines carry no time, so one ticket imported open on one
 * machine and closed on another ties; the close is the later act, so it wins.
 */
function outranks(a: LoggedState, b: LoggedState): boolean {
  const atA = a.state.at ?? "";
  const atB = b.state.at ?? "";
  if (atA !== atB) return atA > atB;
  const rank = STATUS_RANK[a.state.status] - STATUS_RANK[b.state.status];

  return rank === 0 ? a.line > b.line : rank > 0;
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

const readLog = (file: string) => (existsSync(file) ? readFileSync(file, "utf-8") : "");

function appendLines(file: string, lines: string[]): void {
  if (lines.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((line) => `${line}\n`).join(""));
}

const IMPORTED_ID_LENGTH = 6;

/**
 * The same id on every machine for the same old ticket. An old number names
 * different tasks on different machines, so the text goes into the hash too.
 * Six characters, against four for a new ticket, so that hundreds of imported
 * tickets in one project are still very unlikely to share one.
 */
export function importedTicketId(project: string, was: string, text: string): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update(`${project}\n${was}\n${text}`)
    .digest();
  const chars = Array.from(digest, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join(
    ""
  );
  const windows = Array.from({ length: chars.length - IMPORTED_ID_LENGTH + 1 }, (_, i) =>
    chars.slice(i, i + IMPORTED_ID_LENGTH)
  );

  return windows.find((id) => !allDigits(id)) ?? `x${chars.slice(1, IMPORTED_ID_LENGTH)}`;
}

export interface TicketOwner {
  name: string;
  /** Dates a closed ticket that sat in Criteria with no archive heading. */
  created: string;
}

/**
 * The ticket lines an ISA.md still holds, as the states they import as. No
 * time and no machine goes in, so two machines importing one ticket write the
 * same line, and the sync keeps one.
 */
function importedStates(owner: TicketOwner, stored: TicketSections): TicketState[] {
  const archivedOn = archiveDates(stored.changelog);

  return [...parseIscs(stored.criteria), ...parseIscs(stored.changelog)].map((isc) => {
    const numbered = allDigits(isc.id);
    const closedOn = archivedOn.get(isc.id) ?? owner.created.slice(0, 10);

    return {
      ticket: numbered ? importedTicketId(owner.name, isc.id, isc.text) : isc.id,
      status: isc.status,
      text: isc.text,
      since: isc.status === "open" ? undefined : closedOn,
      was: numbered ? isc.id : undefined,
    };
  });
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

export const ticketLogIn = (projectDir: string) => resolve(projectDir, "tickets.jsonl");

const stripped = (sections: TicketSections): TicketSections => ({
  criteria: withoutTickets(sections.criteria),
  changelog: withoutTickets(sections.changelog),
});

/** Import lines the log does not hold yet, for ticket lines ISA.md still has. */
export function pendingImports(
  log: string,
  owner: TicketOwner,
  stored: TicketSections
): string[] {
  const logged = new Set(log.split("\n"));

  return [...new Set(importedStates(owner, stored).map(serializeTicket))].filter(
    (line) => !logged.has(line)
  );
}

/** Each old number to the tickets that carry it now; two means it named two tasks. */
function oldNumbersOf(tickets: TicketState[]): Record<string, string[]> {
  const numbers: Record<string, string[]> = {};

  for (const { was, ticket } of tickets)
    if (was) numbers[was] = [...(numbers[was] ?? []), ticket];

  return numbers;
}

export interface TicketView {
  sections: TicketSections;
  oldNumbers: Record<string, string[]>;
}

/** The sections as read: the log, plus any ticket line ISA.md still holds. */
export function readTicketSections(
  projectDir: string,
  owner: TicketOwner,
  stored: TicketSections
): TicketView {
  const log = readLog(ticketLogIn(projectDir));
  const tickets = replayTickets([log, ...pendingImports(log, owner, stored)].join("\n"));

  return {
    sections: renderTickets(tickets, stripped(stored)),
    oldNumbers: oldNumbersOf(tickets),
  };
}

/** Appends the imports and the changes, and returns the sections ISA.md keeps. */
export function writeTicketSections(
  projectDir: string,
  owner: TicketOwner,
  sections: TicketSections,
  stored: () => TicketSections,
  now: Date = new Date()
): TicketSections {
  const file = ticketLogIn(projectDir);
  const log = readLog(file);
  const imports = pendingImports(log, owner, stored());
  const current = replayTickets([log, ...imports].join("\n"));
  const changes = ticketChanges(current, sections, now).map(serializeTicket);
  appendLines(file, [...imports, ...changes]);

  return stripped(sections);
}
