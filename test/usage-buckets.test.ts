import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addToBucket,
  addToTimeBuckets,
  emptyBucket,
  emptyTimeBuckets,
  grandTotal,
  horizonsFrom,
  projectNameOf,
  readClaudeCode,
  readPalInference,
  totalTokens,
} from "../src/tools/lib/usage-buckets";

const NOW = new Date("2026-09-06T12:00:00.000Z");
const HORIZONS = horizonsFrom(NOW);

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "pal-usage-buckets-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const tokens = (input: number, output: number, cw5m = 0, cw1h = 0, cr = 0) => ({
  input,
  output,
  cacheWrite5m: cw5m,
  cacheWrite1h: cw1h,
  cacheRead: cr,
});

function assistantLine(
  ts: string,
  model: string,
  usage: Record<string, unknown>
): string {
  return JSON.stringify({ type: "assistant", timestamp: ts, message: { model, usage } });
}

describe("emptyBucket / emptyTimeBuckets", () => {
  test("starts every counter at zero", () => {
    expect(emptyBucket()).toEqual({
      input: 0,
      output: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      cost: 0,
      calls: 0,
    });
  });

  test("gives each window its own bucket, so one does not alias another", () => {
    const buckets = emptyTimeBuckets();
    buckets.today.calls = 5;
    expect(buckets.week.calls).toBe(0);
    expect(buckets.total.calls).toBe(0);
  });
});

describe("horizonsFrom", () => {
  test("takes today's prefix off the date, not the time", () => {
    expect(horizonsFrom(NOW).todayPrefix).toBe("2026-09-06");
  });

  test("puts the week cutoff seven days back", () => {
    expect(horizonsFrom(NOW).weekAgo).toBe("2026-08-30T12:00:00.000Z");
  });

  test("puts the month cutoff thirty days back", () => {
    expect(horizonsFrom(NOW).monthAgo).toBe("2026-08-07T12:00:00.000Z");
  });

  test("the week cutoff is later than the month cutoff", () => {
    const { weekAgo, monthAgo } = horizonsFrom(NOW);
    expect(weekAgo > monthAgo).toBe(true);
  });
});

describe("addToBucket", () => {
  test("accumulates every token field and counts the call", () => {
    const bucket = emptyBucket();
    addToBucket(bucket, "claude-opus-5", tokens(10, 20, 30, 40, 50));
    addToBucket(bucket, "claude-opus-5", tokens(1, 2, 3, 4, 5));
    expect(bucket.input).toBe(11);
    expect(bucket.output).toBe(22);
    expect(bucket.cacheWrite5m).toBe(33);
    expect(bucket.cacheWrite1h).toBe(44);
    expect(bucket.cacheRead).toBe(55);
    expect(bucket.calls).toBe(2);
  });

  test("prices what it accumulates", () => {
    const bucket = emptyBucket();
    addToBucket(bucket, "claude-opus-5", tokens(1_000_000, 1_000_000));
    expect(bucket.cost).toBeGreaterThan(0);
  });

  test("prices per model, so a cheap model costs less than an expensive one", () => {
    const opus = emptyBucket();
    const haiku = emptyBucket();
    addToBucket(opus, "claude-opus-5", tokens(1_000_000, 1_000_000));
    addToBucket(haiku, "claude-haiku-4-5-20251001", tokens(1_000_000, 1_000_000));
    expect(haiku.cost).toBeLessThan(opus.cost);
  });
});

describe("addToTimeBuckets", () => {
  test("counts a call from today in all four windows", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-09-06T09:00:00.000Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.today.calls).toBe(1);
    expect(buckets.week.calls).toBe(1);
    expect(buckets.month.calls).toBe(1);
    expect(buckets.total.calls).toBe(1);
  });

  test("a call from three days ago misses today but makes the week", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-09-03T09:00:00.000Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.today.calls).toBe(0);
    expect(buckets.week.calls).toBe(1);
    expect(buckets.month.calls).toBe(1);
  });

  test("a call from two weeks ago makes only the month and the total", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-08-23T09:00:00.000Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.week.calls).toBe(0);
    expect(buckets.month.calls).toBe(1);
    expect(buckets.total.calls).toBe(1);
  });

  test("a call older than a month still counts toward the total", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-01-01T09:00:00.000Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.month.calls).toBe(0);
    expect(buckets.total.calls).toBe(1);
  });

  test("the week cutoff is inclusive — a call exactly on it is inside", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, HORIZONS.weekAgo, "m", tokens(1, 1), HORIZONS);
    expect(buckets.week.calls).toBe(1);
  });

  test("the month cutoff is inclusive too", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, HORIZONS.monthAgo, "m", tokens(1, 1), HORIZONS);
    expect(buckets.month.calls).toBe(1);
  });

  test("one tick before the week cutoff falls out of the week", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-08-30T11:59:59.999Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.week.calls).toBe(0);
    expect(buckets.month.calls).toBe(1);
  });
});

describe("totalTokens", () => {
  test("sums all five token fields", () => {
    const bucket = emptyBucket();
    addToBucket(bucket, "m", tokens(1, 2, 4, 8, 16));
    expect(totalTokens(bucket)).toBe(31);
  });
});

