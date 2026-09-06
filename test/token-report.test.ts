import { describe, expect, test } from "bun:test";
import {
  detailedLine,
  fmt,
  fmtCost,
  parseRtkSummary,
  type RtkGain,
  rowLine,
  rtkLines,
  usageLines,
} from "../src/tools/lib/token-report";
import {
  addToBucket,
  type Bucket,
  type ClaudeCodeUsage,
  emptyBucket,
  emptyTimeBuckets,
  type PalInferenceUsage,
  type TimeBuckets,
} from "../src/tools/lib/usage-buckets";

const tokens = (input: number, output: number, cw5m = 0, cw1h = 0, cr = 0) => ({
  input,
  output,
  cacheWrite5m: cw5m,
  cacheWrite1h: cw1h,
  cacheRead: cr,
});

function bucketOf(model: string, scale: number): Bucket {
  const bucket = emptyBucket();
  addToBucket(bucket, model, tokens(scale, scale * 2, scale, scale, scale));
  return bucket;
}

function timeBucketsOf(model: string, scale: number): TimeBuckets {
  const buckets = emptyTimeBuckets();
  for (const window of [buckets.today, buckets.week, buckets.month, buckets.total]) {
    addToBucket(window, model, tokens(scale, scale * 2));
  }
  return buckets;
}

const NO_RTK: RtkGain = { installed: false, summary: null };

const EMPTY_CC: ClaudeCodeUsage = {
  buckets: emptyTimeBuckets(),
  byModel: {},
  byProject: {},
};

const EMPTY_PAL: PalInferenceUsage = {
  buckets: emptyTimeBuckets(),
  byModel: {},
  byCaller: {},
};

const find = (lines: string[], text: string) => lines.find((l) => l.includes(text));

describe("fmt", () => {
  test("abbreviates millions to one decimal", () => {
    expect(fmt(2_400_000)).toBe("2.4M");
  });

  test("abbreviates thousands to one decimal", () => {
    expect(fmt(15_300)).toBe("15.3k");
  });

  test("groups a plain number with separators", () => {
    expect(fmt(999)).toBe("999");
  });

  test("switches to k exactly at a thousand", () => {
    expect(fmt(1_000)).toBe("1.0k");
    expect(fmt(999)).toBe("999");
  });

  test("switches to M exactly at a million", () => {
    expect(fmt(1_000_000)).toBe("1.0M");
    expect(fmt(999_999)).toBe("1000.0k");
  });
});

describe("fmtCost", () => {
  test("shows two decimals from a dollar up", () => {
    expect(fmtCost(12.345)).toBe("$12.35");
    expect(fmtCost(1)).toBe("$1.00");
  });

  test("shows four decimals below a dollar, where two would read as zero", () => {
    expect(fmtCost(0.0042)).toBe("$0.0042");
    expect(fmtCost(0.9999)).toBe("$0.9999");
  });
});

describe("rowLine", () => {
  test("carries the label, the token total, the calls and the cost", () => {
    const bucket = emptyBucket();
    addToBucket(bucket, "claude-opus-5", tokens(1_000, 2_000, 3_000, 4_000, 5_000));
    const line = rowLine("Today", bucket);
    expect(line).toContain("Today");
    expect(line).toContain("15.0k tok");
    expect(line).toContain("1 calls");
    expect(line).toContain("$");
  });

  test("pads the label to the width it is given", () => {
    expect(rowLine("x", emptyBucket(), 6)).toStartWith("  x     ");
  });
});

describe("detailedLine", () => {
  test("breaks the tokens out into all five fields", () => {
    const bucket = emptyBucket();
    addToBucket(bucket, "claude-opus-5", tokens(1, 2, 3, 4, 5));
    const line = detailedLine("opus-5", bucket);
    expect(line).toContain("1 in");
    expect(line).toContain("2 out");
    expect(line).toContain("3 cw5m");
    expect(line).toContain("4 cw1h");
    expect(line).toContain("5 cr");
  });
});

describe("rtkLines", () => {
  test("always heads its own section", () => {
    expect(rtkLines(NO_RTK)[0]).toBe("\n  rtk Compression\n");
  });

  test("says so when rtk is not on PATH", () => {
    expect(rtkLines(NO_RTK)[1]).toBe("  rtk not installed");
  });

  test("distinguishes installed-but-empty from not installed", () => {
    expect(rtkLines({ installed: true, summary: null })[1]).toBe(
      "  rtk installed — no savings recorded yet"
    );
  });

  test("treats zero recorded commands as no data, not as a zero result", () => {
    const gain: RtkGain = {
      installed: true,
      summary: { total_commands: 0, total_saved: 0, avg_savings_pct: 0 },
    };
    expect(rtkLines(gain)[1]).toContain("no savings recorded yet");
  });

  test("reports savings, percentage and command count when there is data", () => {
    const gain: RtkGain = {
      installed: true,
      summary: { total_commands: 4211, total_saved: 8_412_339, avg_savings_pct: 61.27 },
    };
    const line = rtkLines(gain)[1];
    expect(line).toContain("8.4M tok");
    expect(line).toContain("61.3% avg");
    expect(line).toContain("across 4.2k commands");
  });
});

