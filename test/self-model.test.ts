import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AlgorithmReflection,
  archiveDateOf,
  buildPrompt,
  countSessions,
  crystallizedPrinciples,
  daysAgo,
  FAILED_SYNTHESIS,
  failedSynthesisModel,
  formatDataForInference,
  type GraduatedPattern,
  gatherData,
  inferenceUserContent,
  metaFooter,
  type Opinion,
  parseRelationshipNotes,
  previousModelForPrompt,
  type Rating,
  readAlgorithmReflections,
  readGraduatedPatterns,
  readJsonl,
  readOpinions,
  readRatings,
  readRelationshipNotes,
  readWisdomFrames,
  reflectionStats,
  round1,
  type SelfModelData,
  summarizeRatings,
  synthesisIsDue,
} from "../src/tools/lib/self-model";

const NOW = new Date("2026-09-06T12:00:00.000Z");
const SINCE = new Date("2026-08-07T12:00:00.000Z");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pal-self-model-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fileWith(content: string, name = "f.jsonl"): string {
  const path = join(tempDir(), name);
  writeFileSync(path, content);
  return path;
}

const rating = (n: number, ts: string, context = ""): Rating => ({
  ts,
  type: "explicit",
  rating: n,
  context,
  source: "user",
});

const opinion = (
  statement: string,
  confidence: number,
  category = "workflow"
): Opinion => ({
  id: statement,
  statement,
  confidence,
  category,
  evidence: [],
  created: "2026-08-01",
  updated: "2026-09-01",
});

const reflection = (n: number, over: Partial<AlgorithmReflection> = {}) =>
  ({
    timestamp: `2026-09-0${n}T00:00:00.000Z`,
    task: `task ${n}`,
    criteria_count: 4,
    criteria_passed: 3,
    criteria_failed: 1,
    sentiment: 8,
    q1: `self ${n}`,
    q2: `algo ${n}`,
    q3: `next ${n}`,
    ...over,
  }) satisfies AlgorithmReflection;

const graduated = (pattern: string, occurrences = 3): GraduatedPattern => ({
  pattern,
  domain: "project",
  confidence: 0.8,
  occurrences,
  sources: [],
  graduatedAt: "2026-09-01",
});

