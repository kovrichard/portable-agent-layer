import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  accumulateUsage,
  claudeProjectsDir,
  findSessionFile,
  fmtCost,
  fmtDuration,
  fmtTokens,
  type SessionUsage,
  sessionSummary,
  summaryLine,
  totalTokens,
} from "../src/tools/lib/session-usage";

// What the `pal` wrapper prints after a session ends. It is spawned, so none of
// it was reachable from a test — which is how the duration came to be reported
// as "<1m" for every session PAL has ever summarised.

const SESSION = "sess-abc";
const MODEL = "claude-opus-5";

let CLAUDE_DIR: string;

beforeEach(() => {
  CLAUDE_DIR = mkdtempSync(resolve(tmpdir(), "pal-summary-"));
});

afterEach(() => {
  rmSync(CLAUDE_DIR, { recursive: true, force: true });
});

function assistantLine(
  usage: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: SESSION,
    message: { model: MODEL, usage },
    ...extra,
  });
}

function writeTranscript(project: string, name: string, lines: string[]): string {
  const dir = resolve(CLAUDE_DIR, project);
  mkdirSync(dir, { recursive: true });
  const filepath = resolve(dir, name);
  writeFileSync(filepath, lines.join("\n"), "utf-8");
  return filepath;
}

const MINUTES_AGO = (n: number) => new Date(Date.now() - n * 60_000);

/** Explicit mtimes, so which file is newest never depends on write timing. */
function agedAt(filepath: string, when: Date): string {
  utimesSync(filepath, when, when);
  return filepath;
}

