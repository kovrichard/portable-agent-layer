import { describe, expect, test } from "bun:test";
import {
  cutoffCount,
  groupTotals,
  type Options,
  parseArgs,
  parseRows,
  rankUnits,
  report,
  shapeOf,
} from "../assets/skills/pareto-analyze/tools/pareto";

const TIMINGS = `file,seconds,spawns
a.test.ts,50,yes
b.test.ts,5,no
c.test.ts,30,yes
d.test.ts,10,
e.test.ts,5,no
`;

function optionsFor(...flags: string[]): Options {
  return parseArgs(["timings.csv", "--unit", "file", "--value", "seconds", ...flags]);
}

function timings() {
  return parseRows("timings.csv", TIMINGS);
}

describe("pareto parseArgs", () => {
  test("defaults to unit and value columns, an 80% cut-off and 30 rows", () => {
    expect(parseArgs(["data.csv"])).toEqual({
      file: "data.csv",
      unitColumn: "unit",
      valueColumn: "value",
      groupBy: [],
      cutoffPercent: 80,
      limit: 30,
    });
  });

  test("collects every --group-by in order", () => {
    const options = optionsFor("--group-by", "spawns", "--group-by", "directory");
    expect(options.groupBy).toEqual(["spawns", "directory"]);
  });

  test("reads --cutoff and --limit as numbers", () => {
    const options = optionsFor("--cutoff", "90", "--limit", "5");
    expect(options.cutoffPercent).toBe(90);
    expect(options.limit).toBe(5);
  });

  test("refuses a missing file, a second file and an unknown flag", () => {
    expect(() => parseArgs([])).toThrow(/Usage:/);
    expect(() => parseArgs(["a.csv", "b.csv"])).toThrow(/Usage:/);
    expect(() => parseArgs(["a.csv", "--sort", "asc"])).toThrow();
  });

  test.each(["0", "101", "-5", "eighty", ""])("refuses --cutoff %p", (cutoff) => {
    expect(() => parseArgs(["a.csv", "--cutoff", cutoff])).toThrow(/--cutoff/);
  });

  test("accepts a cut-off of exactly 100 and a limit of 0", () => {
    const options = parseArgs(["a.csv", "--cutoff", "100", "--limit", "0"]);
    expect(options.cutoffPercent).toBe(100);
    expect(options.limit).toBe(0);
  });

  test("refuses a negative --limit", () => {
    expect(() => parseArgs(["a.csv", "--limit", "-1"])).toThrow(/--limit/);
  });
});

describe("pareto parseRows", () => {
  test("reads a CSV header and its rows", () => {
    expect(parseRows("x.csv", "unit,value\na,1\nb,2\n")).toEqual([
      { unit: "a", value: "1" },
      { unit: "b", value: "2" },
    ]);
  });

  test("keeps commas, quotes and line breaks inside a quoted field", () => {
    const rows = parseRows("x.csv", 'unit,value\n"Pine, Reed ""and"" Co\nLtd",7');
    expect(rows).toEqual([{ unit: 'Pine, Reed "and" Co\nLtd', value: "7" }]);
  });

  test("accepts CRLF line ends, a byte-order mark and blank lines", () => {
    const rows = parseRows("x.csv", "﻿unit,value\r\na,1\r\n\r\nb,2\r\n");
    expect(rows).toEqual([
      { unit: "a", value: "1" },
      { unit: "b", value: "2" },
    ]);
  });

  test("trims unquoted cells", () => {
    expect(parseRows("x.csv", "unit, value\n a , 3 \n")).toEqual([
      { unit: "a", value: "3" },
    ]);
  });

  test("names the record whose cell count differs from the header", () => {
    expect(() => parseRows("x.csv", "unit,value\na,1\nb,2,3\n")).toThrow(
      "CSV record 3 has 3 cells, the header has 2"
    );
  });

  test("refuses an unclosed quote", () => {
    expect(() => parseRows("x.csv", 'unit,value\n"a,1\n')).toThrow(/Malformed CSV/);
  });

  test("refuses a file with a header and no rows", () => {
    expect(() => parseRows("x.csv", "unit,value\n")).toThrow("x.csv holds no data rows");
    expect(() => parseRows("x.csv", "")).toThrow("x.csv holds no data rows");
  });

  test("reads a JSON array of objects, turning numbers and nulls into text", () => {
    const rows = parseRows("x.JSON", '[{"unit":"a","value":1.5,"trait":null}]');
    expect(rows).toEqual([{ unit: "a", value: "1.5", trait: "" }]);
  });

  test("refuses JSON that is invalid or not an array of objects", () => {
    expect(() => parseRows("x.json", "{")).toThrow(/Invalid JSON/);
    expect(() => parseRows("x.json", '{"unit":"a"}')).toThrow(/array of objects/);
    expect(() => parseRows("x.json", "[1, 2]")).toThrow(/array of objects/);
    expect(() => parseRows("x.json", "[null]")).toThrow(/array of objects/);
  });
});