describe("readJsonl", () => {
  test("returns nothing when the file does not exist", () => {
    expect(readJsonl(join(tempDir(), "nope.jsonl"))).toEqual([]);
  });

  test("reads one object per line", () => {
    const path = fileWith('{"a":1}\n{"a":2}\n');
    expect(readJsonl(path)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test("skips blank lines", () => {
    expect(readJsonl(fileWith('{"a":1}\n\n   \n{"a":2}'))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  // One bad line loses the file, not just the line — the reader is all-or-nothing.
  test("a malformed line loses the whole file", () => {
    expect(readJsonl(fileWith('{"a":1}\n{oops'))).toEqual([]);
  });
});

describe("daysAgo", () => {
  test("counts back the days it is given", () => {
    expect(daysAgo(30, NOW).toISOString()).toBe("2026-08-07T12:00:00.000Z");
  });

  test("does not move the clock it was handed", () => {
    const before = NOW.toISOString();
    daysAgo(7, NOW);
    expect(NOW.toISOString()).toBe(before);
  });
});

describe("round1", () => {
  test("keeps one decimal", () => {
    expect(round1(5.847)).toBe(5.8);
  });

  test("rounds half up", () => {
    expect(round1(5.85)).toBe(5.9);
  });

  test("leaves a whole number whole", () => {
    expect(round1(6)).toBe(6);
  });
});

describe("synthesisIsDue", () => {
  const meta = (timestamp: string) => JSON.stringify({ timestamp });

  test("a first run has no meta and is due", () => {
    expect(synthesisIsDue(null, NOW)).toBe(true);
  });

  test("unreadable meta is treated as due rather than blocking forever", () => {
    expect(synthesisIsDue("{not json", NOW)).toBe(true);
  });

  test("a synthesis an hour old is not due", () => {
    expect(synthesisIsDue(meta("2026-09-06T11:00:00.000Z"), NOW)).toBe(false);
  });

  test("exactly 24h old is not yet due — the guard is strictly greater", () => {
    expect(synthesisIsDue(meta("2026-09-05T12:00:00.000Z"), NOW)).toBe(false);
  });

  test("a second past 24h is due", () => {
    expect(synthesisIsDue(meta("2026-09-05T11:59:59.000Z"), NOW)).toBe(true);
  });
});

describe("archiveDateOf", () => {
  test("files the archive under the day the model it replaces was written", () => {
    expect(archiveDateOf({ timestamp: "2026-09-01T08:00:00.000Z" }, NOW)).toBe(
      "2026-09-01"
    );
  });

  test("falls back to today when the meta carries no timestamp", () => {
    expect(archiveDateOf({}, NOW)).toBe("2026-09-06");
  });
});

describe("readOpinions", () => {
  test("returns nothing when the file does not exist", () => {
    expect(readOpinions(join(tempDir(), "nope.json"))).toEqual([]);
  });

  test("returns nothing when the file is not JSON", () => {
    expect(readOpinions(fileWith("{oops", "opinions.json"))).toEqual([]);
  });

  test("returns nothing when the JSON carries no opinions key", () => {
    expect(readOpinions(fileWith("{}", "opinions.json"))).toEqual([]);
  });

  test("sorts by confidence, strongest first", () => {
    const path = fileWith(
      JSON.stringify({
        opinions: [opinion("weak", 0.3), opinion("strong", 0.9), opinion("mid", 0.6)],
      }),
      "opinions.json"
    );
    expect(readOpinions(path).map((o) => o.statement)).toEqual(["strong", "mid", "weak"]);
  });
});

describe("summarizeRatings", () => {
  const at = (hour: number) => `2026-09-01T0${hour}:00:00.000Z`;

  test("an empty window summarizes to zeroes, not NaN", () => {
    expect(summarizeRatings([], SINCE)).toEqual({
      count: 0,
      avg: 0,
      recentAvg: 0,
      lowCount: 0,
      highCount: 0,
      trend: "stable",
      recentContexts: [],
    });
  });

  test("drops ratings older than the window", () => {
    const ratings = [rating(9, "2026-01-01T00:00:00.000Z"), rating(5, at(0))];
    expect(summarizeRatings(ratings, SINCE).count).toBe(1);
  });

  test("the window edge is inside it", () => {
    expect(summarizeRatings([rating(5, SINCE.toISOString())], SINCE).count).toBe(1);
  });

  test("averages to one decimal", () => {
    const ratings = [rating(5, at(0)), rating(8, at(1)), rating(9, at(2))];
    expect(summarizeRatings(ratings, SINCE).avg).toBe(7.3);
  });

  test("the recent average covers the last ten only", () => {
    const ratings = [
      ...Array.from({ length: 10 }, (_, i) =>
        rating(1, `2026-09-01T0${i % 10}:00:00.000Z`)
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        rating(9, `2026-09-02T0${i % 10}:00:00.000Z`)
      ),
    ];
    const summary = summarizeRatings(ratings, SINCE);
    expect(summary.avg).toBe(5);
    expect(summary.recentAvg).toBe(9);
  });

  test("three is low and four is not", () => {
    const ratings = [rating(3, at(0)), rating(4, at(1)), rating(5, at(2))];
    expect(summarizeRatings(ratings, SINCE).lowCount).toBe(1);
  });

  test("eight is high and seven is not", () => {
    const ratings = [rating(8, at(0)), rating(7, at(1)), rating(6, at(2))];
    expect(summarizeRatings(ratings, SINCE).highCount).toBe(1);
  });

  const half = (first: number, second: number) => [
    rating(first, at(0)),
    rating(first, at(1)),
    rating(first, at(2)),
    rating(second, at(3)),
    rating(second, at(4)),
    rating(second, at(5)),
  ];

  test("a rising second half reads as improving", () => {
    expect(summarizeRatings(half(2, 9), SINCE).trend).toBe("improving");
  });

  test("a falling second half reads as declining", () => {
    expect(summarizeRatings(half(9, 2), SINCE).trend).toBe("declining");
  });

  test("a flat window reads as stable", () => {
    expect(summarizeRatings(half(5, 5), SINCE).trend).toBe("stable");
  });

  // Half a point either way is noise, not a trend.
  test("a move of exactly half a point is not yet a trend", () => {
    expect(summarizeRatings(half(5, 5.5), SINCE).trend).toBe("stable");
    expect(summarizeRatings(half(5, 4.5), SINCE).trend).toBe("stable");
  });

  test("just over half a point is", () => {
    expect(summarizeRatings(half(5, 5.6), SINCE).trend).toBe("improving");
  });

  // Fewer than three a side and one rating would swing the whole verdict.
  test("five ratings are too few to call a trend", () => {
    const ratings = [
      rating(1, at(0)),
      rating(1, at(1)),
      rating(10, at(2)),
      rating(10, at(3)),
      rating(10, at(4)),
    ];
    expect(summarizeRatings(ratings, SINCE).trend).toBe("stable");
  });

  test("six ratings are enough", () => {
    expect(summarizeRatings(half(1, 10), SINCE).trend).toBe("improving");
  });

  test("keeps the last five low-rating contexts", () => {
    const ratings = Array.from({ length: 8 }, (_, i) =>
      rating(2, `2026-09-01T0${i}:00:00.000Z`, `context ${i}`)
    );
    expect(summarizeRatings(ratings, SINCE).recentContexts).toEqual([
      "context 3",
      "context 4",
      "context 5",
      "context 6",
      "context 7",
    ]);
  });

  test("a three is frustration and a four is not", () => {
    const ratings = [rating(3, at(0), "kept"), rating(4, at(1), "dropped")];
    expect(summarizeRatings(ratings, SINCE).recentContexts).toEqual(["kept"]);
  });

  test("a low rating with no context contributes none", () => {
    const ratings = [rating(2, at(0), ""), rating(2, at(1), "kept")];
    expect(summarizeRatings(ratings, SINCE).recentContexts).toEqual(["kept"]);
  });

  test("a high rating's context is not a frustration signal", () => {
    expect(summarizeRatings([rating(9, at(0), "praise")], SINCE).recentContexts).toEqual(
      []
    );
  });
});

describe("readRatings", () => {
  test("reads and summarizes the file it is pointed at", () => {
    const path = fileWith(
      [
        rating(2, "2026-09-01T00:00:00.000Z", "bad"),
        rating(9, "2026-09-02T00:00:00.000Z"),
      ]
        .map((r) => JSON.stringify(r))
        .join("\n")
    );
    const summary = readRatings(path, SINCE);
    expect(summary.count).toBe(2);
    expect(summary.avg).toBe(5.5);
  });
});

describe("crystallizedPrinciples", () => {
  test("keeps only the crystallized lines", () => {
    const content = ["- crystallized [CRYSTAL: 0.9]", "- plain", "# heading"].join("\n");
    expect(crystallizedPrinciples(content)).toEqual(["crystallized"]);
  });

  test("strips the list marker and the crystal tag", () => {
    expect(crystallizedPrinciples("-    spaced out   [CRYSTAL: 0.8]")).toEqual([
      "spaced out",
    ]);
  });

  test("a crystallized line needs no list marker", () => {
    expect(crystallizedPrinciples("bare line [CRYSTAL: 0.7]")).toEqual(["bare line"]);
  });

  test("finds nothing in a file with nothing crystallized", () => {
    expect(crystallizedPrinciples("- just a note\n- another")).toEqual([]);
  });

  // The marker is only stripped at the line start, so an indented bullet keeps
  // its dash and only the surrounding whitespace comes off.
  test("an indented bullet keeps its dash", () => {
    expect(crystallizedPrinciples("  - indented [CRYSTAL: 0.9]")).toEqual(["- indented"]);
  });

  test("a dash inside the line is not the list marker", () => {
    expect(crystallizedPrinciples("one - two [CRYSTAL: 0.9]")).toEqual(["one - two"]);
  });

  test("the space before the tag is optional", () => {
    expect(crystallizedPrinciples("- tight[CRYSTAL: 0.9]")).toEqual(["tight"]);
  });

  test("the space after the list marker is optional too", () => {
    expect(crystallizedPrinciples("-noSpace [CRYSTAL: 0.9]")).toEqual(["noSpace"]);
  });
});

describe("readWisdomFrames", () => {
  function withFrames(files: Record<string, string>): string {
    const dir = tempDir();
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }

  test("returns nothing when the directory does not exist", () => {
    expect(readWisdomFrames(join(tempDir(), "nope"))).toEqual([]);
  });

  test("names the frame after the file", () => {
    const dir = withFrames({ "engineering.md": "- one [CRYSTAL: 0.9]" });
    expect(readWisdomFrames(dir)).toEqual([
      { domain: "engineering", principles: ["one"] },
    ]);
  });

  // A frame with nothing crystallized has nothing to say, so it is left out.
  test("omits a frame with no crystallized principles", () => {
    const dir = withFrames({
      "empty.md": "- nothing here",
      "full.md": "- one [CRYSTAL: 0.9]",
    });
    expect(readWisdomFrames(dir).map((f) => f.domain)).toEqual(["full"]);
  });

  test("ignores files that are not markdown", () => {
    const dir = withFrames({ "notes.txt": "- one [CRYSTAL: 0.9]" });
    expect(readWisdomFrames(dir)).toEqual([]);
  });

  // Only the trailing extension is the extension.
  test("strips the extension off the end, not wherever it first appears", () => {
    const dir = withFrames({ "legacy.mdx.md": "- one [CRYSTAL: 0.9]" });
    expect(readWisdomFrames(dir)[0].domain).toBe("legacy.mdx");
  });
});

describe("readGraduatedPatterns", () => {
  test("returns nothing when the file does not exist", () => {
    expect(readGraduatedPatterns(join(tempDir(), "nope.json"))).toEqual([]);
  });

  test("returns nothing when the JSON carries no graduated key", () => {
    expect(readGraduatedPatterns(fileWith("{}", "graduated.json"))).toEqual([]);
  });

  test("reads the patterns in the order they were written", () => {
    const path = fileWith(
      JSON.stringify({ graduated: [graduated("first"), graduated("second")] }),
      "graduated.json"
    );
    expect(readGraduatedPatterns(path).map((g) => g.pattern)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("readAlgorithmReflections", () => {
  test("drops reflections older than the window", () => {
    const path = fileWith(
      [
        JSON.stringify(reflection(1, { timestamp: "2026-01-01T00:00:00.000Z" })),
        JSON.stringify(reflection(2)),
      ].join("\n")
    );
    expect(readAlgorithmReflections(path, SINCE).map((r) => r.task)).toEqual(["task 2"]);
  });

  test("the window edge is inside it", () => {
    const path = fileWith(
      JSON.stringify(reflection(1, { timestamp: SINCE.toISOString() }))
    );
    expect(readAlgorithmReflections(path, SINCE)).toHaveLength(1);
  });
});

describe("parseRelationshipNotes", () => {
  test("reads an opinion note with its confidence", () => {
    expect(
      parseRelationshipNotes("- O(c=0.85): prefers concision", "2026-09-05")
    ).toEqual([
      {
        type: "O",
        confidence: 0.85,
        content: "prefers concision",
        date: "2026-09-05",
      },
    ]);
  });

  test("reads a world fact, which carries no confidence", () => {
    const notes = parseRelationshipNotes("- W: runs Copilot as the CLI", "d");
    expect(notes[0].type).toBe("W");
    expect(notes[0].confidence).toBeUndefined();
  });

  test("reads a session note", () => {
    const notes = parseRelationshipNotes("- Session: built the ledger", "d");
    expect(notes).toEqual([{ type: "Session", content: "built the ledger", date: "d" }]);
  });

  // This grammar spells session notes "Session:", not the "B(c=)" the reflection
  // tool reads — a B note is not a note here.
  test("a B note belongs to the other grammar and is ignored", () => {
    expect(parseRelationshipNotes("- B(c=0.5): built the ledger", "d")).toEqual([]);
  });

  test("the space after the colon is optional", () => {
    const content = ["- W:tight", "- O(c=0.5):also tight", "- Session:tight too"].join(
      "\n"
    );
    expect(parseRelationshipNotes(content, "d").map((n) => n.content)).toEqual([
      "tight",
      "also tight",
      "tight too",
    ]);
  });

  // The marker has to open the bullet, and the bullet has to open the line.
  test("a marker buried in the line is prose", () => {
    const content = [
      "- > W: quoted",
      "- > O(c=0.5): quoted",
      "- quoting Session: something",
      ">>W: not even a bullet",
      "  prose mentioning Session: something",
    ].join("\n");
    expect(parseRelationshipNotes(content, "d")).toEqual([]);
  });

  test("an indented note still counts", () => {
    expect(parseRelationshipNotes("    - W: indented", "d")[0].content).toBe("indented");
  });

  test("a bullet with no space after the dash is not a note", () => {
    expect(parseRelationshipNotes("-W: no space", "d")).toEqual([]);
  });

  test("ignores prose, headings and plain bullets", () => {
    const content = ["# Notes", "", "prose", "- plain bullet"].join("\n");
    expect(parseRelationshipNotes(content, "d")).toEqual([]);
  });

  test("stamps every note with the date it was given", () => {
    const content = ["- W: a", "- O(c=0.5): b", "- Session: c"].join("\n");
    expect(parseRelationshipNotes(content, "2026-01-02").map((n) => n.date)).toEqual([
      "2026-01-02",
      "2026-01-02",
      "2026-01-02",
    ]);
  });
});

describe("readRelationshipNotes", () => {
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
    expect(readRelationshipNotes(join(tempDir(), "nope"), SINCE)).toEqual([]);
  });

  test("reads the days inside the window", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05": "- W: recent" } });
    expect(readRelationshipNotes(dir, SINCE)).toEqual([
      { type: "W", content: "recent", date: "2026-09-05" },
    ]);
  });

  // The date is the filename with the trailing extension removed — nothing else.
  test("dates a note by its filename, stripping only the trailing extension", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05.mdnotes": "- W: odd name" } });
    expect(readRelationshipNotes(dir, SINCE)[0].date).toBe("2026-09-05.mdnotes");
  });

  test("drops a day older than the window", () => {
    const dir = withNotes({
      "2026-09": { "2026-09-05": "- W: recent" },
      "2026-01": { "2026-01-02": "- W: ancient" },
    });
    expect(readRelationshipNotes(dir, SINCE).map((n) => n.content)).toEqual(["recent"]);
  });

  test("the cutoff day is inside the window", () => {
    const dir = withNotes({ "2026-08": { "2026-08-07": "- W: on the cutoff" } });
    expect(readRelationshipNotes(dir, SINCE).map((n) => n.content)).toEqual([
      "on the cutoff",
    ]);
  });

  test("ignores directories that are not a month", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05": "- W: kept" } });
    mkdirSync(join(dir, "reflections"), { recursive: true });
    writeFileSync(join(dir, "reflections", "2026-09-05.md"), "- W: dropped");
    expect(readRelationshipNotes(dir, SINCE).map((n) => n.content)).toEqual(["kept"]);
  });

  test("a directory that only looks like a month is not a month", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05": "- W: kept" } });
    for (const name of ["archive-2026-08", "2026-08-archive"]) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, "2026-09-04.md"), "- W: dropped");
    }
    expect(readRelationshipNotes(dir, SINCE).map((n) => n.content)).toEqual(["kept"]);
  });

  test("ignores files that are not markdown", () => {
    const dir = withNotes({ "2026-09": { "2026-09-05": "- W: kept" } });
    writeFileSync(join(dir, "2026-09", "2026-09-04.txt"), "- W: dropped");
    expect(readRelationshipNotes(dir, SINCE).map((n) => n.content)).toEqual(["kept"]);
  });
});

describe("countSessions", () => {
  function withSessions(files: Record<string, Record<string, string[]>>): string {
    const dir = tempDir();
    for (const [year, months] of Object.entries(files)) {
      for (const [month, names] of Object.entries(months)) {
        mkdirSync(join(dir, year, month), { recursive: true });
        for (const name of names) writeFileSync(join(dir, year, month, name), "x");
      }
    }
    return dir;
  }

  test("counts nothing when the directory does not exist", () => {
    expect(countSessions(join(tempDir(), "nope"), SINCE)).toBe(0);
  });

  test("counts the transcripts inside the window", () => {
    const dir = withSessions({
      "2026": { "09": ["20260905-a.md", "20260901-b.md"] },
    });
    expect(countSessions(dir, SINCE)).toBe(2);
  });

  test("does not count a transcript older than the window", () => {
    const dir = withSessions({
      "2026": { "09": ["20260905-a.md"], "01": ["20260102-b.md"] },
    });
    expect(countSessions(dir, SINCE)).toBe(1);
  });

  test("the cutoff day is inside the window", () => {
    const dir = withSessions({ "2026": { "08": ["20260807-a.md", "20260806-b.md"] } });
    expect(countSessions(dir, SINCE)).toBe(1);
  });

  test("does not count files that are not markdown", () => {
    const dir = withSessions({ "2026": { "09": ["20260905-a.md", "20260905-b.txt"] } });
    expect(countSessions(dir, SINCE)).toBe(1);
  });
});

describe("reflectionStats", () => {
  test("an empty window scores zero, not NaN", () => {
    expect(reflectionStats([])).toEqual({ passRate: 0, avgSentiment: 0 });
  });

  test("the pass rate is over all criteria, not per reflection", () => {
    const stats = reflectionStats([
      reflection(1, { criteria_count: 10, criteria_passed: 10 }),
      reflection(2, { criteria_count: 2, criteria_passed: 0 }),
    ]);
    expect(stats.passRate).toBe(83);
  });

  test("reflections with no criteria at all score zero rather than NaN", () => {
    const stats = reflectionStats([
      reflection(1, { criteria_count: 0, criteria_passed: 0 }),
    ]);
    expect(stats.passRate).toBe(0);
  });

  test("averages sentiment to one decimal", () => {
    const stats = reflectionStats([
      reflection(1, { sentiment: 8 }),
      reflection(2, { sentiment: 9 }),
      reflection(3, { sentiment: 9 }),
    ]);
    expect(stats.avgSentiment).toBe(8.7);
  });
});

describe("gatherData", () => {
  function corpus(): { dir: string; sources: Parameters<typeof gatherData>[0] } {
    const dir = tempDir();
    mkdirSync(join(dir, "relationship", "2026-09"), { recursive: true });
    mkdirSync(join(dir, "wisdom"), { recursive: true });
    mkdirSync(join(dir, "session", "2026", "09"), { recursive: true });

    writeFileSync(
      join(dir, "relationship", "opinions.json"),
      JSON.stringify({ opinions: [opinion("verdicts, not surveys", 0.9)] })
    );
    writeFileSync(
      join(dir, "relationship", "2026-09", "2026-09-05.md"),
      [
        "- O(c=0.8): an opinion note",
        "- W: a world fact",
        "- Session: a session note",
      ].join("\n")
    );
    writeFileSync(
      join(dir, "ratings.jsonl"),
      JSON.stringify(rating(8, "2026-09-05T00:00:00.000Z"))
    );
    writeFileSync(join(dir, "wisdom", "engineering.md"), "- a principle [CRYSTAL: 0.9]");
    writeFileSync(
      join(dir, "graduated.json"),
      JSON.stringify({ graduated: [graduated("verify first")] })
    );
    writeFileSync(join(dir, "reflections.jsonl"), JSON.stringify(reflection(5)));
    writeFileSync(join(dir, "session", "2026", "09", "20260905-a.md"), "x");

    return {
      dir,
      sources: {
        opinionsFile: join(dir, "relationship", "opinions.json"),
        ratingsFile: join(dir, "ratings.jsonl"),
        wisdomDir: join(dir, "wisdom"),
        graduatedFile: join(dir, "graduated.json"),
        reflectionsFile: join(dir, "reflections.jsonl"),
        relationshipDir: join(dir, "relationship"),
        sessionDir: join(dir, "session"),
      },
    };
  }

  test("pulls every slice of the corpus into one shape", () => {
    const data = gatherData(corpus().sources, 30, NOW);
    expect(data.days).toBe(30);
    expect(data.now).toBe("2026-09-06");
    expect(data.sessionCount).toBe(1);
    expect(data.opinions.map((o) => o.statement)).toEqual(["verdicts, not surveys"]);
    expect(data.ratings.count).toBe(1);
    expect(data.wisdomFrames).toEqual([
      { domain: "engineering", principles: ["a principle"] },
    ]);
    expect(data.graduated.map((g) => g.pattern)).toEqual(["verify first"]);
    expect(data.reflections.map((r) => r.task)).toEqual(["task 5"]);
  });

  // Session and world notes go to different sections; opinion notes to neither.
  test("splits the relationship notes by type", () => {
    const data = gatherData(corpus().sources, 30, NOW);
    expect(data.behaviorNotes).toEqual(["a session note"]);
    expect(data.wisdomNotes).toEqual(["a world fact"]);
  });

  test("takes the observations from the reflections' first two answers", () => {
    const data = gatherData(corpus().sources, 30, NOW);
    expect(data.selfObservations).toEqual(["self 5"]);
    expect(data.algorithmObservations).toEqual(["algo 5"]);
  });

  test("an empty answer is not an observation", () => {
    const { dir, sources } = corpus();
    writeFileSync(
      join(dir, "reflections.jsonl"),
      [
        JSON.stringify(reflection(4, { q1: "", q2: "" })),
        JSON.stringify(reflection(5)),
      ].join("\n")
    );
    const data = gatherData(sources, 30, NOW);
    expect(data.selfObservations).toEqual(["self 5"]);
    expect(data.algorithmObservations).toEqual(["algo 5"]);
  });

  test("carries the reflection stats through", () => {
    const data = gatherData(corpus().sources, 30, NOW);
    expect(data.passRate).toBe(75);
    expect(data.avgSentiment).toBe(8);
  });

  test("a narrower window drops what falls outside it", () => {
    const data = gatherData(corpus().sources, 0, NOW);
    expect(data.sessionCount).toBe(0);
    expect(data.ratings.count).toBe(0);
    expect(data.reflections).toEqual([]);
    expect(data.behaviorNotes).toEqual([]);
  });

  // Ratings and reflections are cut at the timestamp; sessions and notes only
  // carry a day, so a window that starts midday still admits that whole day.
  test("the day-stamped sources are cut by day, not by the hour", () => {
    const data = gatherData(corpus().sources, 1, NOW);
    expect(data.ratings.count).toBe(0);
    expect(data.reflections).toEqual([]);
    expect(data.sessionCount).toBe(1);
    expect(data.behaviorNotes).toEqual(["a session note"]);
  });

  test("an empty corpus gathers without throwing", () => {
    const dir = tempDir();
    const data = gatherData(
      {
        opinionsFile: join(dir, "a.json"),
        ratingsFile: join(dir, "b.jsonl"),
        wisdomDir: join(dir, "c"),
        graduatedFile: join(dir, "d.json"),
        reflectionsFile: join(dir, "e.jsonl"),
        relationshipDir: join(dir, "f"),
        sessionDir: join(dir, "g"),
      },
      30,
      NOW
    );
    expect(data.opinions).toEqual([]);
    expect(data.sessionCount).toBe(0);
    expect(data.passRate).toBe(0);
  });
});

describe("formatDataForInference", () => {
  const base: SelfModelData = {
    days: 30,
    now: "2026-09-06",
    sessionCount: 0,
    opinions: [],
    ratings: summarizeRatings([], SINCE),
    wisdomFrames: [],
    graduated: [],
    reflections: [],
    behaviorNotes: [],
    wisdomNotes: [],
    selfObservations: [],
    algorithmObservations: [],
    passRate: 0,
    avgSentiment: 0,
  };

  test("an empty corpus is a header and nothing else", () => {
    expect(formatDataForInference(base, "Rico").split("\n")).toEqual([
      "## Raw Data — 30-day window, 2026-09-06",
      "Sessions: 0",
      "Ratings: 0 total, 0/10 avg, recent 0/10, trend stable",
      "0 high (8+), 0 low (<=3)",
    ]);
  });

  test("names the principal in the opinions heading", () => {
    const data = { ...base, opinions: [opinion("a view", 0.9)] };
    expect(formatDataForInference(data, "Ada")).toContain(
      "### Opinions about Ada (confidence-scored)"
    );
  });

  test("renders an opinion as category, statement and percentage", () => {
    const data = { ...base, opinions: [opinion("a view", 0.92, "communication")] };
    expect(formatDataForInference(data, "Rico")).toContain(
      "- [communication] a view (92%)"
    );
  });

  test("0.6 is confident enough and 0.59 is not", () => {
    const data = {
      ...base,
      opinions: [opinion("at the floor", 0.6), opinion("under it", 0.59)],
    };
    const out = formatDataForInference(data, "Rico");
    expect(out).toContain("at the floor");
    expect(out).not.toContain("under it");
  });

  // The heading is keyed to having opinions at all, not to having confident ones.
  test("the heading still prints when every opinion is under the floor", () => {
    const data = { ...base, opinions: [opinion("a hunch", 0.4)] };
    expect(formatDataForInference(data, "Rico").split("\n").at(-1)).toBe(
      "### Opinions about Rico (confidence-scored)"
    );
  });

  test("flattens every frame's principles under one heading", () => {
    const data = {
      ...base,
      wisdomFrames: [
        { domain: "engineering", principles: ["one", "two"] },
        { domain: "writing", principles: ["three"] },
      ],
    };
    expect(formatDataForInference(data, "Rico").split("\n").slice(4)).toEqual([
      "",
      "### Crystallized Principles",
      "- [engineering] one",
      "- [engineering] two",
      "- [writing] three",
    ]);
  });

  test("renders a graduated pattern with its occurrence count", () => {
    const data = { ...base, graduated: [graduated("verify first", 7)] };
    expect(formatDataForInference(data, "Rico")).toContain(
      "- [project] verify first (7x)"
    );
  });

  test("quotes the frustration signals", () => {
    const data = {
      ...base,
      ratings: summarizeRatings(
        [rating(2, "2026-09-01T00:00:00.000Z", "a verbose recap")],
        SINCE
      ),
    };
    expect(formatDataForInference(data, "Rico")).toContain('- "a verbose recap"');
  });

  test("shows the last eight self-observations", () => {
    const data = {
      ...base,
      selfObservations: Array.from({ length: 11 }, (_, i) => `self ${i}`),
    };
    const lines = formatDataForInference(data, "Rico").split("\n").slice(6);
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe("- self 3");
  });

  test("shows the last five algorithm observations", () => {
    const data = {
      ...base,
      algorithmObservations: Array.from({ length: 7 }, (_, i) => `algo ${i}`),
    };
    const lines = formatDataForInference(data, "Rico").split("\n").slice(6);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("- algo 2");
  });

  test("shows the last eight behavioral notes", () => {
    const data = {
      ...base,
      behaviorNotes: Array.from({ length: 12 }, (_, i) => `behavior ${i}`),
    };
    const lines = formatDataForInference(data, "Rico").split("\n").slice(6);
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe("- behavior 4");
  });

  test("shows the last five world notes", () => {
    const data = {
      ...base,
      wisdomNotes: Array.from({ length: 9 }, (_, i) => `world ${i}`),
    };
    const lines = formatDataForInference(data, "Rico").split("\n").slice(6);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("- world 4");
  });

  test("closes with the algorithm performance line when there are reflections", () => {
    const data = {
      ...base,
      reflections: [reflection(1), reflection(2)],
      passRate: 75,
      avgSentiment: 8.5,
    };
    expect(formatDataForInference(data, "Rico").split("\n").at(-1)).toBe(
      "### Algorithm Performance: 75% pass rate, 8.5/10 sentiment, 2 reflections"
    );
  });

  test("renders every section in order when the corpus is full", () => {
    const data: SelfModelData = {
      ...base,
      sessionCount: 20,
      ratings: summarizeRatings(
        [
          rating(2, "2026-09-01T00:00:00.000Z", "bad"),
          rating(9, "2026-09-02T00:00:00.000Z"),
        ],
        SINCE
      ),
      opinions: [opinion("verdicts, not surveys", 0.92, "communication")],
      wisdomFrames: [{ domain: "engineering", principles: ["structure wins"] }],
      graduated: [graduated("verify first")],
      reflections: [reflection(1)],
      behaviorNotes: ["shipped the ledger"],
      wisdomNotes: ["runs Copilot as the CLI"],
      selfObservations: ["I narrated too much"],
      algorithmObservations: ["the plan held"],
      passRate: 75,
      avgSentiment: 8,
    };

    expect(formatDataForInference(data, "Rico").split("\n")).toEqual([
      "## Raw Data — 30-day window, 2026-09-06",
      "Sessions: 20",
      "Ratings: 2 total, 5.5/10 avg, recent 5.5/10, trend stable",
      "1 high (8+), 1 low (<=3)",
      "",
      "### Opinions about Rico (confidence-scored)",
      "- [communication] verdicts, not surveys (92%)",
      "",
      "### Crystallized Principles",
      "- [engineering] structure wins",
      "",
      "### Graduated Failure Patterns",
      "- [project] verify first (3x)",
      "",
      "### Recent Frustration Signals (rated <=3)",
      '- "bad"',
      "",
      "### Self-Observations (Q1 from algorithm reflections)",
      "- I narrated too much",
      "",
      "### Algorithm Observations (Q2 from reflections)",
      "- the plan held",
      "",
      "### Behavioral Notes (from relationship tracking)",
      "- shipped the ledger",
      "",
      "### World/Context Notes",
      "- runs Copilot as the CLI",
      "",
      "### Algorithm Performance: 75% pass rate, 8/10 sentiment, 1 reflections",
    ]);
  });
});

describe("buildPrompt", () => {
  test("casts the model as the assistant by name", () => {
    const prompt = buildPrompt("Jarvis", "Rico");
    expect(prompt).toContain("an AI assistant named Jarvis. You ARE Jarvis");
    expect(prompt).toContain("**# Self-Model — Jarvis**");
  });

  test("names the principal in the section it asks for", () => {
    expect(buildPrompt("Jarvis", "Ada")).toContain("**## Who Ada Is**");
  });

  // The footer is appended after the fact, so asking for one would duplicate it.
  test("forbids the model writing its own footer", () => {
    expect(buildPrompt("Jarvis", "Rico")).toContain("Do not write a footer");
  });
});

describe("previousModelForPrompt", () => {
  test("nothing to compare against yields nothing", () => {
    expect(previousModelForPrompt("")).toBe("");
  });

  test("strips the appended metrics footer", () => {
    const previous =
      "# Self-Model\n\nBody.\n\n*12 ratings · 3 sessions · window: a → b*\n";
    expect(previousModelForPrompt(previous)).toBe("# Self-Model\n\nBody.");
  });

  test("keeps a body that carries no footer", () => {
    expect(previousModelForPrompt("# Self-Model\n\nBody.")).toBe("# Self-Model\n\nBody.");
  });

  // Only the tail is trimmed: whatever the model opened with is its own.
  test("trims the trailing whitespace and leaves the leading alone", () => {
    expect(previousModelForPrompt("\n# Self-Model\n\nBody.  \n")).toBe(
      "\n# Self-Model\n\nBody."
    );
  });

  // The footer is only a footer at the end; the same shape mid-document is body.
  test("leaves a footer-shaped line that is not the footer", () => {
    const previous = "# Self-Model\n\n*12 ratings · 3 sessions*\n\nBody.";
    expect(previousModelForPrompt(previous)).toBe(previous);
  });

  // A fallback is a raw data dump; feeding it back drives the next run into the
  // same timeout that produced it.
  test("drops a failed synthesis rather than feeding it back", () => {
    expect(previousModelForPrompt(failedSynthesisModel("Jarvis", "raw"))).toBe("");
  });
});

describe("inferenceUserContent", () => {
  test("is the raw data alone when there is no previous model", () => {
    expect(inferenceUserContent("RAW", "")).toBe("RAW");
  });

  test("appends the previous model under a comparison heading", () => {
    expect(inferenceUserContent("RAW", "PREV")).toBe(
      "RAW\n\n---\n\n## Previous Self-Model (compare against this — what changed?)\n\nPREV"
    );
  });

  test("a failed synthesis leaves the raw data alone", () => {
    const previous = failedSynthesisModel("Jarvis", "old raw");
    expect(inferenceUserContent("RAW", previous)).toBe("RAW");
  });
});

describe("metaFooter", () => {
  test("carries the numbers the prompt keeps out of the body", () => {
    const data: SelfModelData = {
      days: 30,
      now: "2026-09-06",
      sessionCount: 20,
      opinions: [],
      ratings: { ...summarizeRatings([], SINCE), count: 400 },
      wisdomFrames: [],
      graduated: [],
      reflections: [reflection(1), reflection(2)],
      behaviorNotes: [],
      wisdomNotes: [],
      selfObservations: [],
      algorithmObservations: [],
      passRate: 0,
      avgSentiment: 0,
    };
    expect(metaFooter(data, NOW)).toBe(
      "\n\n*400 ratings · 20 sessions · 2 reflections · window: 2026-08-07 → 2026-09-06*"
    );
  });
});

describe("failedSynthesisModel", () => {
  test("marks itself so the next run does not read it as a model", () => {
    const fallback = failedSynthesisModel("Jarvis", "RAW");
    expect(fallback).toBe(`# Self-Model — Jarvis\n*${FAILED_SYNTHESIS}*\n\nRAW`);
    expect(previousModelForPrompt(fallback)).toBe("");
  });
});
