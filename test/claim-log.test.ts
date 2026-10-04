import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { claimChecksSince, watchClaims } from "../src/hooks/lib/claim-log";
import { reload } from "../src/hooks/lib/settings";
import { claimCheckLines } from "../src/tools/lib/interaction-report";

let HOME: string;
const NOW = new Date("2026-10-04T12:00:00Z");

function transcript(entries: unknown[]): string {
  const path = resolve(HOME, "transcript.jsonl");
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n"));
  return path;
}

const prompt = { type: "user", message: { content: "run the tests" } };
const bash = {
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
};

function stop(reply: string, entries: unknown[] = [prompt]) {
  return watchClaims(
    {
      session_id: "s1",
      last_assistant_message: reply,
      transcript_path: transcript(entries),
    },
    NOW
  );
}

function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(HOME, "memory", "pal-settings.json"), JSON.stringify(data));
  reload();
}

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-claim-log-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  reload();
});

afterEach(() => {
  delete process.env.PAL_HOME;
  reload();
  rmSync(HOME, { recursive: true, force: true });
});

const since = new Date("2026-10-01T00:00:00Z");

describe("watching result claims at stop", () => {
  test("logs an unbacked claim with the sentence that made it", () => {
    stop("Renamed the worker. All tests pass.");

    expect(claimChecksSince(since)).toEqual([
      expect.objectContaining({
        ts: NOW.toISOString(),
        session: "s1",
        verdict: "unbacked",
        commands: 0,
        claims: ["All tests pass"],
      }),
    ]);
  });

  test("logs a backed claim without its text", () => {
    stop("All tests pass.", [prompt, bash]);

    const [record] = claimChecksSince(since);
    expect(record).toMatchObject({ verdict: "backed", commands: 1 });
    expect(record.claims).toBeUndefined();
  });

  test("a reply that claims nothing leaves no record", () => {
    stop("Renamed the worker.");

    expect(claimChecksSince(since)).toEqual([]);
  });

  test("a stop with no final reply is not checked", () => {
    watchClaims({ session_id: "s1", transcript_path: transcript([prompt]) }, NOW);

    expect(claimChecksSince(since)).toEqual([]);
  });

  test("records nothing when switched off", () => {
    setSettings({ dynamicContext: { claimCheck: false } });
    stop("All tests pass.");

    expect(claimChecksSince(since)).toEqual([]);
  });

  test("older records fall outside the window", () => {
    stop("All tests pass.");

    expect(claimChecksSince(new Date("2026-10-05T00:00:00Z"))).toEqual([]);
  });
});

describe("reporting the watched claims", () => {
  test("counts the claims and lists the unbacked ones", () => {
    stop("All tests pass.");
    stop("CI is green.", [prompt, bash]);

    expect(claimCheckLines(claimChecksSince(since))).toEqual([
      "",
      "Result claims (watched, never sent back): 2 replies · 1 with no command behind it · 0 unreadable",
      "  no command: All tests pass",
    ]);
  });

  test("says nothing when no reply made a claim", () => {
    expect(claimCheckLines([])).toEqual([]);
  });
});
