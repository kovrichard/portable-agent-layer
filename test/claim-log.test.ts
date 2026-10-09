import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { claimChecksSince, watchClaims } from "../src/hooks/lib/claim-log";
import { reload } from "../src/hooks/lib/settings";
import { claimCheckLines } from "../src/tools/lib/interaction-report";
import { removeOnceReleased } from "./lib/remove-once-released";

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
  removeOnceReleased(HOME);
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

describe("sending an unbacked claim back, when opted in", () => {
  const optIn = () => setSettings({ dynamicContext: { claimCheckBlocks: true } });

  test("is off by default", () => {
    expect(stop("All tests pass.")).toBeNull();
    expect(claimChecksSince(since)[0].blocked).toBeUndefined();
  });

  test("names the claim and asks for the output", () => {
    optIn();

    expect(stop("Renamed it. All tests pass.")).toBe(
      'Your reply claims what no command in this turn showed: "All tests pass". Run the check and show its output, or say it is unverified.'
    );
    expect(claimChecksSince(since)[0].blocked).toBe(true);
    expect(claimCheckLines(claimChecksSince(since))[1]).toContain("1 sent back");
  });

  test("a status claim after only a test run is sent back to read git", () => {
    optIn();

    expect(stop("Tests ran. The fix is not pushed yet.", [prompt, bash])).toBe(
      'Your reply claims what no command in this turn showed: "The fix is not pushed yet". Read what is committed, pushed, merged or released with git or gh and show it, or say it is unverified.'
    );
  });

  test("leaves a backed claim alone", () => {
    optIn();

    expect(stop("All tests pass.", [prompt, bash])).toBeNull();
  });

  test("leaves a turn it could not read alone", () => {
    optIn();

    expect(stop("All tests pass.", [{ type: "other" }])).toBeNull();
  });

  test.each([
    ["Claude Code", { stop_hook_active: true }],
    ["Cursor", { loop_count: 1 }],
  ])("sends a reply back once at most (%s)", (_, sentBack) => {
    optIn();
    const path = transcript([prompt]);

    expect(
      watchClaims(
        {
          session_id: "s1",
          last_assistant_message: "All tests pass.",
          transcript_path: path,
          ...sentBack,
        },
        NOW
      )
    ).toBeNull();
    expect(claimChecksSince(since)[0].blocked).toBeUndefined();
  });
});

describe("reporting the watched claims", () => {
  test("counts the claims and lists the unbacked ones", () => {
    stop("All tests pass.");
    stop("CI is green.", [prompt, bash]);

    expect(claimCheckLines(claimChecksSince(since))).toEqual([
      "",
      "Result and status claims: 2 replies · 1 with no command behind it · 0 sent back · 0 unreadable",
      "  no command: All tests pass",
    ]);
  });

  test("says nothing when no reply made a claim", () => {
    expect(claimCheckLines([])).toEqual([]);
  });
});
