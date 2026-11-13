import { logCommitment } from "../../hooks/lib/commitment-events";
import { type ProjectProgress, writeProject } from "../../hooks/lib/projects";
import { type Leaf, leaf, UsageError } from "../lib/command";
import {
  archiveLine,
  completeIsc,
  encodeIscText,
  ISC_BOX,
  type IscMove,
  type IscSections,
  nextIscId,
  parseIscs,
  removeIscLine,
  reopenIsc,
  selectIscs,
} from "../lib/project-isc";
import {
  fail,
  joined,
  nonBlank,
  now,
  ok,
  positiveId,
  requireProject,
} from "./project-io";

function cmdAddIsc(name: string, text: string): undefined {
  const title = nonBlank(text, "<title...>");
  const p = requireProject(name);
  const current = p.criteria ?? "";
  const id = nextIscId(current, p.changelog ?? "");
  const newLine = `- [ ] ISC-${id}: ${encodeIscText(title)}`;
  p.criteria = current ? `${current.trimEnd()}\n${newLine}` : newLine;
  p.updated = now();
  writeProject(p);
  logCommitment(name, id, "opened", "cli");
  ok({
    added: true,
    id,
    title,
    announce: `🎟️ ISC #${id} — ${title}`,
    reminder:
      "Surface the `announce` line to the user verbatim, on its own line. Every ISC you open MUST be announced with the 🎟️ ticket marker, in any response mode — omitting it is a defect.",
  });
}

// Completing an ISC moves its line out of Criteria and into the dated Changelog
// archive, so Criteria stays exactly the open set and never re-bloats context.
function cmdCompleteIsc(name: string, id: number): undefined {
  const p = requireProject(name);
  const move = completeIsc(sectionsOf(p), id);
  if (!move.ok) fail(`${move.reason} in project "${name}"`);

  if (move.already) {
    ok({ checked: true, id, alreadyDone: true });

    return;
  }

  applyIscMove(p, move);
  logCommitment(name, id, "kept", "cli");
  ok({ checked: true, id, archived: true });
}

function sectionsOf(p: ProjectProgress): IscSections {
  return { criteria: p.criteria ?? "", changelog: p.changelog ?? "" };
}

function applyIscMove(p: ProjectProgress, move: IscMove & { ok: true }): void {
  p.criteria = move.criteria;
  p.changelog = move.changelog;
  p.updated = now();
  writeProject(p);
}

// Reopening pulls the line back out of the Changelog (or legacy Criteria) into
// the open set.
function cmdReopenIsc(name: string, id: number): undefined {
  const p = requireProject(name);
  const move = reopenIsc(sectionsOf(p), id);
  if (!move.ok) fail(`${move.reason} in project "${name}"`);

  if (move.already) {
    ok({ checked: false, id, alreadyOpen: true });

    return;
  }

  applyIscMove(p, move);
  logCommitment(name, id, "reopened", "cli");
  ok({ checked: false, id });
}

interface IscListFlags {
  all?: boolean;
  closed?: boolean;
  retired?: boolean;
}

function iscListFlag(flags: IscListFlags): Set<string> {
  const chosen = Object.entries(flags)
    .filter(([, on]) => on)
    .map(([flag]) => `--${flag}`);
  if (chosen.length > 1) {
    throw new UsageError(`${chosen.join(" and ")} cannot be combined; pick one`);
  }

  return new Set(chosen);
}

function cmdListIsc(name: string, flags: Set<string>): undefined {
  const p = requireProject(name);
  const criteria = parseIscs(p.criteria ?? "");
  const all = [...criteria, ...parseIscs(p.changelog ?? "")];
  const open = all.filter((i) => i.status === "open");
  const done = all.filter((i) => i.status === "done");
  const retired = all.filter((i) => i.status === "retired");
  ok({
    name,
    total: open.length + done.length + retired.length,
    open: open.length,
    done: done.length,
    retired: retired.length,
    iscs: selectIscs(open, done, retired, flags),
  });
}

// show-isc prints one ISC's full text on demand — the "detail" counterpart to
// resume's titles. Scans Criteria (open + not-yet-archived) and Changelog.
function cmdShowIsc(name: string, id: number): undefined {
  const p = requireProject(name);
  const isc = [...parseIscs(p.criteria ?? ""), ...parseIscs(p.changelog ?? "")].find(
    (i) => i.id === id
  );
  if (!isc) fail(`ISC-${id} not found in project "${name}".`);
  ok({ name, id: isc.id, status: isc.status, text: isc.text });
}