describe("parseRtkSummary", () => {
  test("reads the summary out of a clean run", () => {
    const json = JSON.stringify({
      summary: { total_commands: 3, total_saved: 90, avg_savings_pct: 12.5 },
    });
    expect(parseRtkSummary(0, json)?.total_commands).toBe(3);
  });

  test("returns null when rtk exited non-zero", () => {
    expect(parseRtkSummary(1, '{"summary":{"total_commands":3}}')).toBeNull();
  });

  test("returns null when rtk was killed and left no status", () => {
    expect(parseRtkSummary(null, '{"summary":{"total_commands":3}}')).toBeNull();
  });

  test("returns null on empty stdout", () => {
    expect(parseRtkSummary(0, "")).toBeNull();
  });

  test("returns null on unparseable stdout", () => {
    expect(parseRtkSummary(0, "not json")).toBeNull();
  });

  test("returns null when the payload carries no summary", () => {
    expect(parseRtkSummary(0, '{"other":1}')).toBeNull();
  });
});

describe("usageLines", () => {
  test("always opens with the Claude Code section and its four windows", () => {
    const lines = usageLines(EMPTY_CC, EMPTY_PAL, NO_RTK);
    expect(lines[0]).toBe("\n  Claude Code Usage\n");
    expect(lines[1]).toContain("Today");
    expect(lines[2]).toContain("7d");
    expect(lines[3]).toContain("30d");
    expect(lines[4]).toContain("Total");
  });

  // The exact count is what pins "omits": a section that returned a placeholder
  // instead of nothing would still not contain the heading it was asked about.
  test("with nothing recorded, emits the four windows, rtk and the total — and nothing else", () => {
    expect(usageLines(EMPTY_CC, EMPTY_PAL, NO_RTK)).toEqual([
      "\n  Claude Code Usage\n",
      rowLine("Today", emptyBucket()),
      rowLine("7d", emptyBucket()),
      rowLine("30d", emptyBucket()),
      rowLine("Total", emptyBucket()),
      "\n  rtk Compression\n",
      "  rtk not installed",
      "\n  Grand Total: $0.0000\n",
    ]);
  });

  test("omits the model section when nothing was recorded", () => {
    const lines = usageLines(EMPTY_CC, EMPTY_PAL, NO_RTK);
    expect(find(lines, "By Model")).toBeUndefined();
  });

  test("shows the model section, costliest model first", () => {
    const cc: ClaudeCodeUsage = {
      ...EMPTY_CC,
      byModel: {
        "claude-haiku-4-5-20251001": bucketOf("claude-haiku-4-5-20251001", 1_000),
        "claude-opus-5": bucketOf("claude-opus-5", 1_000),
      },
    };
    const lines = usageLines(cc, EMPTY_PAL, NO_RTK);
    const heading = lines.findIndex((l) => l.includes("By Model (all time)"));
    expect(heading).toBeGreaterThan(-1);
    expect(lines[heading + 1]).toContain("opus-5");
    expect(lines[heading + 2]).toContain("haiku-4-5");
  });

  test("strips the claude- prefix from a model name", () => {
    const bucket = bucketOf("claude-opus-5", 10);
    const cc: ClaudeCodeUsage = { ...EMPTY_CC, byModel: { "claude-opus-5": bucket } };
    const line = find(usageLines(cc, EMPTY_PAL, NO_RTK), " in  ") as string;
    expect(line).toStartWith("  opus-5 ");
  });

  // A short name keeps the default width; a long one takes its own length plus
  // two, so the column never collides with the numbers beside it.
  test("holds the default column width for a name that fits", () => {
    const bucket = bucketOf("claude-opus-5", 10);
    const cc: ClaudeCodeUsage = { ...EMPTY_CC, byModel: { "claude-opus-5": bucket } };
    const line = find(usageLines(cc, EMPTY_PAL, NO_RTK), " in  ");
    expect(line).toBe(detailedLine("opus-5", bucket, 14));
  });

  test("widens the model column for a name longer than the default", () => {
    const long = "claude-a-very-long-model-identifier-9";
    const bucket = bucketOf(long, 1);
    const cc: ClaudeCodeUsage = { ...EMPTY_CC, byModel: { [long]: bucket } };
    const line = find(usageLines(cc, EMPTY_PAL, NO_RTK), "a-very-long");
    expect(line).toBe(detailedLine("a-very-long-model-identifier-9", bucket, 32));
  });

  test("omits the project section for a single project — it says nothing new", () => {
    const cc: ClaudeCodeUsage = {
      ...EMPTY_CC,
      byProject: { pal: timeBucketsOf("claude-opus-5", 10) },
    };
    const lines = usageLines(cc, EMPTY_PAL, NO_RTK);
    expect(find(lines, "By Project")).toBeUndefined();
    expect(lines).toHaveLength(usageLines(EMPTY_CC, EMPTY_PAL, NO_RTK).length);
  });

  test("shows the project section from two projects up, costliest first", () => {
    const cc: ClaudeCodeUsage = {
      ...EMPTY_CC,
      byProject: {
        cheap: timeBucketsOf("claude-haiku-4-5-20251001", 10),
        dear: timeBucketsOf("claude-opus-5", 10_000),
      },
    };
    const lines = usageLines(cc, EMPTY_PAL, NO_RTK);
    const heading = lines.findIndex((l) => l.includes("By Project (all time)"));
    expect(heading).toBeGreaterThan(-1);
    expect(lines[heading + 1]).toContain("dear");
    expect(lines[heading + 2]).toContain("cheap");
  });

  test("names a PAL inference section after the model family", () => {
    const pal: PalInferenceUsage = {
      ...EMPTY_PAL,
      byModel: {
        "claude-haiku-4-5-20251001": timeBucketsOf("claude-haiku-4-5-20251001", 10),
        "claude-sonnet-5": timeBucketsOf("claude-sonnet-5", 10),
        "gpt-mystery": timeBucketsOf("gpt-mystery", 10),
      },
    };
    const lines = usageLines(EMPTY_CC, pal, NO_RTK);
    expect(find(lines, "PAL Inference (Haiku)")).toBeDefined();
    expect(find(lines, "PAL Inference (Sonnet)")).toBeDefined();
    expect(find(lines, "PAL Inference (gpt-mystery)")).toBeDefined();
  });

  // A model with no family name still loses the vendor prefix, which is the only
  // case where the fallback branch does any work at all.
  test("falls back to the bare model name, prefix stripped", () => {
    const pal: PalInferenceUsage = {
      ...EMPTY_PAL,
      byModel: { "claude-opus-5": timeBucketsOf("claude-opus-5", 10) },
    };
    expect(usageLines(EMPTY_CC, pal, NO_RTK)).toContain("\n  PAL Inference (opus-5)\n");
  });

  test("skips a PAL model that made no calls", () => {
    const pal: PalInferenceUsage = {
      ...EMPTY_PAL,
      byModel: { "claude-haiku-4-5-20251001": emptyTimeBuckets() },
    };
    expect(find(usageLines(EMPTY_CC, pal, NO_RTK), "PAL Inference")).toBeUndefined();
  });

  test("gives a PAL inference section the same four windows", () => {
    const pal: PalInferenceUsage = {
      ...EMPTY_PAL,
      byModel: { "claude-haiku-4-5-20251001": timeBucketsOf("claude-haiku-4-5", 10) },
    };
    const lines = usageLines(EMPTY_CC, pal, NO_RTK);
    const heading = lines.findIndex((l) => l.includes("PAL Inference"));
    expect(
      lines.slice(heading + 1, heading + 5).map((l) => l.trim().split(" ")[0])
    ).toEqual(["Today", "7d", "30d", "Total"]);
  });

  test("always ends with the grand total", () => {
    const lines = usageLines(EMPTY_CC, EMPTY_PAL, NO_RTK);
    expect(lines[lines.length - 1]).toBe("\n  Grand Total: $0.0000\n");
  });

  test("the grand total adds PAL inference to Claude Code, not just one of them", () => {
    const cc: ClaudeCodeUsage = {
      ...EMPTY_CC,
      buckets: timeBucketsOf("claude-opus-5", 1e6),
    };
    const pal: PalInferenceUsage = {
      ...EMPTY_PAL,
      buckets: timeBucketsOf("claude-opus-5", 1e6),
    };

    const expected = cc.buckets.total.cost + pal.buckets.total.cost;
    expect(expected).toBeGreaterThan(1);
    expect(usageLines(cc, pal, NO_RTK).at(-1)).toBe(
      `\n  Grand Total: ${fmtCost(expected)}\n`
    );
  });

  test("puts the rtk section between PAL inference and the grand total", () => {
    const lines = usageLines(EMPTY_CC, EMPTY_PAL, NO_RTK);
    const rtk = lines.findIndex((l) => l.includes("rtk Compression"));
    expect(rtk).toBe(lines.length - 3);
  });
});
