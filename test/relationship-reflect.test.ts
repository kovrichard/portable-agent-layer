import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpinion } from "../src/hooks/lib/opinions";
import {
  averageRating,
  changeLine,
  consoleLines,
  correlateRatings,
  cutoffDate,
  formatReport,
  groupNoteOccurrences,
  highConfidenceLines,
  loadNotes,
  loadRatings,
  type OpinionChange,
  type ParsedNote,
  parseNoteFile,
  parseRatings,
  planPromotions,
  type Rating,
  reportPath,
} from "../src/tools/lib/relationship-reflect";

const NOW = new Date("2026-09-06T12:00:00.000Z");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pal-reflect-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const note = (
  type: ParsedNote["type"],
  text: string,
  date = "2026-09-05",
  confidence?: number
): ParsedNote => ({ type, text, date, time: "10:00", confidence });

const rating = (
  n: number,
  context = "ctx",
  source: Rating["source"] = "explicit",
  ts = "2026-09-05T10:00:00.000Z"
): Rating => ({ ts, rating: n, context, source });

describe("cutoffDate", () => {
  test("counts back the days it is given", () => {
    expect(cutoffDate(7, NOW).toISOString()).toBe("2026-08-30T12:00:00.000Z");
  });

  test("does not move the clock it was handed", () => {
    const before = NOW.toISOString();
    cutoffDate(30, NOW);
    expect(NOW.toISOString()).toBe(before);
  });
});

describe("parseNoteFile", () => {
  test("reads an opinion note with its confidence", () => {
    const notes = parseNoteFile("- O(c=0.85): prefers concise summaries", "2026-09-05");
    expect(notes).toEqual([
      {
        type: "O",
        text: "prefers concise summaries",
        confidence: 0.85,
        date: "2026-09-05",
        time: "",
      },
    ]);
  });

  test("reads a world fact, which carries no confidence", () => {
    const notes = parseNoteFile("- W: runs Copilot as the CLI", "2026-09-05");
    expect(notes[0].type).toBe("W");
    expect(notes[0].confidence).toBeUndefined();
  });

  // The file's own type is "B"; everything downstream asks for "Session".
  test("files a B note as a session note", () => {
    expect(parseNoteFile("- B(c=0.5): built the ledger", "2026-09-05")[0].type).toBe(
      "Session"
    );
  });

  test("a time heading applies to every note beneath it", () => {
    const notes = parseNoteFile(
      ["## 08:43", "- W: first", "- W: second", "## 12:38", "- W: third"].join("\n"),
      "2026-09-05"
    );
    expect(notes.map((n) => n.time)).toEqual(["08:43", "08:43", "12:38"]);
  });

  test("notes before any heading carry no time rather than the next one's", () => {
    const notes = parseNoteFile(
      ["- W: orphan", "## 08:43", "- W: later"].join("\n"),
      "d"
    );
    expect(notes[0].time).toBe("");
  });

  test("ignores prose, headings and blank lines", () => {
    const notes = parseNoteFile(
      ["# Relationship Notes", "", "some prose", "- not a typed note", ""].join("\n"),
      "2026-09-05"
    );
    expect(notes).toEqual([]);
  });

  test("a quoted marker is prose — a marker only counts at the line start", () => {
    const quoted = ["> - W: quoted", "> - O(c=0.5): quoted"].join("\n");
    expect(parseNoteFile(quoted, "2026-09-05")).toEqual([]);
  });

  test("a heading only counts at the line start", () => {
    const notes = parseNoteFile(["prose about ## 08:43", "- W: fact"].join("\n"), "d");
    expect(notes[0].time).toBe("");
  });

  test("the space after the colon is optional", () => {
    const tight = ["- W:tight", "- O(c=0.5):also tight"].join("\n");
    expect(parseNoteFile(tight, "d").map((n) => n.text)).toEqual(["tight", "also tight"]);
  });

  test("stamps every note with the date it was given", () => {
    const notes = parseNoteFile("- W: a\n- O(c=0.5): b", "2026-01-02");
    expect(notes.map((n) => n.date)).toEqual(["2026-01-02", "2026-01-02"]);
  });
});