describe("accumulateUsage", () => {
  test("sums the token counts across every assistant turn", () => {
    const usage = accumulateUsage(
      [
        assistantLine({ input_tokens: 100, output_tokens: 10 }),
        assistantLine({ input_tokens: 200, output_tokens: 20 }),
      ].join("\n"),
      SESSION
    );
    expect(usage.input).toBe(300);
    expect(usage.output).toBe(30);
    expect(usage.calls).toBe(2);
  });

  // A transcript file can hold turns from a session that was resumed under a
  // different id; billing those to this session would overstate it.
  test("ignores lines belonging to another session in the same file", () => {
    const other = JSON.stringify({
      type: "assistant",
      sessionId: "someone-else",
      message: { model: MODEL, usage: { input_tokens: 9_999 } },
    });
    const usage = accumulateUsage(
      [assistantLine({ input_tokens: 100 }), other].join("\n"),
      SESSION
    );
    expect(usage.input).toBe(100);
    expect(usage.calls).toBe(1);
  });

  test("adds up the cache reads, which are most of a long session's tokens", () => {
    const usage = accumulateUsage(
      [
        assistantLine({ cache_read_input_tokens: 1_000 }),
        assistantLine({ cache_read_input_tokens: 2_500 }),
      ].join("\n"),
      SESSION
    );
    expect(usage.cacheRead).toBe(3_500);
  });

  // A user turn echoes the usage of the turn it answers, so counting one would
  // bill every exchange twice.
  test("counts only assistant turns, even when a user turn carries usage", () => {
    const user = JSON.stringify({
      type: "user",
      sessionId: SESSION,
      message: { model: MODEL, usage: { input_tokens: 400 } },
    });
    const usage = accumulateUsage(user, SESSION);
    expect(usage.calls).toBe(0);
    expect(usage.input).toBe(0);
  });

  test("a line with no message at all is skipped, not a crash", () => {
    const bare = JSON.stringify({ type: "assistant", sessionId: SESSION });
    const usage = accumulateUsage(
      [bare, assistantLine({ input_tokens: 100 })].join("\n"),
      SESSION
    );
    expect(usage.input).toBe(100);
    expect(usage.calls).toBe(1);
  });

  test("skips a turn with no model, which cannot be priced", () => {
    const noModel = JSON.stringify({
      type: "assistant",
      sessionId: SESSION,
      message: { usage: { input_tokens: 500 } },
    });
    expect(accumulateUsage(noModel, SESSION).input).toBe(0);
  });

  test("a corrupt line is skipped, not fatal to the rest of the file", () => {
    const usage = accumulateUsage(
      ["{not json", assistantLine({ input_tokens: 100 }), ""].join("\n"),
      SESSION
    );
    expect(usage.input).toBe(100);
  });

  test("prices the tokens through the model's own rates", () => {
    const usage = accumulateUsage(assistantLine({ input_tokens: 1_000_000 }), SESSION);
    expect(usage.cost).toBeCloseTo(5, 10);
  });

  test("an unpriced model still counts its tokens, at no cost", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: SESSION,
      message: { model: "some-other-vendor", usage: { input_tokens: 1_000_000 } },
    });
    const usage = accumulateUsage(line, SESSION);
    expect(usage.input).toBe(1_000_000);
    expect(usage.cost).toBe(0);
  });

  test("names every model the session used", () => {
    const haiku = JSON.stringify({
      type: "assistant",
      sessionId: SESSION,
      message: { model: "claude-haiku-4-5-20251001", usage: { input_tokens: 1 } },
    });
    const usage = accumulateUsage(
      [assistantLine({ input_tokens: 1 }), haiku].join("\n"),
      SESSION
    );
    expect([...usage.models].sort()).toEqual(["claude-haiku-4-5-20251001", MODEL]);
  });

  describe("cache writes", () => {
    // The two TTLs are priced differently, and a transcript carrying the
    // breakdown also carries the old total — reading both double-counts.
    test("uses the per-TTL breakdown when the transcript has one", () => {
      const usage = accumulateUsage(
        assistantLine({
          cache_creation_input_tokens: 999,
          cache_creation: {
            ephemeral_5m_input_tokens: 40,
            ephemeral_1h_input_tokens: 60,
          },
        }),
        SESSION
      );
      expect(usage.cacheWrite5m).toBe(40);
      expect(usage.cacheWrite1h).toBe(60);
    });

    test("falls back to the single total on an older transcript", () => {
      const usage = accumulateUsage(
        assistantLine({ cache_creation_input_tokens: 500 }),
        SESSION
      );
      expect(usage.cacheWrite5m).toBe(500);
      expect(usage.cacheWrite1h).toBe(0);
    });

    // Either bucket alone is a breakdown. Testing only one of them lets the
    // other's half of the check be deleted without a test noticing.
    test("a breakdown naming only the 5m bucket does not fall back", () => {
      const usage = accumulateUsage(
        assistantLine({
          cache_creation_input_tokens: 999,
          cache_creation: { ephemeral_5m_input_tokens: 40 },
        }),
        SESSION
      );
      expect(usage.cacheWrite5m).toBe(40);
      expect(usage.cacheWrite1h).toBe(0);
    });

    test("a breakdown naming only the 1h bucket does not fall back", () => {
      const usage = accumulateUsage(
        assistantLine({
          cache_creation_input_tokens: 999,
          cache_creation: { ephemeral_1h_input_tokens: 70 },
        }),
        SESSION
      );
      expect(usage.cacheWrite5m).toBe(0);
      expect(usage.cacheWrite1h).toBe(70);
    });
  });

  describe("duration", () => {
    // This was reported as 0 for every session: firstTs started as "" and was
    // assigned with ??=, which an empty string never triggers.
    test("spans the first timestamp to the last", () => {
      const usage = accumulateUsage(
        [
          assistantLine({ input_tokens: 1 }, { timestamp: "2026-05-04T10:00:00.000Z" }),
          assistantLine({ input_tokens: 1 }, { timestamp: "2026-05-04T10:45:00.000Z" }),
          assistantLine({ input_tokens: 1 }, { timestamp: "2026-05-04T12:30:00.000Z" }),
        ].join("\n"),
        SESSION
      );
      expect(usage.durationMs).toBe(150 * 60_000);
    });

    test("takes the first timestamp from any turn, not only an assistant one", () => {
      const usage = accumulateUsage(
        [
          JSON.stringify({
            type: "user",
            sessionId: SESSION,
            timestamp: "2026-05-04T10:00:00.000Z",
          }),
          assistantLine({ input_tokens: 1 }, { timestamp: "2026-05-04T10:30:00.000Z" }),
        ].join("\n"),
        SESSION
      );
      expect(usage.durationMs).toBe(30 * 60_000);
    });

    // Not every line has one, and the last that does is the end of the session.
    test("is unaffected by a later line carrying no timestamp", () => {
      const usage = accumulateUsage(
        [
          assistantLine({ input_tokens: 1 }, { timestamp: "2026-05-04T10:00:00.000Z" }),
          assistantLine({ input_tokens: 1 }, { timestamp: "2026-05-04T10:40:00.000Z" }),
          assistantLine({ input_tokens: 1 }),
        ].join("\n"),
        SESSION
      );
      expect(usage.durationMs).toBe(40 * 60_000);
    });

    test("is zero when nothing carried a timestamp", () => {
      expect(
        accumulateUsage(assistantLine({ input_tokens: 1 }), SESSION).durationMs
      ).toBe(0);
    });
  });
});

