import { afterEach, describe, expect, test } from "bun:test";
import { log } from "../src/targets/lib";

// The suite drives these installers by the hundred against temp directories, so
// their per-item narration describes files that were never on this machine —
// a `git push` transcript reading "[pal] Removed copilot agent: ..." six times
// is reporting a sandbox. The summary its caller prints is the real result, and
// that one stays: `pal cli skill doctor` is read by tests and by users.

function captureOut(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

afterEach(() => {
  process.env.PAL_TEST_SANDBOX = "1";
});

describe("log.detail — per-item narration", () => {
  test("says nothing under the test runner", () => {
    const lines = captureOut(() => {
      log.detail("Removed copilot agent: skill-author");
      log.detail("Removed skill: presentation");
    });
    expect(lines).toEqual([]);
  });

  test("prints for a human, with the [pal] prefix intact", () => {
    delete process.env.PAL_TEST_SANDBOX;
    const lines = captureOut(() => log.detail("Removed copilot agent: skill-author"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[pal]");
    expect(lines[0]).toContain("Removed copilot agent: skill-author");
  });
});

describe("the levels a caller reports results through", () => {
  // These carry the CLI's actual output — `skill doctor` reports through them,
  // and tests assert on what they print. Silencing them would break that.
  test("info, success and warn print even under the test runner", () => {
    const lines = captureOut(() => {
      log.info("No skills found");
      log.success("Removed 6 agent(s): a, b");
      log.warn("Skipped renamed-away");
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("No skills found");
    expect(lines[1]).toContain("Removed 6 agent(s): a, b");
    expect(lines[2]).toContain("Skipped renamed-away");
  });
});