describe("loadNotes", () => {
  function withNotes(files: Record<string, Record<string, string>>): string {
    const dir = tempDir();
    for (const [month, days] of Object.entries(files)) {
      mkdirSync(join(dir, month), { recursive: true });
      for (const [day, content] of Object.entries(days)) {
        writeFileSync(join(dir, month, `${day}.md`), content);
      }
    }
    return dir;
  }

  test("returns nothing when the directory does not exist", () => {
    expect(loadNotes(join(tempDir(), "nope"), 7, NOW)).toEqual([]);
  });

  test("reads the days inside the window", () => {
    const dir = withNotes({
      "2026-09": { "2026-09-05": "- W: recent", "2026-09-01": "- W: also recent" },
    });
    expect(loadNotes(dir, 7, NOW).map((n) => n.text)).toEqual(["recent", "also recent"]);
  });

  test("drops a day older than the window", () => {
    const dir = withNotes({
      "2026-09": { "2026-09-05": "- W: recent" },
      "2026-08": { "2026-08-01": "- W: ancient" },
    });
    expect(loadNotes(dir, 7, NOW).map((n) => n.text)).toEqual(["recent"]);
  });

  test("a wider window reaches back further", () => {
    const dir = withNotes({
      "2026-09": { "2026-09-05": "- W: recent" },
      "2026-08": { "2026-08-20": "- W: last month" },
    });
    expect(loadNotes(dir, 30, NOW).map((n) => n.text)).toEqual(["recent", "last month"]);
  });

  test("ignores directories that are not a month", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05": "- W: kept" } });
    mkdirSync(join(dir, "reflections"), { recursive: true });
    writeFileSync(join(dir, "reflections", "2026-09-05.md"), "- W: dropped");
    expect(loadNotes(dir, 7, NOW).map((n) => n.text)).toEqual(["kept"]);
  });

  test("a directory that only looks like a month is not a month", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05": "- W: kept" } });
    for (const name of ["archive-2026-08", "2026-08-archive"]) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, "2026-09-04.md"), "- W: dropped");
    }
    expect(loadNotes(dir, 7, NOW).map((n) => n.text)).toEqual(["kept"]);
  });

  test("ignores files in a month directory that are not markdown", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05": "- W: kept" } });
    writeFileSync(join(dir, "2026-09", "2026-09-04.txt"), "- W: dropped");
    expect(loadNotes(dir, 7, NOW).map((n) => n.text)).toEqual(["kept"]);
  });

  // The cutoff day itself is in the window; the day before it is not.
  test("the cutoff day is inside the window", () => {
    const midnight = new Date("2026-09-06T00:00:00.000Z");
    const dir = withNotes({
      "2026-08": { "2026-08-30": "- W: on the cutoff", "2026-08-29": "- W: before it" },
    });
    expect(loadNotes(dir, 7, midnight).map((n) => n.text)).toEqual(["on the cutoff"]);
  });

  test("a file where a month directory should be is skipped, not thrown on", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05": "- W: kept" } });
    writeFileSync(join(dir, "2026-07"), "not a directory");
    expect(loadNotes(dir, 30, NOW).map((n) => n.text)).toEqual(["kept"]);
  });

  test("reads the newest month and the newest day first", () => {
    const dir = withNotes({
      "2026-08": { "2026-08-31": "- W: older" },
      "2026-09": { "2026-09-01": "- W: middle", "2026-09-05": "- W: newest" },
    });
    expect(loadNotes(dir, 30, NOW).map((n) => n.text)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
  });
});