describe("findSessionFile", () => {
  // The named file must win even when another transcript is newer, or a session
  // that ends while a second window is running gets billed the other's usage.
  test("prefers the file named for the session over a newer one", () => {
    const named = writeTranscript("-home-x-git-repo", `${SESSION}.jsonl`, ["{}"]);
    agedAt(writeTranscript("-home-x-git-other", "decoy.jsonl", ["{}"]), MINUTES_AGO(0));
    agedAt(named, MINUTES_AGO(60));

    expect(findSessionFile(SESSION, CLAUDE_DIR)).toEqual({
      filepath: named,
      project: "repo",
    });
  });

  // Claude Code renames a session's file when it is resumed, so the id on the
  // command line is not always still a filename.
  test("falls back to the most recently written transcript", () => {
    // Named so the older sorts first: the newer must win on its mtime, not on
    // being whichever the directory listing happened to hand over last.
    agedAt(writeTranscript("-a-old", "older.jsonl", ["{}"]), MINUTES_AGO(60));
    const newer = writeTranscript("-b-new", "newer.jsonl", ["{}"]);
    agedAt(newer, MINUTES_AGO(0));

    const found = findSessionFile("no-such-session", CLAUDE_DIR);
    expect(found?.filepath).toBe(newer);
    expect(found?.project).toBe("new");
  });

  test("and the other way round, so it is the mtime deciding and not the order", () => {
    const older = writeTranscript("-a-first", "a.jsonl", ["{}"]);
    agedAt(older, MINUTES_AGO(0));
    agedAt(writeTranscript("-b-second", "b.jsonl", ["{}"]), MINUTES_AGO(60));

    expect(findSessionFile("no-such-session", CLAUDE_DIR)?.filepath).toBe(older);
  });

  test("is null when the projects directory does not exist at all", () => {
    expect(findSessionFile(SESSION, resolve(CLAUDE_DIR, "absent"))).toBeNull();
  });

  test("is null when there is nothing to fall back to", () => {
    expect(findSessionFile(SESSION, CLAUDE_DIR)).toBeNull();
  });

  test("ignores files that are not transcripts", () => {
    writeTranscript("-home-x-git-repo", "notes.md", ["hello"]);
    expect(findSessionFile(SESSION, CLAUDE_DIR)).toBeNull();
  });

  test("a loose file among the project directories is not searched", () => {
    writeFileSync(resolve(CLAUDE_DIR, "stray.jsonl"), "{}", "utf-8");
    expect(findSessionFile(SESSION, CLAUDE_DIR)).toBeNull();
  });
});

describe("claudeProjectsDir", () => {
  test("is where Claude Code keeps its transcripts, under the user's home", () => {
    expect(claudeProjectsDir()).toStartWith(homedir());
    expect(claudeProjectsDir()).toEndWith(join(".claude", "projects"));
  });
});

