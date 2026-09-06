import { describe, expect, test } from "bun:test";
import {
  archiveLine,
  decodeIscText,
  dropEmptyArchiveHeadings,
  encodeIscText,
  ISC_BOX,
  type Isc,
  iscTitle,
  nextIscId,
  parseIscs,
  removeIscLine,
  selectIscs,
  statusFromBox,
  taskSlug,
} from "../src/tools/lib/project-isc";

const NOW = new Date("2026-09-06T12:00:00.000Z");

function isc(id: number, text: string, status: Isc["status"] = "open"): Isc {
  return { id, text, status };
}

function line(id: number, text: string, status: Isc["status"] = "open"): string {
  return `- ${ISC_BOX[status]} ISC-${id}: ${text}`;
}

describe("statusFromBox", () => {
  test("reads each box character", () => {
    expect(statusFromBox(" ")).toBe("open");
    expect(statusFromBox("x")).toBe("done");
    expect(statusFromBox("~")).toBe("retired");
  });

  // The parser matches case-insensitively, so an [X] must read as done too.
  test("an uppercase X is still done", () => {
    expect(statusFromBox("X")).toBe("done");
  });

  test("anything unrecognised is open rather than an error", () => {
    expect(statusFromBox("?")).toBe("open");
    expect(statusFromBox("")).toBe("open");
  });
});

describe("ISC_BOX", () => {
  test("every status has a distinct box", () => {
    expect(new Set(Object.values(ISC_BOX)).size).toBe(3);
    expect(ISC_BOX.open).toBe("[ ]");
    expect(ISC_BOX.done).toBe("[x]");
    expect(ISC_BOX.retired).toBe("[~]");
  });
});

describe("encodeIscText / decodeIscText", () => {
  test("text with no newline is unchanged", () => {
    expect(encodeIscText("a plain criterion")).toBe("a plain criterion");
  });

  // A newline would end the markdown line and strand the rest as debris.
  test("a newline is escaped so the record stays on one line", () => {
    expect(encodeIscText("first\nsecond")).toBe("first\\nsecond");
    expect(encodeIscText("first\nsecond")).not.toContain("\n");
  });

  test("both CRLF and a bare CR become the same escape", () => {
    expect(encodeIscText("a\r\nb")).toBe("a\\nb");
    expect(encodeIscText("a\rb")).toBe("a\\nb");
  });

  // Escaping backslashes first is what keeps a literal \n in the text from
  // decoding as a newline it never was.
  test("a literal backslash-n survives a round trip as itself", () => {
    const original = String.raw`match \n exactly`;
    expect(decodeIscText(encodeIscText(original))).toBe(original);
  });

  test("round-trips text holding newlines and backslashes together", () => {
    const original = "line one\\\nline two\\n still line two";
    expect(decodeIscText(encodeIscText(original))).toBe(original);
  });

  test("an unknown escape is left as written", () => {
    expect(decodeIscText(String.raw`a \t b`)).toBe(String.raw`a \t b`);
  });

  test("decoding text with no escapes changes nothing", () => {
    expect(decodeIscText("plain")).toBe("plain");
  });
});

describe("parseIscs", () => {
  test("reads id, text and status from each line", () => {
    const criteria = [line(1, "first"), line(2, "second", "done")].join("\n");
    expect(parseIscs(criteria)).toEqual([isc(1, "first"), isc(2, "second", "done")]);
  });

  test("reads a retired line", () => {
    expect(parseIscs(line(3, "gone", "retired"))).toEqual([isc(3, "gone", "retired")]);
  });

  test("ignores prose and other list items", () => {
    const criteria = ["## Criteria", "", "- a plain bullet", line(1, "real")].join("\n");
    expect(parseIscs(criteria)).toEqual([isc(1, "real")]);
  });

  test("an empty section has no ISCs", () => {
    expect(parseIscs("")).toEqual([]);
  });

  // The stored form is escaped; what a caller gets back is the real text.
  test("decodes the stored text", () => {
    expect(parseIscs(line(1, "first\\nsecond"))[0].text).toBe("first\nsecond");
  });

  test("an uppercase done box parses as done", () => {
    expect(parseIscs("- [X] ISC-4: done")[0].status).toBe("done");
  });

  test("a multi-digit id is read whole", () => {
    expect(parseIscs(line(123, "big"))[0].id).toBe(123);
  });

  // The line must start with the marker, or a quoted example becomes a record.
  test("an indented or quoted line is not an ISC", () => {
    expect(parseIscs(`  ${line(1, "indented")}`)).toEqual([]);
    expect(parseIscs(`> ${line(1, "quoted")}`)).toEqual([]);
  });

  // Markdown tolerates extra spacing between the parts of a list item.
  test("extra spacing anywhere in the line still parses", () => {
    expect(parseIscs("-  [ ]  ISC-1:  spaced out")).toEqual([isc(1, "spaced out")]);
  });

  test("trailing whitespace is not part of the text", () => {
    expect(parseIscs(`${line(1, "text")}   `)[0].text).toBe("text");
  });
});