describe("parseRatings", () => {
  test("keeps ratings inside the window", () => {
    const content = [
      JSON.stringify(rating(8, "good", "explicit", "2026-09-05T10:00:00.000Z")),
      JSON.stringify(rating(2, "old", "explicit", "2026-01-01T10:00:00.000Z")),
    ].join("\n");
    expect(parseRatings(content, 7, NOW).map((r) => r.context)).toEqual(["good"]);
  });

  test("the window edge is inside it", () => {
    const edge = cutoffDate(7, NOW).toISOString();
    const content = JSON.stringify(rating(5, "edge", "explicit", edge));
    expect(parseRatings(content, 7, NOW)).toHaveLength(1);
  });

  test("skips a malformed line and keeps the rest", () => {
    const content = ["{not json", JSON.stringify(rating(7, "kept"))].join("\n");
    expect(parseRatings(content, 7, NOW).map((r) => r.context)).toEqual(["kept"]);
  });

  test("skips blank lines", () => {
    const content = ["", "  ", JSON.stringify(rating(7, "kept")), ""].join("\n");
    expect(parseRatings(content, 7, NOW)).toHaveLength(1);
  });
});

describe("loadRatings", () => {
  test("returns nothing when the file does not exist", () => {
    expect(loadRatings(join(tempDir(), "missing.jsonl"), 7, NOW)).toEqual([]);
  });

  test("reads the file it is pointed at", () => {
    const filepath = join(tempDir(), "ratings.jsonl");
    writeFileSync(filepath, JSON.stringify(rating(9, "sharp")));
    expect(loadRatings(filepath, 7, NOW).map((r) => r.context)).toEqual(["sharp"]);
  });
});

describe("groupNoteOccurrences", () => {
  test("counts two phrasings of the same observation once", () => {
    const summaries = groupNoteOccurrences([
      note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8),
      note("O", "Rico prefers concise summaries, not long recaps", "2026-09-03", 0.9),
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].occurrences).toBe(2);
  });

  // Ten keywords each, three shared: Dice puts this at exactly 0.3, the value
  // the threshold is written against.
  test("the similarity threshold is inclusive — an exact 0.3 is the same observation", () => {
    const keywords = Array.from({ length: 17 }, (_, i) => `kw${i}`);
    const first = keywords.slice(0, 10).join(" ");
    const second = keywords.slice(7, 17).join(" ");
    expect(
      groupNoteOccurrences([
        note("O", first, "2026-09-01"),
        note("O", second, "2026-09-02"),
      ])
    ).toHaveLength(1);
  });

  test("keeps unrelated observations apart", () => {
    const summaries = groupNoteOccurrences([
      note("O", "prefers concise summaries", "2026-09-01", 0.8),
      note("O", "structural guarantees beat conventions", "2026-09-02", 0.7),
    ]);
    expect(summaries).toHaveLength(2);
  });

  test("averages the confidences of a group", () => {
    const summaries = groupNoteOccurrences([
      note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8),
      note("O", "Rico prefers concise summaries, not long recaps", "2026-09-03", 0.6),
    ]);
    expect(summaries[0].avgConfidence).toBeCloseTo(0.7, 10);
  });

  test("a group with no confidences averages to zero, not NaN", () => {
    const summaries = groupNoteOccurrences([note("O", "unscored observation")]);
    expect(summaries[0].avgConfidence).toBe(0);
  });

  test("lists each date once even when a day carries the note twice", () => {
    const summaries = groupNoteOccurrences([
      note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8),
      note("O", "Rico prefers concise summaries, not long recaps", "2026-09-01", 0.9),
    ]);
    expect(summaries[0].dates).toEqual(["2026-09-01"]);
    expect(summaries[0].occurrences).toBe(2);
  });

  test("puts the most-seen observation first", () => {
    const summaries = groupNoteOccurrences([
      note("O", "seen once and never again", "2026-09-01", 0.5),
      note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8),
      note("O", "Rico prefers concise summaries, not long recaps", "2026-09-02", 0.9),
    ]);
    expect(summaries[0].occurrences).toBe(2);
    expect(summaries[1].occurrences).toBe(1);
  });

  test("ignores world facts and session notes", () => {
    expect(
      groupNoteOccurrences([note("W", "a fact"), note("Session", "a session", "d", 0.5)])
    ).toEqual([]);
  });
});

