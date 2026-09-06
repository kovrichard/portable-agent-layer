import { describe, expect, test } from "bun:test";
import type { AnalysisResult } from "../src/hooks/lib/graduation";
import { reportLines } from "../src/tools/lib/analyze-report";

// The report `pal cli analyze` prints. It was written straight into console.log
// inside a spawned tool, so nothing it decides — which colour an average earns,
// whether an entry came from a failure or a learning, what is shown when there
// is nothing to show — could be read back.

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

function entry(
  source: string,
  over: Partial<{ text: string; date: string; path: string }> = {}
) {
  return {
    source,
    path: "memory/failures/f1.md",
    text: "something happened",
    date: "2026-05-04",
    ...over,
  };
}

function result(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    candidates: [],
    emerging: [],
    graduated: [],
    ratings: null,
    recommendations: [],
    ...over,
  } as AnalysisResult;
}

function ratings(
  average: number,
  over: Partial<{ total: number; low: number; high: number }> = {}
) {
  return {
    total: over.total ?? 40,
    average,
    low: { count: over.low ?? 3, examples: [] },
    high: { count: over.high ?? 9, examples: [] },
  };
}

function group(domain: string, sources: string[]) {
  return { pattern: `p-${domain}`, domain, entries: sources.map((s) => entry(s)) };
}

/** One string, for asking whether a section is present at all. */
function rendered(over: Partial<AnalysisResult> = {}): string {
  return reportLines(result(over)).join("\n");
}

describe("when there is nothing to report", () => {
  test("says so once, rather than printing empty headings", () => {
    expect(reportLines(result())).toEqual(["\n  No patterns or ratings data found.\n"]);
  });

  // Ratings alone are worth a report: they are the trend line even with no
  // pattern yet recurring often enough to name.
  test("ratings with no patterns are still a report", () => {
    const lines = reportLines(result({ ratings: ratings(6) }));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Ratings:");
  });

  test("patterns with no ratings are still a report", () => {
    expect(
      rendered({ emerging: [group("workflow", ["learning:a", "learning:b"])] })
    ).toContain("Emerging");
  });
});

describe("the ratings line", () => {
  test("carries the average, the total, and both counts", () => {
    const line = rendered({ ratings: ratings(5.94, { total: 40, low: 12, high: 9 }) });
    expect(line).toContain("5.9/10");
    expect(line).toContain("(40 total)");
    expect(line).toContain("Low (≤4): 12");
    expect(line).toContain("High (≥7): 9");
  });

  // The colour is the whole signal at a glance, and the boundaries are the
  // same ones the low/high counts use.
  test("is green from 7 up", () => {
    expect(rendered({ ratings: ratings(7) })).toContain(`${GREEN}7.0/10`);
    expect(rendered({ ratings: ratings(9.5) })).toContain(`${GREEN}9.5/10`);
  });

  test("is red at 4 and below", () => {
    expect(rendered({ ratings: ratings(4) })).toContain(`${RED}4.0/10`);
    expect(rendered({ ratings: ratings(1.2) })).toContain(`${RED}1.2/10`);
  });

  test("is amber in the band between them", () => {
    expect(rendered({ ratings: ratings(4.1) })).toContain(`${YELLOW}4.1/10`);
    expect(rendered({ ratings: ratings(6.9) })).toContain(`${YELLOW}6.9/10`);
  });

  test("shows one decimal, so 5.94 does not read as 5.94", () => {
    expect(rendered({ ratings: ratings(5.94) })).not.toContain("5.94");
  });
});