describe("formatting", () => {
  test("tokens get a unit once they are worth one", () => {
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(1_000)).toBe("1.0k");
    expect(fmtTokens(45_600)).toBe("45.6k");
    expect(fmtTokens(1_000_000)).toBe("1.0M");
    expect(fmtTokens(2_450_000)).toBe("2.5M");
  });

  // Two decimals reads as money; under a dollar it would read as "$0.00".
  test("a sub-dollar cost keeps four decimals, a larger one two", () => {
    expect(fmtCost(0.0032)).toBe("$0.0032");
    expect(fmtCost(0.9999)).toBe("$0.9999");
    expect(fmtCost(1)).toBe("$1.00");
    expect(fmtCost(12.345)).toBe("$12.35");
  });

  test("durations round down to the unit below", () => {
    expect(fmtDuration(0)).toBe("<1m");
    expect(fmtDuration(59_000)).toBe("<1m");
    expect(fmtDuration(60_000)).toBe("1m");
    expect(fmtDuration(45 * 60_000)).toBe("45m");
    expect(fmtDuration(60 * 60_000)).toBe("1h");
    expect(fmtDuration(150 * 60_000)).toBe("2h 30m");
  });
});

describe("summaryLine", () => {
  const USAGE: SessionUsage = {
    input: 1_000,
    output: 500,
    cacheWrite5m: 200,
    cacheWrite1h: 100,
    cacheRead: 2_200,
    cost: 0.42,
    calls: 7,
    models: new Set(["claude-opus-5"]),
    durationMs: 90 * 60_000,
  };

  test("counts every token class in the total, cache included", () => {
    expect(totalTokens(USAGE)).toBe(4_000);
  });

  test("carries the project, model, duration, tokens, calls and cost", () => {
    const line = summaryLine("portable-agent-layer", USAGE);
    expect(line).toContain("portable-agent-layer");
    expect(line).toContain("opus-5");
    expect(line).toContain("1h 30m");
    expect(line).toContain("4.0k tokens");
    expect(line).toContain("7 calls");
    expect(line).toContain("$0.4200");
  });

  // It prints after the agent has exited, so it has to read as chrome rather
  // than as output, and it has to close the colour it opened.
  test("is dimmed, prices in cyan, and resets before it ends", () => {
    const line = summaryLine("repo", USAGE);
    expect(line).toStartWith("\n\x1b[2m");
    expect(line).toContain("\x1b[36m$0.4200");
    expect(line).toEndWith("\x1b[0m");
  });

  // The prefix is noise in a line that already says "Session:".
  test("drops the claude- prefix from each model name", () => {
    const line = summaryLine("repo", USAGE);
    expect(line).not.toContain("claude-opus-5");
  });

  test("lists several models separated, rather than only the first", () => {
    const line = summaryLine("repo", {
      ...USAGE,
      models: new Set(["claude-opus-5", "claude-haiku-4-5"]),
    });
    expect(line).toContain("opus-5, haiku-4-5");
  });
});

describe("sessionSummary", () => {
  test("reads the session's own file and summarises it", () => {
    writeTranscript("-home-x-git-repo", `${SESSION}.jsonl`, [
      assistantLine({ input_tokens: 1_000 }, { timestamp: "2026-05-04T10:00:00.000Z" }),
      assistantLine({ output_tokens: 500 }, { timestamp: "2026-05-04T10:20:00.000Z" }),
    ]);
    const line = sessionSummary(SESSION, CLAUDE_DIR);
    expect(line).toContain("repo");
    expect(line).toContain("20m");
    expect(line).toContain("2 calls");
  });

  test("says nothing without a session id, rather than guessing at one", () => {
    writeTranscript("-home-x-git-repo", `${SESSION}.jsonl`, [
      assistantLine({ input_tokens: 1 }),
    ]);
    expect(sessionSummary("", CLAUDE_DIR)).toBeNull();
  });

  test("says nothing when no transcript was found", () => {
    expect(sessionSummary(SESSION, CLAUDE_DIR)).toBeNull();
  });

  // A session that made no model calls has nothing to report, and a line of
  // zeroes after every exit is worse than silence.
  test("says nothing when the session made no model calls", () => {
    writeTranscript("-home-x-git-repo", `${SESSION}.jsonl`, [
      JSON.stringify({ type: "user", sessionId: SESSION, message: {} }),
    ]);
    expect(sessionSummary(SESSION, CLAUDE_DIR)).toBeNull();
  });
});