describe("iscTitle", () => {
  test("short text is its own title", () => {
    expect(iscTitle("a short criterion")).toBe("a short criterion");
  });

  test("cuts at the first clause boundary", () => {
    expect(iscTitle("the point; the elaboration")).toBe("the point");
    expect(iscTitle("the point — the elaboration")).toBe("the point");
    expect(iscTitle("the point (the aside)")).toBe("the point");
    expect(iscTitle("the point. the next sentence")).toBe("the point");
  });

  // Cutting at a boundary in position zero would leave an empty title.
  test("text that opens on a boundary keeps its whole title", () => {
    expect(iscTitle("; opens with a semicolon")).toBe("; opens with a semicolon");
    expect(iscTitle("(parenthetical) then more")).toBe("(parenthetical) then more");
  });

  test("surrounding whitespace is trimmed off the title", () => {
    expect(iscTitle("   padded   ")).toBe("padded");
  });

  // The ellipsis replaces the cut, so it must not sit after a stranded space.
  test("the truncated title has no space before its ellipsis", () => {
    expect(iscTitle(`${"w".repeat(78)} tail is long enough to cut`)).toBe(
      `${"w".repeat(78)}…`
    );
  });

  test("caps long text with an ellipsis", () => {
    const title = iscTitle("w".repeat(200));
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
  });

  test("text of exactly the cap is not truncated", () => {
    const exact = "w".repeat(80);
    expect(iscTitle(exact)).toBe(exact);
  });

  test("one character over the cap is truncated", () => {
    expect(iscTitle("w".repeat(81)).endsWith("…")).toBe(true);
  });
});

describe("nextIscId", () => {
  test("the first ISC of a project is 1", () => {
    expect(nextIscId("", "")).toBe(1);
  });

  test("continues from the highest open id", () => {
    expect(nextIscId([line(1, "a"), line(2, "b")].join("\n"), "")).toBe(3);
  });

  // An archived id must never be handed out again, so the changelog counts.
  test("counts archived ids in the changelog too", () => {
    expect(nextIscId(line(1, "a"), line(7, "archived", "done"))).toBe(8);
  });

  test("takes the highest id, not the last one written", () => {
    expect(nextIscId([line(9, "a"), line(2, "b")].join("\n"), "")).toBe(10);
  });
});

describe("removeIscLine", () => {
  const section = [line(1, "first"), line(2, "second"), line(3, "third")].join("\n");

  test("returns the removed line and the section without it", () => {
    const { line: removed, rest } = removeIscLine(section, 2);
    expect(removed).toBe(line(2, "second"));
    expect(rest).toBe([line(1, "first"), line(3, "third")].join("\n"));
  });

  // Nothing to remove must leave the section byte-for-byte as it was.
  test("an unknown id changes nothing", () => {
    expect(removeIscLine(section, 99)).toEqual({ line: null, rest: section });
  });

  test("removes a line of any status", () => {
    const mixed = [line(1, "a", "done"), line(2, "b", "retired")].join("\n");
    expect(removeIscLine(mixed, 2).line).toBe(line(2, "b", "retired"));
  });

  test("does not match an id that merely starts the same", () => {
    const both = [line(1, "one"), line(12, "twelve")].join("\n");
    expect(removeIscLine(both, 1).line).toBe(line(1, "one"));
  });

  // The gap closes to one blank line rather than vanishing entirely.
  test("collapses a run of blank lines the removal left behind", () => {
    const spaced = [line(1, "a"), "", "", line(2, "b"), line(3, "c")].join("\n");
    expect(removeIscLine(spaced, 2).rest).toBe(
      [line(1, "a"), "", line(3, "c")].join("\n")
    );
  });

  test("trims the blank lines a removal left at the edges", () => {
    const spaced = [line(1, "a"), "", "", line(2, "b")].join("\n");
    expect(removeIscLine(spaced, 1).rest).toBe(line(2, "b"));
  });
});

