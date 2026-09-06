/**
 * ISCs — the numbered criteria a project is judged against, stored as markdown
 * lines inside a project's ISA.md.
 *
 * The tool that edits them is only ever spawned, so the line format, the
 * escaping that keeps a multi-paragraph criterion on one line, and the archive
 * bookkeeping were reachable only by running the CLI. Each function here takes
 * the text it operates on, plus the clock it stamps with.
 */

export type IscStatus = "open" | "done" | "retired";

export const ISC_BOX: Record<IscStatus, string> = {
  open: "[ ]",
  done: "[x]",
  retired: "[~]",
};

export function statusFromBox(box: string): IscStatus {
  if (box.toLowerCase() === "x") return "done";
  if (box === "~") return "retired";
  return "open";
}

export interface Isc {
  id: number;
  text: string;
  status: IscStatus;
}

/**
 * An ISC is one markdown line, so a newline in its text would end the record
 * and strand every paragraph after it as unparseable debris. Backslashes are
 * escaped first so that decoding a literal "\n" in a regex cannot be mistaken
 * for the separator.
 */
export function encodeIscText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\\n");
}

const ISC_UNESCAPE: Record<string, string> = { n: "\n", "\\": "\\" };

export function decodeIscText(stored: string): string {
  return stored.replaceAll(/\\(.)/g, (whole, ch) => ISC_UNESCAPE[ch] ?? whole);
}

export function parseIscs(criteria: string): Isc[] {
  const out: Isc[] = [];
  for (const line of criteria.split("\n")) {
    const m = new RegExp(/^-\s+\[( |x|~)\]\s+ISC-(\d+):\s+(.+)$/i).exec(line);
    if (m)
      out.push({
        id: Number(m[2]),
        text: decodeIscText(m[3].trim()),
        status: statusFromBox(m[1]),
      });
  }
  return out;
}

/**
 * A full ISC line collapsed to a glanceable title for resume: cut at the first
 * clause boundary, then hard-cap length. Full text stays reachable via show-isc.
 */
export function iscTitle(text: string): string {
  const boundary = text.search(/; | — | \(|\. /);
  const clause = (boundary > 0 ? text.slice(0, boundary) : text).trim();
  return clause.length > 80 ? `${clause.slice(0, 79).trimEnd()}…` : clause;
}

/** Scans Criteria AND Changelog so an archived id can never be handed out again. */
export function nextIscId(criteria: string, changelog: string): number {
  const ids = [...parseIscs(criteria), ...parseIscs(changelog)].map((i) => i.id);
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

export function removeIscLine(
  section: string,
  id: number
): { line: string | null; rest: string } {
  const lines = section.split("\n");
  const idx = lines.findIndex((l) =>
    new RegExp(String.raw`^-\s+\[[ x~]\]\s+ISC-${id}:`).test(l)
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
  id: number,
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

export function reopenIsc(sections: IscSections, id: number): IscMove {
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