describe("planPromotions", () => {
  test("promotes an observation seen twice", () => {
    const plan = planPromotions(
      [
        note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8),
        note("O", "Rico prefers concise summaries, not long recaps", "2026-09-03", 0.9),
      ],
      []
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].action).toBe("created");
    expect(plan.toSave).toHaveLength(1);
  });

  // One sighting is an anecdote. This is the whole point of the threshold.
  test("leaves a single sighting alone", () => {
    const plan = planPromotions([note("O", "said once", "2026-09-01", 0.8)], []);
    expect(plan.changes).toEqual([]);
    expect(plan.toSave).toEqual([]);
  });

  test("strengthens an opinion that already covers the observation", () => {
    const existing = createOpinion("Rico prefers concise summaries", "seed");
    const plan = planPromotions(
      [note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8)],
      [existing]
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].action).toBe("strengthened");
    expect(plan.changes[0].oldConfidence).toBe(existing.confidence);
    expect(plan.changes[0].newConfidence).toBeGreaterThan(existing.confidence);
  });

  // A match against an existing opinion needs no second sighting: the opinion
  // is already the second sighting.
  test("a single sighting still strengthens an opinion it matches", () => {
    const existing = createOpinion("Rico prefers concise summaries", "seed");
    expect(
      planPromotions([note("O", "Rico prefers concise summaries", "d", 0.8)], [existing])
        .changes
    ).toHaveLength(1);
  });

  test("reports the existing opinion's wording, not the note's", () => {
    const existing = createOpinion("Rico prefers concise summaries", "seed");
    const plan = planPromotions(
      [note("O", "Rico prefers concise summaries over long recaps", "d", 0.8)],
      [existing]
    );
    expect(plan.changes[0].statement).toBe("Rico prefers concise summaries");
  });

  // An opinion at the ceiling gains evidence but no confidence, so there is
  // nothing to report and nothing to write.
  test("does not save an opinion already at maximum confidence", () => {
    const capped = { ...createOpinion("a capped opinion", "seed"), confidence: 0.99 };
    const plan = planPromotions(
      [note("O", "a capped opinion", "2026-09-01", 0.9)],
      [capped]
    );
    expect(plan.changes).toEqual([]);
    expect(plan.toSave).toEqual([]);
  });

  test("does not re-count evidence the opinion already carries", () => {
    const seeded = createOpinion("Rico prefers concise summaries", "already recorded");
    const plan = planPromotions(
      [note("O", "already recorded", "2026-09-01", 0.8)],
      [seeded]
    );
    expect(plan.changes).toEqual([]);
  });

  test("plans without writing — the caller decides whether to save", () => {
    const plan = planPromotions(
      [
        note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8),
        note("O", "Rico prefers concise summaries, not long recaps", "2026-09-03", 0.9),
      ],
      []
    );
    expect(plan.toSave[0].statement).toBe(plan.changes[0].statement);
  });

  test("ignores world facts", () => {
    expect(
      planPromotions([note("W", "a fact"), note("W", "a fact")], []).changes
    ).toEqual([]);
  });

  // The first sighting founds the opinion; every one after it is evidence. Two
  // sightings therefore land one step above the starting confidence.
  test("a new opinion starts at the base and gains a step per extra sighting", () => {
    const base = createOpinion("anything", "seed").confidence;
    const sighting = (n: number) =>
      note(
        "O",
        `Rico prefers concise summaries over long recaps ${n}`,
        "2026-09-01",
        0.8
      );

    expect(planPromotions([sighting(1), sighting(2)], []).changes[0].newConfidence).toBe(
      base + 0.05
    );
    expect(
      planPromotions([sighting(1), sighting(2), sighting(3)], []).changes[0].newConfidence
    ).toBeCloseTo(base + 0.1, 10);
  });

  // Evidence is a citation, not a transcript. A whole note would bloat the
  // store and defeat the duplicate check, which compares sources.
  test("records at most 120 characters of a note as evidence", () => {
    const long = `${"w".repeat(200)} tail`;
    const plan = planPromotions(
      [note("O", long, "2026-09-01", 0.8), note("O", `${long} more`, "2026-09-02", 0.9)],
      []
    );
    for (const evidence of plan.toSave[0].evidence) {
      expect(evidence.source.length).toBeLessThanOrEqual(120);
    }
  });

  test("records at most 120 characters when strengthening an existing opinion", () => {
    const existing = createOpinion("Rico prefers concise summaries", "seed");
    const long = `Rico prefers concise summaries ${"w".repeat(200)}`;
    const plan = planPromotions([note("O", long, "d", 0.8)], [existing]);
    expect(plan.toSave[0].evidence.at(-1)?.source).toBe(long.slice(0, 120));
  });

  test("cites the note as supporting evidence, which is what raises confidence", () => {
    const existing = createOpinion("Rico prefers concise summaries", "seed");
    const plan = planPromotions(
      [note("O", "Rico prefers concise summaries over long recaps", "d", 0.8)],
      [existing]
    );
    expect(plan.toSave[0].evidence.at(-1)?.type).toBe("supporting");
    expect(plan.changes[0].newConfidence).toBeCloseTo(existing.confidence + 0.05, 10);
  });
});

