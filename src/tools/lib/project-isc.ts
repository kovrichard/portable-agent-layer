/**
 * ISCs — the criteria a project is judged against, edited as the markdown lines
 * readProject renders them as.
 *
 * The tool that edits them is only ever spawned, so the archive bookkeeping was
 * reachable only by running the CLI. Each function here takes the text it
 * operates on, plus the clock it stamps with.
 */

import { type Isc, parseIscs } from "../../progress/isc-line";

/**
 * A full ISC line collapsed to a glanceable title for resume: cut at the first
 * clause boundary, then hard-cap length. Full text stays reachable via show-isc.
 */
export function iscTitle(text: string): string {
  const boundary = text.search(/; | — | \(|\. /);
  const clause = (boundary > 0 ? text.slice(0, boundary) : text).trim();

  return clause.length > 80 ? `${clause.slice(0, 79).trimEnd()}…` : clause;
}

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ID_LENGTH = 4;

/**
 * Four random characters, never all digits so a new id is never read as an old
 * number. Two machines opening ISCs between syncs cannot both pick the next
 * number this way. Scans Criteria AND Changelog so an archived id is never
 * handed out again.
 */
export function newIscId(
  criteria: string,
  changelog: string,
  random: () => number = Math.random
): string {
  const taken = new Set(
    [...parseIscs(criteria), ...parseIscs(changelog)].map((i) => i.id)
  );

  for (;;) {
    const id = Array.from(
      { length: ID_LENGTH },
      () => ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)]
    ).join("");

    if (!/^\d+$/.test(id) && !taken.has(id)) return id;
  }
}

export function removeIscLine(
  section: string,
  id: string
): { line: string | null; rest: string } {
  const lines = section.split("\n");
  const idx = lines.findIndex((l) =>
    new RegExp(String.raw`^-\s+\[[ x~]\]\s+ISC-${id}:`, "i").test(l)
  );
  if (idx === -1) return { line: null, rest: section };
  const [line] = lines.splice(idx, 1);

  return {
    line,
    rest: lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/**
 * Drops any "### Archived <date>" heading whose block has no content left —
 * e.g. after every ISC filed under that date has been reopened.
 */
export function dropEmptyArchiveHeadings(changelog: string): string {
  const lines = changelog.split("\n");
  const blockHasContent = (headingIdx: number): boolean => {
    for (let j = headingIdx + 1; j < lines.length && !lines[j].startsWith("### "); j++) {
      if (lines[j].trim() !== "") return true;
    }

    return false;
  };

  return lines
    .filter((l, i) => !(/^### Archived /.test(l) && !blockHasContent(i)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function archiveLine(
  changelog: string | undefined,
  doneLine: string,
  kind: "Archived" | "Retired" = "Archived",
  now: Date = new Date()
): string {
  const heading = `### ${kind} ${now.toISOString().slice(0, 10)}`;
  const base = (changelog ?? "").trim();
  if (base.includes(heading)) return `${base}\n${doneLine}`;

  return base ? `${base}\n\n${heading}\n${doneLine}` : `${heading}\n${doneLine}`;
}

export function selectIscs(
  open: Isc[],
  done: Isc[],
  retired: Isc[],
  flags: Set<string>
): Isc[] {
  if (flags.has("--all")) return [...open, ...done, ...retired];

  if (flags.has("--closed")) return done;

  if (flags.has("--retired")) return retired;

  return open;
}

export interface IscSections {
  criteria: string;
  changelog: string;
}

export type IscMove =
  | ({ ok: true; already: boolean } & IscSections)
  | { ok: false; reason: string };

/**
 * Closing an ISC moves its line out of Criteria and files it under a dated
 * archive heading in the Changelog. Reopening walks it back. Both are pure so
 * the CLI and the control room reach the same record through one rule.
 */
export function completeIsc(
  sections: IscSections,
  id: string,
  now: Date = new Date()
): IscMove {
  const kept = { criteria: sections.criteria, changelog: sections.changelog };

  if (parseIscs(sections.changelog).some((i) => i.id === id)) {
    return { ok: true, already: true, ...kept };
  }

  const { line, rest } = removeIscLine(sections.criteria, id);
  if (!line) return { ok: false, reason: `ISC-${id} not found` };

  return {
    ok: true,
    already: false,
    criteria: rest,
    changelog: archiveLine(
      sections.changelog,
      line.replace("[ ]", "[x]"),
      "Archived",
      now
    ),
  };
}

export function reopenIsc(sections: IscSections, id: string): IscMove {
  const kept = { criteria: sections.criteria, changelog: sections.changelog };

  if (parseIscs(sections.criteria).some((i) => i.id === id && i.status === "open")) {
    return { ok: true, already: true, ...kept };
  }

  let changelog = sections.changelog;
  let criteria = sections.criteria;
  let removed = removeIscLine(changelog, id);
  if (removed.line) changelog = dropEmptyArchiveHeadings(removed.rest);
  else {
    removed = removeIscLine(criteria, id);
    if (removed.line) criteria = removed.rest;
  }

  if (!removed.line) return { ok: false, reason: `ISC-${id} not found` };
  const openLine = removed.line.replace(/\[[x~]\]/i, "[ ]");

  return {
    ok: true,
    already: false,
    criteria: criteria ? `${criteria.trimEnd()}\n${openLine}` : openLine,
    changelog,
  };
}

/** A filesystem-safe stem for a task's own ISA, kept unique by the clock. */
export function taskSlug(title: string, now: number = Date.now()): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `${sanitized}-${now.toString(36)}`;
}