describe("pareto rankUnits", () => {
  test("sorts by value, largest first, with share and cumulative share", () => {
    const ranked = rankUnits(timings(), optionsFor());
    expect(
      ranked.map((unit) => [unit.name, unit.value, unit.share, unit.cumulative])
    ).toEqual([
      ["a.test.ts", 50, 50, 50],
      ["c.test.ts", 30, 30, 80],
      ["d.test.ts", 10, 10, 90],
      ["b.test.ts", 5, 5, 95],
      ["e.test.ts", 5, 5, 100],
    ]);
  });

  test("sums rows that name the same unit and counts them in n", () => {
    const rows = parseRows("log.csv", "item,kcal\nbar,500\ncola,140\nbar,500\n");
    const [first, second] = rankUnits(
      rows,
      parseArgs(["log.csv", "--unit", "item", "--value", "kcal"])
    );
    expect([first?.name, first?.n, first?.value]).toEqual(["bar", 2, 1000]);
    expect([second?.name, second?.n, second?.value]).toEqual(["cola", 1, 140]);
  });

  test("files a row without a unit name under (unknown)", () => {
    const rows = parseRows("x.csv", "unit,value\n,4\na,1\n");
    expect(rankUnits(rows, parseArgs(["x.csv"]))[0]?.name).toBe("(unknown)");
  });

  test("names the available columns when one is missing", () => {
    expect(() => rankUnits(timings(), parseArgs(["timings.csv"]))).toThrow(
      'No column "unit". Columns: file, seconds, spawns'
    );
    expect(() => rankUnits(timings(), optionsFor("--value", "ms"))).toThrow(
      'No column "ms"'
    );
  });

  test("refuses a value that is blank or not a number, naming the row", () => {
    const blank = parseRows("x.csv", "unit,value\na,1\nb,\n");
    expect(() => rankUnits(blank, parseArgs(["x.csv"]))).toThrow(/Row 2: ""/);
    const words = parseRows("x.csv", "unit,value\na,fast\n");
    expect(() => rankUnits(words, parseArgs(["x.csv"]))).toThrow(/Row 1: "fast"/);
  });

  test("refuses a negative value", () => {
    const rows = parseRows("x.csv", "unit,value\na,5\nb,-1\n");
    expect(() => rankUnits(rows, parseArgs(["x.csv"]))).toThrow(
      /Row 2: negative value -1/
    );
  });

  test("refuses a total of zero and accepts a single zero among values", () => {
    const zeros = parseRows("x.csv", "unit,value\na,0\nb,0\n");
    expect(() => rankUnits(zeros, parseArgs(["x.csv"]))).toThrow(/nothing to rank/);
    const mixed = parseRows("x.csv", "unit,value\na,0\nb,4\n");
    expect(rankUnits(mixed, parseArgs(["x.csv"])).map((unit) => unit.share)).toEqual([
      100, 0,
    ]);
  });
});

describe("pareto cutoffCount", () => {
  const cumulative = [50, 80, 90, 95, 100].map((value) => ({ cumulative: value }));

  test("counts the units up to the first one that reaches the cut-off", () => {
    expect(cutoffCount(cumulative, 80)).toBe(2);
    expect(cutoffCount(cumulative, 81)).toBe(3);
    expect(cutoffCount(cumulative, 50)).toBe(1);
    expect(cutoffCount(cumulative, 100)).toBe(5);
  });

  test("treats a cumulative share a rounding error below the cut-off as reaching it", () => {
    expect(
      cutoffCount([{ cumulative: 79.99999999999999 }, { cumulative: 100 }], 80)
    ).toBe(1);
  });

  test("returns every unit when none reaches the cut-off", () => {
    expect(cutoffCount([{ cumulative: 40 }, { cumulative: 70 }], 80)).toBe(2);
  });
});

describe("pareto shapeOf", () => {
  test("is concentrated up to a third of the units", () => {
    expect(shapeOf(1, 5)).toBe("concentrated");
    expect(shapeOf(2, 6)).toBe("concentrated");
  });

  test("is weak above a third and up to half of the units", () => {
    expect(shapeOf(2, 5)).toBe("weak");
    expect(shapeOf(3, 6)).toBe("weak");
  });

  test("is flat above half of the units", () => {
    expect(shapeOf(4, 6)).toBe("flat");
    expect(shapeOf(8, 10)).toBe("flat");
  });
});

