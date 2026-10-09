import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadHandoffContext } from "../src/hooks/lib/handoff-context";
import { sessionDir } from "../src/hooks/lib/session-dir";
import { removeOnceReleased } from "./lib/remove-once-released";

const HERE = "/work/here";
const OTHER = "/work/other";
const NOW = Date.parse("2026-09-30T12:00:00Z");

let home: string;

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function handoff(title: string, minutes: number, status = "in-progress") {
  return { title, handoff: `${title} body`, status, timestamp: minutesAgo(minutes) };
}

function seed(entries: Record<string, ReturnType<typeof handoff>>) {
  const state = resolve(home, "memory", "state");
  mkdirSync(state, { recursive: true });
  writeFileSync(resolve(state, "last-handoff.json"), JSON.stringify(entries));
}

beforeEach(() => {
  home = mkdtempSync(resolve(tmpdir(), "pal-handoff-context-"));
  process.env.PAL_HOME = home;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  removeOnceReleased(home);
});

describe("loadHandoffContext", () => {
  test("this folder comes first, a newer conversation elsewhere follows", () => {
    seed({ [HERE]: handoff("Here work", 60), [OTHER]: handoff("Other work", 5) });

    const out = loadHandoffContext(HERE, NOW);

    expect(out.indexOf("## Pick Up Where You Left Off")).toBe(0);
    expect(out).toContain("Here work body");
    expect(out).toContain("## Last Conversation Elsewhere");
    expect(out).toContain(`*${OTHER} · 5m ago · may be unrelated: Other work*`);
  });

  test("an older conversation elsewhere is left out", () => {
    seed({ [HERE]: handoff("Here work", 5), [OTHER]: handoff("Other work", 60) });

    expect(loadHandoffContext(HERE, NOW)).not.toContain("Other work");
  });

  test("a folder with no handoff still gets the latest one from elsewhere", () => {
    seed({ [OTHER]: handoff("Other work", 5) });

    const out = loadHandoffContext(HERE, NOW);

    expect(out).not.toContain("## Pick Up Where You Left Off");
    expect(out).toContain("Other work");
  });

  test("elsewhere shows even when it was marked completed", () => {
    seed({ [OTHER]: handoff("Finished elsewhere", 5, "completed") });

    expect(loadHandoffContext(HERE, NOW)).toContain("Finished elsewhere");
  });

  test("scratch sessions under the temp dir are never the conversation elsewhere", () => {
    seed({
      [resolve(tmpdir(), "probe")]: handoff("Scratch", 1),
      [OTHER]: handoff("Real", 9),
    });

    const out = loadHandoffContext(HERE, NOW);

    expect(out).not.toContain("Scratch");
    expect(out).toContain("Real");
  });

  test("a long handoff from elsewhere is cut at a word boundary", () => {
    seed({
      [OTHER]: { ...handoff("Long", 5), handoff: `${"word ".repeat(100)}tail` },
    });

    const body = loadHandoffContext(HERE, NOW).split("\n").at(-1) ?? "";

    expect(body.length).toBeLessThanOrEqual(301);
    expect(body.endsWith("word…")).toBe(true);
  });

  test("handoffs older than a week are ignored everywhere", () => {
    seed({
      [HERE]: handoff("Old here", 8 * 1440),
      [OTHER]: handoff("Old other", 8 * 1440),
    });

    expect(loadHandoffContext(HERE, NOW)).toBe("");
  });
});

describe("sessionDir", () => {
  test("is the folder the session started in when the agent names it", () => {
    expect(sessionDir({ CLAUDE_PROJECT_DIR: "/started/here" })).toBe("/started/here");
  });

  test("falls back to the cwd when it does not", () => {
    expect(sessionDir({})).toBe(process.cwd());
  });
});