describe("projectNameOf", () => {
  test("takes the last segment of a Claude Code project directory", () => {
    expect(projectNameOf("-mnt-ssd3-home-user-git-klint")).toBe("klint");
  });

  test("keeps a single-segment name as it is", () => {
    expect(projectNameOf("standalone")).toBe("standalone");
  });

  // Only the leading dash is stripped. Strip any dash and "a-b" collapses to one
  // segment, which would hand back the whole directory name instead of "b".
  test("splits on every dash, not just the one it stripped", () => {
    expect(projectNameOf("a-b")).toBe("b");
  });

  // Stripping leaves one segment, so the name falls back to the directory —
  // dash and all. Pinned because it is what the report has always printed.
  test("a single segment behind a leading dash keeps the dash", () => {
    expect(projectNameOf("-solo")).toBe("-solo");
  });
});

describe("readClaudeCode", () => {
  test("returns empty buckets when the projects directory does not exist", () => {
    const result = readClaudeCode(join(tempHome(), "nope"), undefined, NOW);
    expect(result.buckets.total.calls).toBe(0);
    expect(result.byModel).toEqual({});
    expect(result.byProject).toEqual({});
  });

  test("reads a transcript into the windows, by model and by project", () => {
    const dir = tempHome();
    const proj = join(dir, "-home-user-git-pal");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s1.jsonl"),
      [
        assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", {
          input_tokens: 100,
          output_tokens: 200,
        }),
        assistantLine("2026-08-20T08:00:00.000Z", "claude-opus-5", {
          input_tokens: 5,
          output_tokens: 5,
        }),
      ].join("\n")
    );

    const result = readClaudeCode(dir, undefined, NOW);
    expect(result.buckets.total.calls).toBe(2);
    expect(result.buckets.today.calls).toBe(1);
    expect(result.buckets.today.input).toBe(100);
    expect(result.buckets.today.output).toBe(200);
    expect(result.buckets.total.output).toBe(205);
    expect(result.byModel["claude-opus-5"].calls).toBe(2);
    expect(result.byProject.pal.total.calls).toBe(2);
  });

  test("ignores a stray file sitting beside the project directories", () => {
    const dir = tempHome();
    writeFileSync(join(dir, "stray.jsonl"), "not a project");
    const proj = join(dir, "-p-real");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 3 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(3);
  });

  test("bills a subagent transcript to the project that spawned it", () => {
    const dir = tempHome();
    const subagents = join(dir, "-home-user-git-pal", "session-a", "subagents");
    mkdirSync(subagents, { recursive: true });
    writeFileSync(
      join(subagents, "sub.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", {
        input_tokens: 7,
        output_tokens: 3,
      })
    );

    const result = readClaudeCode(dir, undefined, NOW);
    expect(result.buckets.total.calls).toBe(1);
    expect(result.byProject.pal.total.input).toBe(7);
  });

  test("reads only the transcripts in a subagents directory", () => {
    const dir = tempHome();
    const subagents = join(dir, "-p-mixed", "session-a", "subagents");
    mkdirSync(subagents, { recursive: true });
    writeFileSync(
      join(subagents, "notes.md"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 500 })
    );
    writeFileSync(
      join(subagents, "sub.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 9 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(9);
  });

  test("a directory that happens to be named like a transcript is skipped", () => {
    const dir = tempHome();
    const subagents = join(dir, "-p-dirlike", "session-a", "subagents");
    mkdirSync(join(subagents, "impostor.jsonl"), { recursive: true });
    writeFileSync(
      join(subagents, "real.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 11 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(11);
  });

  test("an assistant turn with no message at all is skipped, not thrown on", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-headless");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-09-06T08:00:00.000Z",
          note: "usage",
        }),
        assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 8 }),
      ].join("\n")
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(8);
  });

  test("a project directory with no subagents dir is not an error", () => {
    const dir = tempHome();
    const proj = join(dir, "-home-user-git-pal");
    mkdirSync(join(proj, "session-a"), { recursive: true });
    writeFileSync(
      join(proj, "s1.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 4 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.calls).toBe(1);
  });

  test("the project filter is a substring match on the project name", () => {
    const dir = tempHome();
    for (const [name, input] of [
      ["-home-user-git-portable-agent-layer", 10],
      ["-home-user-git-klint", 20],
    ] as const) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(
        join(dir, name, "s.jsonl"),
        assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", {
          input_tokens: input,
        })
      );
    }

    const result = readClaudeCode(dir, "lin", NOW);
    expect(Object.keys(result.byProject)).toEqual(["klint"]);
    expect(result.buckets.total.input).toBe(20);
  });

  test("skips lines that are not assistant turns", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-user");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-09-06T08:00:00.000Z",
          message: { model: "claude-opus-5", usage: { input_tokens: 999 } },
        }),
        assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 1 }),
      ].join("\n")
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(1);
  });

  test("skips an assistant turn with no timestamp", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-notime");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-opus-5", usage: { input_tokens: 5 } },
      })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.calls).toBe(0);
  });

  test("skips an assistant turn with no model", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-nomodel");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-06T08:00:00.000Z",
        message: { usage: { input_tokens: 5 } },
      })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.calls).toBe(0);
  });

  test("survives a malformed line that still mentions usage", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-broken");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      [
        '{"usage" broken json',
        assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 2 }),
      ].join("\n")
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(2);
  });

  test("reads the cache-write breakdown when the transcript carries one", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-breakdown");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", {
        cache_creation_input_tokens: 999,
        cache_creation: {
          ephemeral_5m_input_tokens: 10,
          ephemeral_1h_input_tokens: 20,
        },
        cache_read_input_tokens: 30,
      })
    );
    const total = readClaudeCode(dir, undefined, NOW).buckets.total;
    expect(total.cacheWrite5m).toBe(10);
    expect(total.cacheWrite1h).toBe(20);
    expect(total.cacheRead).toBe(30);
  });

  test("bills an older transcript's single cache-write total as 5m", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-legacy");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", {
        cache_creation_input_tokens: 500,
      })
    );
    const total = readClaudeCode(dir, undefined, NOW).buckets.total;
    expect(total.cacheWrite5m).toBe(500);
    expect(total.cacheWrite1h).toBe(0);
  });

  test("ignores files in a project directory that are not transcripts", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-noise");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "notes.md"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 400 })
    );
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 6 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(6);
  });
});

