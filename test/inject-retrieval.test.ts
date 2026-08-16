import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-inject-retrieval");

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory"), { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(async () => {
  for (const dir of [
    resolve(TEST_HOME, "memory", "learning"),
    resolve(TEST_HOME, "memory", "wisdom"),
  ]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
  const settingsPath = resolve(TEST_HOME, "memory", "pal-settings.json");
  if (existsSync(settingsPath)) rmSync(settingsPath);
  // Bust the in-memory settings cache so a test that disabled the flag
  // doesn't poison the next test that wants the default-true behavior.
  const settings = await import("../src/hooks/lib/settings");
  settings.reload();
});

function seedCapture(slug: string, ctx: string, principle: string) {
  const dir = resolve(TEST_HOME, "memory", "learning", "failures", "2026", "04", slug);
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    "rating: 3",
    `context: "${ctx}"`,
    `principle: "${principle}"`,
    "ts: 2026-04-15T10:00:00Z",
    `slug: ${slug}`,
    "---",
    "",
  ].join("\n");
  writeFileSync(resolve(dir, "capture.md"), fm);
}

async function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(TEST_HOME, "memory", "pal-settings.json"), JSON.stringify(data));
  const settings = await import("../src/hooks/lib/settings");
  settings.reload();
}

async function loadHandlers() {
  const t = Date.now();
  const mod = await import(`../src/hooks/handlers/inject-retrieval.ts?t=${t}`);
  return {
    injectPromptContext: mod.injectPromptContext as (prompt: string) => Promise<void>,
    getRetrievalReminder: mod.getRetrievalReminder as (
      prompt: string
    ) => Promise<string | null>,
    withinBudget: mod.withinBudget as <T>(work: () => T, ms: number) => T | null,
  };
}

function enableDebugLogging() {
  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });
  writeFileSync(resolve(TEST_HOME, "memory", "state", "debug-enabled"), "");
}

function readDebugLog(): string {
  const path = resolve(TEST_HOME, "debug", "debug.log");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function blockFor(ms: number): string {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* occupy the thread so no timer can interleave */
  }
  return "completed";
}

async function captureStdout(work: () => Promise<void>): Promise<string> {
  const original = process.stdout.write.bind(process.stdout);
  let captured = "";
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try {
    await work();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

describe("injectPromptContext handler", () => {
  test("emits empty when prompt is empty", async () => {
    const { injectPromptContext } = await loadHandlers();
    const out = await captureStdout(() => injectPromptContext(""));
    expect(out).toBe("");
  });

  test("emits empty when settings flag disabled", async () => {
    seedCapture(
      "20260415-100000_db-mock",
      "DB mock test failed",
      "Never mock the database"
    );
    await setSettings({
      dynamicContext: { learningInjection: false, contextualSteering: false },
    });
    const { injectPromptContext } = await loadHandlers();
    const out = await captureStdout(() =>
      injectPromptContext("should I mock the database in this test")
    );
    expect(out).toBe("");
  });

  test("emits empty when corpus is empty", async () => {
    const { injectPromptContext } = await loadHandlers();
    const out = await captureStdout(() => injectPromptContext("anything goes here"));
    expect(out).toBe("");
  });

  test("emits system-reminder when query matches a capture", async () => {
    seedCapture(
      "20260415-100000_db-mock",
      "Mocked database hid a migration bug",
      "Never mock the database in integration tests"
    );
    const { injectPromptContext } = await loadHandlers();
    const out = await captureStdout(() =>
      injectPromptContext("should I mock the database in this integration test")
    );
    expect(out).toContain("<system-reminder>");
    expect(out).toContain("Never mock the database");
    expect(out).toContain("</system-reminder>");
  });

  test("emits empty when query is unrelated to corpus", async () => {
    seedCapture(
      "20260415-100000_db-mock",
      "Mocked database hid a migration bug",
      "Never mock the database in integration tests"
    );
    const { injectPromptContext } = await loadHandlers();
    const out = await captureStdout(() =>
      injectPromptContext("kubernetes autoscaler manifests in helm chart")
    );
    expect(out).toBe("");
  });

  test("merges steering into the injection when the prompt matches (empty corpus)", async () => {
    // No corpus seeded → retrieval is null; steering must still reach stdout.
    const { injectPromptContext } = await loadHandlers();
    const out = await captureStdout(() =>
      injectPromptContext("the build is broken and tests are failing")
    );
    expect(out).toContain("<system-reminder>");
    expect(out).toContain("Debugging something?");
  });
});

describe("getRetrievalReminder", () => {
  test("returns null when prompt is empty", async () => {
    const { getRetrievalReminder } = await loadHandlers();
    expect(await getRetrievalReminder("")).toBeNull();
  });

  test("returns null when settings flag disabled", async () => {
    seedCapture(
      "20260415-100000_db-mock",
      "DB mock test failed",
      "Never mock the database"
    );
    await setSettings({ dynamicContext: { learningInjection: false } });
    const { getRetrievalReminder } = await loadHandlers();
    expect(
      await getRetrievalReminder("should I mock the database in this test")
    ).toBeNull();
  });

  test("returns null when corpus is empty", async () => {
    const { getRetrievalReminder } = await loadHandlers();
    expect(await getRetrievalReminder("anything goes here")).toBeNull();
  });

  test("returns reminder string when query matches a capture", async () => {
    seedCapture(
      "20260415-100000_db-mock",
      "Mocked database hid a migration bug",
      "Never mock the database in integration tests"
    );
    const { getRetrievalReminder } = await loadHandlers();
    const result = await getRetrievalReminder(
      "should I mock the database in this integration test"
    );
    expect(result).not.toBeNull();
    expect(result).toContain("<system-reminder>");
    expect(result).toContain("Never mock the database");
  });

  test("returns null when query is unrelated to corpus", async () => {
    seedCapture(
      "20260415-100000_db-mock",
      "Mocked database hid a migration bug",
      "Never mock the database in integration tests"
    );
    const { getRetrievalReminder } = await loadHandlers();
    expect(
      await getRetrievalReminder("kubernetes autoscaler manifests in helm chart")
    ).toBeNull();
  });
});

describe("withinBudget", () => {
  test("returns the value produced by the work", async () => {
    const { withinBudget } = await loadHandlers();
    expect(withinBudget(() => "value", 250)).toBe("value");
  });

  test("returns null when the work throws", async () => {
    const { withinBudget } = await loadHandlers();
    expect(
      withinBudget(() => {
        throw new Error("boom");
      }, 250)
    ).toBeNull();
  });

  test("returns the result of work that overruns the budget", async () => {
    // Regression guard: a timer cannot preempt synchronous work, so an overrun must
    // still yield its value. A racing setTimeout would discard it and return null.
    const { withinBudget } = await loadHandlers();
    expect(withinBudget(() => blockFor(60), 10)).toBe("completed");
  });

  test("logs an over-budget line when the work overruns", async () => {
    enableDebugLogging();
    const before = readDebugLog();
    const { withinBudget } = await loadHandlers();
    withinBudget(() => blockFor(60), 10);
    const added = readDebugLog().slice(before.length);
    expect(added).toContain("inject-retrieval: over budget:");
    expect(added).toMatch(/over budget: \d+ms > 10ms/);
  });

  test("logs nothing when the work stays within budget", async () => {
    enableDebugLogging();
    const before = readDebugLog();
    const { withinBudget } = await loadHandlers();
    withinBudget(() => "fast", 250);
    expect(readDebugLog().slice(before.length)).not.toContain("over budget");
  });
});
