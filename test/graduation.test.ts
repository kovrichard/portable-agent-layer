import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir, testHome } from "./lib/test-home";

const TEST_HOME = testHome(import.meta.file);

let savedApiKey: string | undefined;

beforeAll(() => {
  savedApiKey = process.env.PAL_ANTHROPIC_API_KEY;
  delete process.env.PAL_ANTHROPIC_API_KEY;
  removeOnceReleased(TEST_HOME);

  // Create failure entries with capture.md (need 3+ similar ones to trigger graduation)
  for (let i = 1; i <= 4; i++) {
    const slug = `20260322-10000${i}_test-failure-${i}`;
    const dir = resolve(TEST_HOME, "memory", "learning", "failures", "2026", "03", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "capture.md"),
      [
        "---",
        "rating: 2",
        `context: "semantic-release published wrong version number again"`,
        `date: "2026-03-${20 + i}"`,
        `ts: "2026-03-${20 + i}T10:00:0${i}.000Z"`,
        `slug: "${slug}"`,
        `principle: "Always verify semantic-release version before publishing"`,
        "---",
        "",
        "## What Went Wrong?",
        "Version mismatch.",
      ].join("\n")
    );
  }

  // Create a different pattern (only 2x — should NOT graduate)
  for (let i = 1; i <= 2; i++) {
    const slug = `20260322-20000${i}_other-issue-${i}`;
    const dir = resolve(TEST_HOME, "memory", "learning", "failures", "2026", "03", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "capture.md"),
      [
        "---",
        "rating: 3",
        `context: "UI rendering was completely broken on mobile"`,
        `date: "2026-03-${20 + i}"`,
        `ts: "2026-03-${20 + i}T11:00:0${i}.000Z"`,
        `slug: "${slug}"`,
        "---",
        "",
        "## What Went Wrong?",
        "Mobile layout broke.",
      ].join("\n")
    );
  }

  // Create principle-based failure entries (3x with similar principles)
  for (let i = 1; i <= 3; i++) {
    const slug = `20260322-30000${i}_principle-failure-${i}`;
    const dir = resolve(TEST_HOME, "memory", "learning", "failures", "2026", "03", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "capture.md"),
      [
        "---",
        "rating: 2",
        `context: "npm package registry upload kept failing silently"`,
        `date: "2026-03-2${i}"`,
        `ts: "2026-03-2${i}T12:00:0${i}.000Z"`,
        `slug: "${slug}"`,
        `principle: "Always verify package version before publishing to npm registry"`,
        "---",
        "",
        "## What Went Wrong?",
        "Version mismatch.",
      ].join("\n")
    );
  }

  // Create wisdom directories
  mkdirSync(resolve(TEST_HOME, "memory", "wisdom", "frames"), { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory", "wisdom", "state"), { recursive: true });

  // Create signals directory with empty ratings
  mkdirSync(resolve(TEST_HOME, "memory", "signals"), { recursive: true });
  writeFileSync(resolve(TEST_HOME, "memory", "signals", "ratings.jsonl"), "");

  process.env.PAL_HOME = TEST_HOME;
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (savedApiKey) process.env.PAL_ANTHROPIC_API_KEY = savedApiKey;
  removeOnceReleased(TEST_HOME);
});

describe("learning-store", () => {
  test("readFailures returns entries from capture.md", async () => {
    const { readFailures } = await import("../src/hooks/lib/learning-store");
    const failuresDir = resolve(TEST_HOME, "memory", "learning", "failures");
    const entries = readFailures(failuresDir);
    expect(entries.length).toBeGreaterThanOrEqual(9);
    expect(entries[0].context).toBeTruthy();
    expect(entries[0].rating).toBeGreaterThan(0);
  });

  test("readFailures respects limit", async () => {
    const { readFailures } = await import("../src/hooks/lib/learning-store");
    const failuresDir = resolve(TEST_HOME, "memory", "learning", "failures");
    const entries = readFailures(failuresDir, 3);
    expect(entries.length).toBe(3);
  });
});

describe("analyze", () => {
  test("detects patterns with 3+ occurrences", async () => {
    const { analyze } = await import("../src/hooks/lib/graduation");
    const result = await analyze();

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    // The version/publish failures group together via principle similarity
    const versionPattern = result.candidates.find((c) =>
      c.entries.some((e) => e.source.includes("test-failure"))
    );
    expect(versionPattern).toBeTruthy();
    expect(versionPattern?.entries.length).toBeGreaterThanOrEqual(3);
  });

  test("does not include patterns with <3 occurrences as candidates", async () => {
    const { analyze } = await import("../src/hooks/lib/graduation");
    const result = await analyze();

    const uiPattern = result.candidates.find((c) =>
      c.pattern.toLowerCase().includes("ui rendering")
    );
    expect(uiPattern).toBeUndefined();
  });

  test("does not write to wisdom frames", async () => {
    const { analyze } = await import("../src/hooks/lib/graduation");
    await analyze();

    const framesDir = resolve(TEST_HOME, "memory", "wisdom", "frames");
    const frames = existsSync(framesDir)
      ? readdirSync(framesDir).filter((f) => f.endsWith(".md"))
      : [];
    expect(frames).toHaveLength(0);
  });

  test("reports correct confidence for occurrences", async () => {
    const { analyze } = await import("../src/hooks/lib/graduation");
    const result = await analyze();

    // test-failure entries share the same context (4x) — grouped separately from principle-failure
    // 4 occurrences: 60 + (4-3)*10 = 70%
    const candidate = result.graduated.find((g) =>
      g.sources.some((s) => s.includes("test-failure"))
    );
    expect(candidate).toBeTruthy();
    expect(candidate?.confidence).toBe(70);
  });

  test("groups entries by similar context text", async () => {
    const { analyze } = await import("../src/hooks/lib/graduation");
    const result = await analyze();

    const npmGroup = result.candidates.find((c) =>
      c.entries.some((e) => e.text.includes("npm package registry"))
    );
    expect(npmGroup).toBeTruthy();
    expect(npmGroup?.entries.length).toBeGreaterThanOrEqual(3);
  });

  test("returns ratings summary", async () => {
    const { analyze } = await import("../src/hooks/lib/graduation");
    const result = await analyze();
    // Ratings file is empty in test, so null is expected
    expect(result.ratings).toBeNull();
  });
});

describe("recommendations without an API key", () => {
  let binDir: string;
  let savedPath: string | undefined;

  beforeAll(() => {
    binDir = freshTestDir(import.meta.file);
    savedPath = process.env.PATH;
    delete process.env.PAL_INFERENCE_DISABLED;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    process.env.PAL_AGENT = "claude";
    const reply = { recommendations: ["Check the npm registry before installing."] };
    writeFakeBin(
      binDir,
      "claude",
      `console.log(${JSON.stringify(JSON.stringify(reply))});\n`
    );
    prependPath(binDir);
  });

  afterAll(() => {
    process.env.PATH = savedPath;
    process.env.PAL_INFERENCE_DISABLED = "1";
    delete process.env.PAL_AGENT;
    removeOnceReleased(binDir);
  });

  test("come from the agent's own CLI", async () => {
    const { analyze } = await import("../src/hooks/lib/graduation");
    const result = await analyze({ actionable: true });
    expect(result.recommendations).toEqual(["Check the npm registry before installing."]);
  });
});