describe("averageRating", () => {
  test("averages what it is given", () => {
    expect(averageRating([rating(8), rating(6)])).toBe(7);
  });

  test("an empty list averages to zero, not NaN", () => {
    expect(averageRating([])).toBe(0);
  });
});

describe("correlateRatings", () => {
  test("says nothing about an empty set", () => {
    expect(correlateRatings([])).toEqual([]);
  });

  test("counts the low ratings and quotes up to three contexts", () => {
    const line = correlateRatings([
      rating(1, "a"),
      rating(2, "b"),
      rating(3, "c"),
      rating(4, "d"),
    ])[0];
    expect(line).toStartWith("4 low ratings (<=4)");
    expect(line).toContain('"a", "b", "c"');
    expect(line).not.toContain('"d"');
  });

  test("four is low and five is not", () => {
    expect(correlateRatings([rating(4)])[0]).toContain("1 low ratings");
    expect(correlateRatings([rating(5)])[0]).not.toContain("low ratings");
  });

  test("seven is high and six is not", () => {
    expect(correlateRatings([rating(7)])[0]).toContain("1 high ratings");
    expect(correlateRatings([rating(6)])[0]).not.toContain("high ratings");
  });

  test("truncates a long context to sixty characters", () => {
    const line = correlateRatings([rating(1, "x".repeat(80))])[0];
    expect(line).toContain(`"${"x".repeat(60)}"`);
    expect(line).not.toContain("x".repeat(61));
  });

  test("splits the source mix into explicit and implicit", () => {
    const insights = correlateRatings([
      rating(5, "a", "explicit"),
      rating(5, "b", "implicit"),
      rating(5, "c", "implicit"),
    ]);
    expect(insights).toEqual(["Source mix: 1 explicit, 2 implicit"]);
  });
});

describe("changeLine", () => {
  test("marks a new opinion with its confidence", () => {
    expect(changeLine({ statement: "s", action: "created", newConfidence: 0.6 })).toBe(
      "- **NEW** (60%): s"
    );
  });

  // The confidence it came from, not a rounding of the raw fraction — the old
  // line read "1% → 77%" for every opinion above a half.
  test("shows both ends of a strengthened opinion", () => {
    expect(
      changeLine({
        statement: "s",
        action: "strengthened",
        oldConfidence: 0.72,
        newConfidence: 0.77,
      })
    ).toBe("- **+** 72% → 77%: s");
  });

  test("a strengthened opinion with no recorded start reads as zero", () => {
    expect(
      changeLine({ statement: "s", action: "strengthened", newConfidence: 0.5 })
    ).toBe("- **+** 0% → 50%: s");
  });
});