// A retired ISC stopped being valid; it moves to the Changelog as [~], so it keeps
// reserving its id and never reads as finished work.
function cmdRetireIsc(name: string, id: number, by: number | null): undefined {
  const p = requireProject(name);
  if (parseIscs(p.changelog ?? "").some((i) => i.id === id && i.status === "retired")) {
    ok({ retired: true, id, alreadyRetired: true });

    return;
  }

  const { line, rest } = removeIscLine(p.criteria ?? "", id);
  if (!line) fail(`ISC-${id} not found in project "${name}"`);
  const suffix = by ? ` (superseded by ISC-${by})` : "";
  p.criteria = rest;
  p.changelog = archiveLine(
    p.changelog,
    `${line.replace(/\[[ x]\]/i, "[~]")}${suffix}`,
    "Retired"
  );
  p.updated = now();
  writeProject(p);
  logCommitment(name, id, "dropped", "cli");
  ok({ retired: true, id, supersededBy: by, archived: true });
}

// Returns the previous text, because the ISA files keep no version history.
function cmdEditIsc(name: string, id: number, newText: string): undefined {
  const text = nonBlank(newText, "<text...>");
  const p = requireProject(name);
  const inCriteria = parseIscs(p.criteria ?? "").find((i) => i.id === id);
  const isc = inCriteria ?? parseIscs(p.changelog ?? "").find((i) => i.id === id);
  if (!isc) fail(`ISC-${id} not found in project "${name}".`);

  const box = ISC_BOX[isc.status];
  const rewrite = (section: string) =>
    section
      .split("\n")
      .map((l) =>
        new RegExp(String.raw`^-\s+\[[ x~]\]\s+ISC-${id}:`, "i").test(l)
          ? `- ${box} ISC-${id}: ${encodeIscText(text)}`
          : l
      )
      .join("\n");

  if (inCriteria) p.criteria = rewrite(p.criteria ?? "");
  else p.changelog = rewrite(p.changelog ?? "");
  p.updated = now();
  writeProject(p);
  ok({
    edited: true,
    id,
    status: isc.status,
    previous: isc.text,
    text,
  });
}

// Backfill: sweep any done ISCs still sitting in Criteria (legacy projects, or
// completions from before archive-on-complete) into the Changelog in one pass.
function cmdPruneIsc(name: string): undefined {
  const p = requireProject(name);
  const done = parseIscs(p.criteria ?? "").filter((i) => i.status !== "open");

  for (const isc of done) {
    const { line, rest } = removeIscLine(p.criteria ?? "", isc.id);
    if (!line) continue;
    p.criteria = rest;
    p.changelog = archiveLine(p.changelog, line);
  }

  if (done.length > 0) {
    p.updated = now();
    writeProject(p);
  }

  const openLeft = parseIscs(p.criteria ?? "").filter((i) => i.status === "open").length;
  ok({ pruned: done.length, name, remaining_open: openLeft });
}

function iscLeaf(summary: string, act: (name: string, id: number) => undefined): Leaf {
  return leaf({
    summary,
    args: "<name> <id>",
    run: ({ positionals }) => act(positionals[0], positiveId(positionals[1], "<id>")),
  });
}

export const iscCommands = {
  "add-isc": leaf({
    summary: "Append a new open ISC to Criteria",
    args: "<name> <title...>",
    run: ({ positionals }) => cmdAddIsc(positionals[0], joined(positionals.slice(1))),
  }),
  "complete-isc": iscLeaf("Mark ISC-N as done", cmdCompleteIsc),
  "reopen-isc": iscLeaf("Reopen ISC-N (mark not done)", cmdReopenIsc),
  "list-isc": leaf({
    summary: "List open ISCs (default), or the closed or retired ones",
    args: "<name>",
    options: {
      all: { type: "boolean", description: "Open, done and retired" },
      closed: { type: "boolean", description: "Done only" },
      retired: { type: "boolean", description: "Retired only" },
    },
    run: ({ positionals, values }) => cmdListIsc(positionals[0], iscListFlag(values)),
  }),
  "show-isc": iscLeaf("Print one ISC's full text", cmdShowIsc),
  "edit-isc": leaf({
    summary: "Rewrite ISC-N's text, keeping its id and state",
    args: "<name> <id> <text...>",
    run: ({ positionals: [name, id, ...text] }) =>
      cmdEditIsc(name, positiveId(id, "<id>"), joined(text)),
  }),
  "retire-isc": leaf({
    summary: "Close ISC-N as no longer valid, not as done",
    args: "<name> <id>",
    options: {
      by: { type: "string", value: "<id>", description: "The ISC that supersedes it" },
    },
    run: ({ positionals: [name, id], values }) =>
      cmdRetireIsc(
        name,
        positiveId(id, "<id>"),
        values.by === undefined ? null : positiveId(values.by, "--by")
      ),
  }),
  "prune-isc": leaf({
    summary: "Archive done ISCs from Criteria into the Changelog",
    args: "<name>",
    run: ({ positionals }) => cmdPruneIsc(positionals[0]),
  }),
};