describe("dropEmptyArchiveHeadings", () => {
  test("keeps a heading that still has entries under it", () => {
    const log = ["### Archived 2026-01-01", line(1, "a", "done")].join("\n");
    expect(dropEmptyArchiveHeadings(log)).toBe(log);
  });

  test("drops a heading with nothing left under it", () => {
    const log = [
      "### Archived 2026-01-01",
      "",
      "### Archived 2026-02-01",
      line(1, "a"),
    ].join("\n");
    expect(dropEmptyArchiveHeadings(log)).toBe(
      ["### Archived 2026-02-01", line(1, "a")].join("\n")
    );
  });

  test("a heading at the end of the log with no entries is dropped", () => {
    expect(dropEmptyArchiveHeadings("### Archived 2026-01-01")).toBe("");
  });

  // Only archive headings are pruned; other sections are the caller's content.
  test("leaves a non-archive heading alone even when empty", () => {
    expect(dropEmptyArchiveHeadings("### Notes")).toBe("### Notes");
  });

  test("a line merely mentioning an archive heading is not one", () => {
    expect(dropEmptyArchiveHeadings("> ### Archived 2026-01-01")).toBe(
      "> ### Archived 2026-01-01"
    );
  });

  // The search for content runs forward to the next heading, so an entry that
  // is not the first line under the heading still counts.
  test("finds content that is not the first line under the heading", () => {
    const log = ["### Archived 2026-01-01", "", line(1, "a", "done")].join("\n");
    expect(dropEmptyArchiveHeadings(log)).toBe(log);
  });

  test("a block of only whitespace counts as empty", () => {
    expect(dropEmptyArchiveHeadings("### Archived 2026-01-01\n   \n  ")).toBe("");
  });

  // Blank runs between surviving blocks close to one line, not to nothing.
  test("collapses a run of blank lines between two kept blocks", () => {
    const log = [
      "### Archived 2026-01-01",
      line(1, "a", "done"),
      "",
      "",
      "",
      "### Archived 2026-02-01",
      line(2, "b", "done"),
    ].join("\n");
    expect(dropEmptyArchiveHeadings(log)).toBe(
      [
        "### Archived 2026-01-01",
        line(1, "a", "done"),
        "",
        "### Archived 2026-02-01",
        line(2, "b", "done"),
      ].join("\n")
    );
  });

  test("drops every empty heading, not just the first", () => {
    const log = ["### Archived 2026-01-01", "", "### Archived 2026-02-01", ""].join("\n");
    expect(dropEmptyArchiveHeadings(log)).toBe("");
  });
});

describe("archiveLine", () => {
  const done = line(1, "a", "done");

  test("starts a changelog with a dated heading", () => {
    expect(archiveLine(undefined, done, "Archived", NOW)).toBe(
      `### Archived 2026-09-06\n${done}`
    );
  });

  test("an empty changelog is the same as none", () => {
    expect(archiveLine("", done, "Archived", NOW)).toBe(
      `### Archived 2026-09-06\n${done}`
    );
  });

  // A changelog holding only whitespace is empty, not existing content to
  // append below.
  test("a whitespace-only changelog is the same as none", () => {
    expect(archiveLine("  \n\n ", done, "Archived", NOW)).toBe(
      `### Archived 2026-09-06\n${done}`
    );
  });

  // A second entry on the same day joins the heading already there.
  test("appends under today's heading when it already exists", () => {
    const existing = `### Archived 2026-09-06\n${line(1, "a", "done")}`;
    expect(archiveLine(existing, done, "Archived", NOW)).toBe(`${existing}\n${done}`);
  });

  test("adds a new heading when the existing one is from another day", () => {
    const existing = `### Archived 2026-01-01\n${line(1, "a", "done")}`;
    expect(archiveLine(existing, done, "Archived", NOW)).toBe(
      `${existing}\n\n### Archived 2026-09-06\n${done}`
    );
  });

  test("retiring files under its own heading, not the archive one", () => {
    expect(archiveLine(undefined, done, "Retired", NOW)).toContain("### Retired");
  });

  test("archiving is the default kind", () => {
    expect(archiveLine(undefined, done, undefined, NOW)).toContain("### Archived");
  });
});

describe("selectIscs", () => {
  const open = [isc(1, "o")];
  const done = [isc(2, "d", "done")];
  const retired = [isc(3, "r", "retired")];

  test("shows only the open ones by default", () => {
    expect(selectIscs(open, done, retired, new Set())).toEqual(open);
  });

  test("--all shows every status", () => {
    expect(selectIscs(open, done, retired, new Set(["--all"]))).toEqual([
      ...open,
      ...done,
      ...retired,
    ]);
  });

  test("--closed shows the done ones", () => {
    expect(selectIscs(open, done, retired, new Set(["--closed"]))).toEqual(done);
  });

  test("--retired shows the retired ones", () => {
    expect(selectIscs(open, done, retired, new Set(["--retired"]))).toEqual(retired);
  });

  // --all is the widest view, so it wins over a narrower flag alongside it.
  test("--all outranks the narrower flags", () => {
    expect(selectIscs(open, done, retired, new Set(["--all", "--closed"])).length).toBe(
      3
    );
  });
});

describe("taskSlug", () => {
  const AT = Date.parse("2026-09-06T12:00:00.000Z");

  test("lowercases and joins words with hyphens", () => {
    expect(taskSlug("Fix The Thing", AT)).toBe(`fix-the-thing-${AT.toString(36)}`);
  });

  test("collapses punctuation into single hyphens", () => {
    expect(taskSlug("a  b/c!!d", AT).startsWith("a-b-c-d-")).toBe(true);
  });

  // A leading or trailing run of punctuation must not leave a bare hyphen.
  test("trims hyphens from both ends of the stem", () => {
    expect(taskSlug("!!edges!!", AT)).toBe(`edges-${AT.toString(36)}`);
  });

  test("caps the stem length", () => {
    const slug = taskSlug("w".repeat(100), AT);
    expect(slug).toBe(`${"w".repeat(40)}-${AT.toString(36)}`);
  });

  // The clock is what keeps two tasks of the same title apart.
  test("the same title at different times gives different slugs", () => {
    expect(taskSlug("same", AT)).not.toBe(taskSlug("same", AT + 1000));
  });
});