describe("formatReport", () => {
  const changes: OpinionChange[] = [
    { statement: "a new one", action: "created", newConfidence: 0.6 },
  ];

  // The whole document, because the blank lines between sections are the
  // rendering: assert them line by line and a stray one goes unnoticed.
  test("renders the whole report, blank lines and all", () => {
    const notes = [
      note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8),
      note("O", "Rico prefers concise summaries, not long recaps", "2026-09-03", 0.6),
      note("W", "runs Copilot as the GitHub CLI", "2026-09-02"),
      note("Session", "built the ledger read side", "2026-09-02", 0.5),
    ];
    const ratings = [rating(2, "verbose recap"), rating(9, "surgical fix", "implicit")];
    const changes: OpinionChange[] = [
      { statement: "a new one", action: "created", newConfidence: 0.6 },
      {
        statement: "an older one",
        action: "strengthened",
        oldConfidence: 0.72,
        newConfidence: 0.77,
      },
    ];

    expect(formatReport("Weekly", notes, ratings, changes, NOW).split("\n")).toEqual([
      "# Relationship Reflection",
      "",
      "**Period:** Weekly",
      "**Generated:** 2026-09-06",
      "**Notes analyzed:** 4",
      "**Ratings analyzed:** 2",
      "**Average Rating:** 5.5/10",
      "",
      "---",
      "",
      "## Opinion Changes",
      "",
      "- **NEW** (60%): a new one",
      "- **+** 72% → 77%: an older one",
      "",
      "## Recurring Opinions",
      "",
      "- **Rico prefers concise summaries over long recaps**",
      "  Seen 2x | Avg confidence: 0.70 | Dates: 2026-09-01, 2026-09-03",
      "",
      "## World Facts Observed",
      "",
      "- runs Copilot as the GitHub CLI",
      "",
      "## Rating Insights",
      "",
      '- 1 low ratings (<=4) — common contexts: "verbose recap"',
      '- 1 high ratings (>=7) — common contexts: "surgical fix"',
      "- Source mix: 1 explicit, 1 implicit",
      "",
    ]);
  });

  test("heads the report with the period, the date and the counts", () => {
    const report = formatReport("Weekly", [note("W", "f")], [rating(8)], [], NOW);
    expect(report).toStartWith("# Relationship Reflection\n");
    expect(report).toContain("**Period:** Weekly");
    expect(report).toContain("**Generated:** 2026-09-06");
    expect(report).toContain("**Notes analyzed:** 1");
    expect(report).toContain("**Ratings analyzed:** 1");
    expect(report).toContain("**Average Rating:** 8.0/10");
  });

  test("omits every optional section when there is nothing to put in it", () => {
    const report = formatReport("Weekly", [], [], [], NOW);
    expect(report).not.toContain("## Opinion Changes");
    expect(report).not.toContain("## Recurring Opinions");
    expect(report).not.toContain("## World Facts Observed");
    expect(report).not.toContain("## Rating Insights");
  });

  test("lists opinion changes when there are any", () => {
    const report = formatReport("Weekly", [], [], changes, NOW);
    expect(report).toContain("## Opinion Changes");
    expect(report).toContain("- **NEW** (60%): a new one");
  });

  test("lists a recurring opinion with its count, average and dates", () => {
    const report = formatReport(
      "Weekly",
      [
        note("O", "Rico prefers concise summaries over long recaps", "2026-09-01", 0.8),
        note("O", "Rico prefers concise summaries, not long recaps", "2026-09-03", 0.6),
      ],
      [],
      [],
      NOW
    );
    expect(report).toContain(
      "  Seen 2x | Avg confidence: 0.70 | Dates: 2026-09-01, 2026-09-03"
    );
  });

  test("shows at most ten world facts", () => {
    const facts = Array.from({ length: 12 }, (_, i) => note("W", `fact ${i}`));
    const report = formatReport("Weekly", facts, [], [], NOW);
    expect(report).toContain("- fact 9");
    expect(report).not.toContain("- fact 10");
  });

  test("carries the rating insights through", () => {
    const report = formatReport("Weekly", [], [rating(2, "bad")], [], NOW);
    expect(report).toContain("## Rating Insights");
    expect(report).toContain('- 1 low ratings (<=4) — common contexts: "bad"');
  });
});