describe("pareto groupTotals", () => {
  test("totals each trait value, counts its units in the top set, and files blanks under (unknown)", () => {
    const ranked = rankUnits(timings(), optionsFor());
    expect(groupTotals(ranked, "spawns", 2)).toEqual([
      { name: "yes", units: 2, inCutoff: 2, value: 80, share: 80, cumulative: 80 },
      { name: "(unknown)", units: 1, inCutoff: 0, value: 10, share: 10, cumulative: 90 },
      { name: "no", units: 2, inCutoff: 0, value: 10, share: 10, cumulative: 100 },
    ]);
  });

  test("files a unit whose rows disagree on the trait under (mixed)", () => {
    const rows = parseRows(
      "log.csv",
      "unit,value,time\nbar,500,evening\nbar,500,morning\ncola,140,evening\n"
    );
    const groups = groupTotals(rankUnits(rows, parseArgs(["log.csv"])), "time", 1);
    expect(groups.map((group) => [group.name, group.value, group.inCutoff])).toEqual([
      ["(mixed)", 1000, 1],
      ["evening", 140, 0],
    ]);
  });
});

describe("pareto report", () => {
  test("prints the ranked table, the cut-off marker, the summary and the shape", () => {
    expect(report(timings(), optionsFor())).toBe(
      [
        "| # | file | n | seconds | share | cumulative | cut-off |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | a.test.ts | 1 | 50 | 50.0% | 50.0% |  |",
        "| 2 | c.test.ts | 1 | 30 | 30.0% | 80.0% | <-- 80% |",
        "| 3 | d.test.ts | 1 | 10 | 10.0% | 90.0% |  |",
        "| 4 | b.test.ts | 1 | 5 | 5.0% | 95.0% |  |",
        "| 5 | e.test.ts | 1 | 5 | 5.0% | 100.0% |  |",
        "",
        "Total seconds: 100 across 5 units (5 rows).",
        "Cut-off: 2 of 5 units (40.0% of units) reach 80.0% of the total (target 80%).",
        "Shape: weak.",
      ].join("\n")
    );
  });

  test("moves the cut-off with --cutoff", () => {
    const text = report(timings(), optionsFor("--cutoff", "50"));
    expect(text).toContain("| 1 | a.test.ts | 1 | 50 | 50.0% | 50.0% | <-- 50% |");
    expect(text).toContain("Cut-off: 1 of 5 units (20.0% of units) reach 50.0%");
    expect(text).toContain("Shape: concentrated.");
  });

  test("collapses the rows past --limit into one row that carries their sum", () => {
    const text = report(timings(), optionsFor("--limit", "2"));
    expect(text).toContain("|  | (remaining 3 units) | 3 | 20 | 20.0% | 100.0% |  |");
    expect(text).not.toContain("d.test.ts");
  });

  test("prints every row with --limit 0", () => {
    const text = report(timings(), optionsFor("--limit", "0"));
    expect(text).toContain("e.test.ts");
    expect(text).not.toContain("remaining");
  });

  test("adds a table and the unknown share for each --group-by", () => {
    const text = report(timings(), optionsFor("--group-by", "spawns"));
    expect(text).toEndWith(
      [
        "Grouped by `spawns`:",
        "",
        "| spawns | units | units in top set | value | share | cumulative |",
        "| --- | --- | --- | --- | --- | --- |",
        "| yes | 2 | 2 | 80 | 80.0% | 80.0% |",
        "| (unknown) | 1 | 0 | 10 | 10.0% | 90.0% |",
        "| no | 2 | 0 | 10 | 10.0% | 100.0% |",
        "",
        "Unknown share for `spawns`: 10.0%",
      ].join("\n")
    );
  });

  test("refuses a --group-by column the file does not have", () => {
    expect(() => report(timings(), optionsFor("--group-by", "owner"))).toThrow(
      'No column "owner"'
    );
  });

  test("carries an evidence column into the table, joining what merged rows disagree on", () => {
    const rows = parseRows(
      "x.csv",
      "unit,value,evidence\na,6,measured: log\na,2,estimated: study\nb,2,\n"
    );
    const text = report(rows, parseArgs(["x.csv"]));
    expect(text).toContain(
      "| # | unit | n | value | share | cumulative | cut-off | evidence |"
    );
    expect(text).toContain(
      "| 1 | a | 2 | 8 | 80.0% | 80.0% | <-- 80% | measured: log; estimated: study |"
    );
    expect(text).toContain("| 2 | b | 1 | 2 | 20.0% | 100.0% |  |  |");
  });

  test("escapes a pipe inside a cell and rounds values to two decimals", () => {
    const rows = parseRows("x.csv", "unit,value\na|b,1.005\nc,2.129\n");
    const text = report(rows, parseArgs(["x.csv"]));
    expect(text).toContain("| 1 | c | 1 | 2.13 |");
    expect(text).toContain("| 2 | a\\|b | 1 |");
    expect(text).toContain("Total value: 3.13 across 2 units");
  });
});