describe("readPalInference", () => {
  function writeLog(lines: string[]): string {
    const dir = tempHome();
    const filepath = join(dir, "token-usage.jsonl");
    writeFileSync(filepath, lines.join("\n"));
    return filepath;
  }

  test("returns empty buckets when the log does not exist", () => {
    const result = readPalInference(join(tempHome(), "missing.jsonl"), NOW);
    expect(result.buckets.total.calls).toBe(0);
    expect(result.byCaller).toEqual({});
  });

  test("returns empty buckets for an empty log", () => {
    expect(readPalInference(writeLog([""]), NOW).buckets.total.calls).toBe(0);
  });

  test("splits a call across the windows, the model and the caller", () => {
    const filepath = writeLog([
      JSON.stringify({
        ts: "2026-09-06T08:00:00.000Z",
        caller: "failure-principle",
        model: "claude-haiku-4-5-20251001",
        inputTokens: 300,
        outputTokens: 40,
      }),
      JSON.stringify({
        ts: "2026-08-25T08:00:00.000Z",
        caller: "synthesize",
        model: "claude-haiku-4-5-20251001",
        inputTokens: 100,
        outputTokens: 10,
      }),
    ]);

    const result = readPalInference(filepath, NOW);
    expect(result.buckets.total.calls).toBe(2);
    expect(result.buckets.today.input).toBe(300);
    expect(result.byModel["claude-haiku-4-5-20251001"].month.calls).toBe(2);
    expect(result.byCaller["failure-principle"].input).toBe(300);
    expect(result.byCaller.synthesize.calls).toBe(1);
  });

  test("records no cache traffic — a PAL prompt has none", () => {
    const filepath = writeLog([
      JSON.stringify({
        ts: "2026-09-06T08:00:00.000Z",
        caller: "c",
        model: "claude-haiku-4-5-20251001",
        inputTokens: 10,
        outputTokens: 2,
      }),
    ]);
    const total = readPalInference(filepath, NOW).buckets.total;
    expect(total.cacheWrite5m).toBe(0);
    expect(total.cacheWrite1h).toBe(0);
    expect(total.cacheRead).toBe(0);
  });

  test("skips a malformed line and keeps the rest", () => {
    const filepath = writeLog([
      "not json at all",
      JSON.stringify({
        ts: "2026-09-06T08:00:00.000Z",
        caller: "c",
        model: "m",
        inputTokens: 4,
        outputTokens: 1,
      }),
    ]);
    expect(readPalInference(filepath, NOW).buckets.total.calls).toBe(1);
  });
});

describe("grandTotal", () => {
  test("sums every field across the buckets it is given", () => {
    const a = emptyBucket();
    const b = emptyBucket();
    addToBucket(a, "claude-opus-5", tokens(1, 2, 3, 4, 5));
    addToBucket(b, "claude-opus-5", tokens(10, 20, 30, 40, 50));

    const grand = grandTotal([a, b]);
    expect(grand.input).toBe(11);
    expect(grand.output).toBe(22);
    expect(grand.cacheWrite5m).toBe(33);
    expect(grand.cacheWrite1h).toBe(44);
    expect(grand.cacheRead).toBe(55);
    expect(grand.calls).toBe(2);
    expect(grand.cost).toBeCloseTo(a.cost + b.cost, 12);
  });

  test("an empty list totals to zero", () => {
    expect(grandTotal([])).toEqual(emptyBucket());
  });

  test("does not mutate the buckets it sums", () => {
    const a = emptyBucket();
    addToBucket(a, "claude-opus-5", tokens(1, 1));
    grandTotal([a, a]);
    expect(a.calls).toBe(1);
  });
});