describe("reportPath", () => {
  // Built with resolve, not a literal, so the separator is the platform's.
  test("names the file by date and period", () => {
    expect(reportPath("/reports", "Weekly", NOW)).toBe(
      resolve("/reports", "2026-09-06_weekly-reflection.md")
    );
  });

  test("slugs a multi-word period", () => {
    expect(reportPath("/reports", "Last Quarter", NOW)).toEndWith(
      "2026-09-06_last-quarter-reflection.md"
    );
  });

  test("a run of whitespace becomes one dash, not several", () => {
    expect(reportPath("/reports", "Last  Quarter", NOW)).toEndWith(
      "2026-09-06_last-quarter-reflection.md"
    );
  });
});

describe("consoleLines", () => {
  test("always reports the average and the observation count", () => {
    const lines = consoleLines([note("O", "one", "d", 0.5)], [rating(8)], []);
    expect(lines[0]).toBe("\nAverage Rating: 8.0/10");
    expect(lines[1]).toBe("Observations: 1 unique");
  });

  test("says so when nothing changed", () => {
    expect(consoleLines([], [], [])).toEqual([
      "\nAverage Rating: 0.0/10",
      "Observations: 0 unique",
      "\nNo opinion changes",
    ]);
  });

  test("marks a created opinion and a strengthened one differently", () => {
    const lines = consoleLines(
      [],
      [],
      [
        { statement: "fresh", action: "created", newConfidence: 0.6 },
        {
          statement: "older",
          action: "strengthened",
          oldConfidence: 0.72,
          newConfidence: 0.77,
        },
      ]
    );
    expect(lines).toEqual([
      "\nAverage Rating: 0.0/10",
      "Observations: 0 unique",
      "\nOpinion changes:",
      "  + NEW (60%) fresh",
      "  ~ 72% → 77% older",
    ]);
  });

  test("truncates a long statement to eighty characters", () => {
    const statement = "z".repeat(120);
    const lines = consoleLines(
      [],
      [],
      [{ statement, action: "created", newConfidence: 0.6 }]
    );
    expect(lines[3]).toBe(`  + NEW (60%) ${"z".repeat(80)}`);
  });
});

describe("highConfidenceLines", () => {
  const at = (confidence: number, statement = "s") => ({
    ...createOpinion(statement, "seed"),
    confidence,
  });

  test("says nothing when nothing crossed the bar", () => {
    expect(highConfidenceLines([at(0.84)])).toEqual([]);
  });

  test("0.85 is over the bar", () => {
    expect(highConfidenceLines([at(0.85)])).toHaveLength(2);
  });

  test("heads the list and shows each opinion as a percentage", () => {
    const lines = highConfidenceLines([at(0.9, "a strong one")]);
    expect(lines[0]).toBe("\nHigh-confidence opinions (injected into context):");
    expect(lines[1]).toBe("  [90%] a strong one");
  });

  test("truncates a long statement to eighty characters", () => {
    const lines = highConfidenceLines([at(0.9, "z".repeat(120))]);
    expect(lines[1]).toBe(`  [90%] ${"z".repeat(80)}`);
  });

  test("leaves the below-bar opinions out of a mixed list", () => {
    const lines = highConfidenceLines([at(0.9, "kept"), at(0.5, "dropped")]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("kept");
  });
});