describe("graduation candidates", () => {
  const CANDIDATES = { candidates: [group("development", ["failure:a", "learning:b"])] };

  test("count the patterns in the header, not the entries", () => {
    expect(rendered(CANDIDATES)).toContain("Graduation Report — 1 pattern(s) detected");
  });

  test("name the domain and how many times it occurred", () => {
    const line = rendered(CANDIDATES);
    expect(line).toContain("[development]");
    expect(line).toContain("2x");
    expect(line).toContain("occurrences");
  });

  // The tag is how a reader tells a thing that went wrong from a thing that was
  // learned, and the two are coloured apart for the same reason.
  test("tag a failure and a learning differently", () => {
    const line = rendered(CANDIDATES);
    expect(line).toContain(`${RED}[failure]`);
    expect(line).toContain(`${YELLOW}[learning]`);
  });

  test("read the kind off the source prefix, not off the path", () => {
    const line = rendered({
      candidates: [
        {
          pattern: "p",
          domain: "d",
          entries: [entry("learning:x", { path: "memory/failures/f.md" })],
        },
      ],
    });
    expect(line).toContain("[learning]");
    expect(line).not.toContain("[failure]");
  });

  test("say where the entries came from, under a labelled list", () => {
    const lines = reportLines(result(CANDIDATES));
    const label = lines.findIndex((line) => line.includes("Files:"));
    expect(label).toBeGreaterThan(-1);
    expect(lines[label + 1]).toContain("memory/failures/f1.md");
  });

  test("point at the frame the pattern would graduate into", () => {
    expect(rendered(CANDIDATES)).toContain("memory/wisdom/frames/development.md");
  });

  test("close with how to crystallize one", () => {
    expect(rendered(CANDIDATES)).toContain("To crystallize");
  });

  // That closing instruction is about candidates, so it has no place in a
  // report that found none.
  test("and that instruction is absent when there are no candidates", () => {
    expect(rendered({ ratings: ratings(6) })).not.toContain("To crystallize");
  });

  test("an entry with no date says so rather than leaving a gap", () => {
    const line = rendered({
      candidates: [
        { pattern: "p", domain: "d", entries: [entry("failure:a", { date: "" })] },
      ],
    });
    expect(line).toContain("unknown");
  });

  test("truncate a long entry at 100 characters", () => {
    const text = "y".repeat(150);
    const line = rendered({
      candidates: [
        { pattern: "p", domain: "d", entries: [entry("failure:a", { text })] },
      ],
    });
    expect(line).toContain("y".repeat(100));
    expect(line).not.toContain("y".repeat(101));
  });
});

describe("emerging patterns", () => {
  const EMERGING = { emerging: [group("workflow", ["learning:a", "learning:b"])] };

  test("are headed as one short of graduating", () => {
    expect(rendered(EMERGING)).toContain("Emerging (2x — one more to graduate)");
  });

  // Checked on its own line: the section heading also says "2x", so a report-wide
  // search for it passes even when the group's own count is missing.
  test("name their domain and count on the group's own line", () => {
    const lines = reportLines(result(EMERGING));
    const groupLine = lines.find((line) => line.includes("[workflow]"));
    expect(groupLine).toContain("2x");
  });

  test("list their files too, under a labelled list", () => {
    const lines = reportLines(result(EMERGING));
    const label = lines.findIndex((line) => line.includes("Files:"));
    expect(label).toBeGreaterThan(-1);
    expect(lines[label + 1]).toContain("memory/failures/f1.md");
  });

  // Shorter than a candidate's 100: an emerging pattern is a heads-up, not a
  // thing being acted on yet.
  test("truncate an entry at 80 characters, not 100", () => {
    const text = "z".repeat(150);
    const line = rendered({
      emerging: [{ pattern: "p", domain: "d", entries: [entry("failure:a", { text })] }],
    });
    expect(line).toContain("z".repeat(80));
    expect(line).not.toContain("z".repeat(81));
  });

  test("do not earn the graduation header", () => {
    expect(rendered(EMERGING)).not.toContain("Graduation Report");
  });
});

describe("recommendations", () => {
  test("are listed under their own heading", () => {
    const line = rendered({
      ratings: ratings(6),
      recommendations: ["Do the thing", "Then the other"],
    });
    expect(line).toContain("Recommendations:");
    expect(line).toContain("Do the thing");
    expect(line).toContain("Then the other");
  });

  test("the heading is absent when there are none", () => {
    expect(rendered({ ratings: ratings(6) })).not.toContain("Recommendations:");
  });
});

describe("the whole report", () => {
  test("orders its sections: ratings, graduation, emerging, recommendations", () => {
    const line = rendered({
      ratings: ratings(6),
      candidates: [group("development", ["failure:a"])],
      emerging: [group("workflow", ["learning:b"])],
      recommendations: ["Do the thing"],
    });
    const at = (needle: string) => line.indexOf(needle);
    expect(at("Ratings:")).toBeLessThan(at("Graduation Report"));
    expect(at("Graduation Report")).toBeLessThan(at("Emerging"));
    expect(at("Emerging")).toBeLessThan(at("Recommendations:"));
  });
});
