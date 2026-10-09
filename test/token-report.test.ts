import { describe, expect, test } from "bun:test";
import {
  costLabel,
  detailedLine,
  fmt,
  fmtCost,
  modelLabel,
  parseRtkSummary,
  type RtkGain,
  rowLine,
  rtkLines,
  type UsageData,
  usageLines,
} from "../src/tools/lib/token-report";
import {
  type AgentUsage,
  addToBucket,
  type Bucket,
  emptyBucket,
  emptyTimeBuckets,
  grandTotal,
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

const EMPTY_CC: AgentUsage = {
  buckets: emptyTimeBuckets(),
  byModel: {},
  byProject: {},
};

const EMPTY_PAL: PalInferenceUsage = {
  buckets: emptyTimeBuckets(),
  byModel: {},
  byCaller: {},
};

function report(
  cc: AgentUsage = EMPTY_CC,
  pal: PalInferenceUsage = EMPTY_PAL,
  more: Partial<UsageData> = {}
): UsageData {
  return {
    agents: [{ label: "Claude Code", usage: cc }],
    pal,
    rtk: NO_RTK,
    untracked: [],
    ...more,
  };
}

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

describe("costLabel", () => {
  test("shows a dash, not $0, when no call of the bucket had a price", () => {
    const bucket = { ...emptyBucket(), calls: 2, unpriced: 2 };
    expect(costLabel(bucket)).toBe("-");
    expect(costLabel(bucket, "—")).toBe("—");
  });

  test("shows the priced part when only some calls went unpriced", () => {
    const bucket = { ...emptyBucket(), calls: 2, unpriced: 1, cost: 1.5 };
    expect(costLabel(bucket)).toBe("$1.50");
  });

  test("an empty bucket costs $0, since nothing went unpriced", () => {
    expect(costLabel(emptyBucket())).toBe("$0.0000");
  });
});

describe("modelLabel", () => {
  test("drops a provider path, keeping the model's own name", () => {
    expect(modelLabel("accounts/fireworks/models/kimi-k3")).toBe("kimi-k3");
  });

  test("drops the claude- prefix", () => {
    expect(modelLabel("claude-opus-5")).toBe("opus-5");
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
  test("opens with an agent's section and its four windows once it made a call", () => {
    const lines = usageLines(
      report({ ...EMPTY_CC, buckets: timeBucketsOf("claude-opus-5", 10) })
    );
    expect(lines[0]).toBe("\n  Claude Code Usage\n");
    expect(lines[1]).toContain("Today");
    expect(lines[2]).toContain("7d");
    expect(lines[3]).toContain("30d");
    expect(lines[4]).toContain("Total");
  });

  // The exact count is what pins "omits": a section that returned a placeholder
  // instead of nothing would still not contain the heading it was asked about.
  test("with nothing recorded, says so, then rtk and the total — and nothing else", () => {
    expect(usageLines(report())).toEqual([
      "\n  No agent usage recorded\n",
      "\n  rtk Compression\n",
      "  rtk not installed",
      "\n  Grand Total: $0.0000\n",
    ]);
  });

  test("gives every agent that made a call its own section, and none to one that did not", () => {
    const used = { ...EMPTY_CC, buckets: timeBucketsOf("gpt-5.5", 10) };
    const lines = usageLines(
      report(EMPTY_CC, EMPTY_PAL, {
        agents: [
          { label: "Claude Code", usage: EMPTY_CC },
          { label: "Codex", usage: used },
          { label: "opencode", usage: used },
        ],
      })
    );
    expect(lines).toContain("\n  Codex Usage\n");
    expect(lines).toContain("\n  opencode Usage\n");
    expect(find(lines, "Claude Code")).toBeUndefined();
  });

  test("names the agents on this machine that keep no token counts", () => {
    const lines = usageLines(
      report(EMPTY_CC, EMPTY_PAL, { untracked: ["Cursor", "Antigravity CLI"] })
    );
    expect(lines).toContain("\n  Cursor, Antigravity CLI: no token counts recorded");
  });

  test("names the agents the grand total cannot price, and leaves them out of it", () => {
    const unpriced = emptyTimeBuckets();
    for (const window of Object.values(unpriced)) {
      Object.assign(window, { calls: 3, unpriced: 3, input: 1_000_000 });
    }
    const lines = usageLines(
      report(EMPTY_CC, EMPTY_PAL, {
        agents: [{ label: "Codex", usage: { ...EMPTY_CC, buckets: unpriced } }],
      })
    );
    expect(lines).toContain("\n  Not priced: Codex (no per-token price)");
    expect(lines.at(-1)).toBe("\n  Grand Total: $0.0000\n");
  });

  test("adds up a model that two agents both used into one row", () => {
    const agentWith = (model: string) => ({
      label: model,
      usage: { ...EMPTY_CC, byModel: { [model]: bucketOf("claude-opus-5", 10) } },
    });
    const lines = usageLines(
      report(EMPTY_CC, EMPTY_PAL, {
        agents: [agentWith("gpt-5.5"), agentWith("gpt-5.5")],
      })
    );
    const row = find(lines, "gpt-5.5 ") as string;
    expect(row).toBe(
      detailedLine(
        "gpt-5.5",
        grandTotal([bucketOf("claude-opus-5", 10), bucketOf("claude-opus-5", 10)])
      )
    );
  });

  test("adds up a project that two agents both worked in", () => {
    const agentIn = (project: string, scale: number) => ({
      label: project,
      usage: {
        ...EMPTY_CC,
        byProject: { [project]: timeBucketsOf("claude-opus-5", scale) },
      },
    });
    const lines = usageLines(
      report(EMPTY_CC, EMPTY_PAL, {
        agents: [agentIn("pal", 10), agentIn("pal", 10), agentIn("other", 1)],
      })
    );
    const merged = grandTotal([
      timeBucketsOf("claude-opus-5", 10).total,
      timeBucketsOf("claude-opus-5", 10).total,
    ]);
    expect(find(lines, "  pal ")).toBe(rowLine("pal", merged));
  });

  test("omits the model section when nothing was recorded", () => {
    const lines = usageLines(report());
    expect(find(lines, "By Model")).toBeUndefined();
  });

  test("shows the model section, costliest model first", () => {
    const cc: AgentUsage = {
      ...EMPTY_CC,
      byModel: {
        "claude-haiku-4-5-20251001": bucketOf("claude-haiku-4-5-20251001", 1_000),
        "claude-opus-5": bucketOf("claude-opus-5", 1_000),
      },
    };
    const lines = usageLines(report(cc));
    const heading = lines.findIndex((l) => l.includes("By Model (all time)"));
    expect(heading).toBeGreaterThan(-1);
    expect(lines[heading + 1]).toContain("opus-5");
    expect(lines[heading + 2]).toContain("haiku-4-5");
  });

  test("strips the claude- prefix from a model name", () => {
    const bucket = bucketOf("claude-opus-5", 10);
    const cc: AgentUsage = { ...EMPTY_CC, byModel: { "claude-opus-5": bucket } };
    const line = find(usageLines(report(cc)), " in  ") as string;
    expect(line).toStartWith("  opus-5 ");
  });

  // A short name keeps the default width; a long one takes its own length plus
  // two, so the column never collides with the numbers beside it.
  test("holds the default column width for a name that fits", () => {
    const bucket = bucketOf("claude-opus-5", 10);
    const cc: AgentUsage = { ...EMPTY_CC, byModel: { "claude-opus-5": bucket } };
    const line = find(usageLines(report(cc)), " in  ");
    expect(line).toBe(detailedLine("opus-5", bucket, 14));
  });

  test("widens the model column for a name longer than the default", () => {
    const long = "claude-a-very-long-model-identifier-9";
    const bucket = bucketOf(long, 1);
    const cc: AgentUsage = { ...EMPTY_CC, byModel: { [long]: bucket } };
    const line = find(usageLines(report(cc)), "a-very-long");
    expect(line).toBe(detailedLine("a-very-long-model-identifier-9", bucket, 32));
  });

  test("omits the project section for a single project — it says nothing new", () => {
    const cc: AgentUsage = {
      ...EMPTY_CC,
      byProject: { pal: timeBucketsOf("claude-opus-5", 10) },
    };
    const lines = usageLines(report(cc));
    expect(find(lines, "By Project")).toBeUndefined();
    expect(lines).toHaveLength(usageLines(report()).length);
  });

  test("shows the project section from two projects up, costliest first", () => {
    const cc: AgentUsage = {
      ...EMPTY_CC,
      byProject: {
        cheap: timeBucketsOf("claude-haiku-4-5-20251001", 10),
        dear: timeBucketsOf("claude-opus-5", 10_000),
      },
    };
    const lines = usageLines(report(cc));
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
    const lines = usageLines(report(EMPTY_CC, pal));
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
    expect(usageLines(report(EMPTY_CC, pal))).toContain("\n  PAL Inference (opus-5)\n");
  });

  test("skips a PAL model that made no calls", () => {
    const pal: PalInferenceUsage = {
      ...EMPTY_PAL,
      byModel: { "claude-haiku-4-5-20251001": emptyTimeBuckets() },
    };
    expect(find(usageLines(report(EMPTY_CC, pal)), "PAL Inference")).toBeUndefined();
  });

  test("gives a PAL inference section the same four windows", () => {
    const pal: PalInferenceUsage = {
      ...EMPTY_PAL,
      byModel: { "claude-haiku-4-5-20251001": timeBucketsOf("claude-haiku-4-5", 10) },
    };
    const lines = usageLines(report(EMPTY_CC, pal));
    const heading = lines.findIndex((l) => l.includes("PAL Inference"));
    expect(
      lines.slice(heading + 1, heading + 5).map((l) => l.trim().split(" ")[0])
    ).toEqual(["Today", "7d", "30d", "Total"]);
  });

  test("always ends with the grand total", () => {
    const lines = usageLines(report());
    expect(lines[lines.length - 1]).toBe("\n  Grand Total: $0.0000\n");
  });

  test("the grand total adds PAL inference to Claude Code, not just one of them", () => {
    const cc: AgentUsage = {
      ...EMPTY_CC,
      buckets: timeBucketsOf("claude-opus-5", 1e6),
    };
    const pal: PalInferenceUsage = {
      ...EMPTY_PAL,
      buckets: timeBucketsOf("claude-opus-5", 1e6),
    };

    const expected = cc.buckets.total.cost + pal.buckets.total.cost;
    expect(expected).toBeGreaterThan(1);
    expect(usageLines(report(cc, pal)).at(-1)).toBe(
      `\n  Grand Total: ${fmtCost(expected)}\n`
    );
  });

  test("puts the rtk section between PAL inference and the grand total", () => {
    const lines = usageLines(report());
    const rtk = lines.findIndex((l) => l.includes("rtk Compression"));
    expect(rtk).toBe(lines.length - 3);
  });
});
