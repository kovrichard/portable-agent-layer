import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
    injectRetrieval: mod.injectRetrieval as (prompt: string) => Promise<void>,
    getRetrievalReminder: mod.getRetrievalReminder as (
      prompt: string
    ) => Promise<string | null>,
  };
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

describe("injectRetrieval handler", () => {
  test("emits empty when prompt is empty", async () => {
    const { injectRetrieval } = await loadHandlers();
    const out = await captureStdout(() => injectRetrieval(""));
    expect(out).toBe("");
  });

  test("emits empty when settings flag disabled", async () => {
    seedCapture(
      "20260415-100000_db-mock",
      "DB mock test failed",
      "Never mock the database"
    );
    await setSettings({ dynamicContext: { learningInjection: false } });
    const { injectRetrieval } = await loadHandlers();
    const out = await captureStdout(() =>
      injectRetrieval("should I mock the database in this test")
    );
    expect(out).toBe("");
  });

  test("emits empty when corpus is empty", async () => {
    const { injectRetrieval } = await loadHandlers();
    const out = await captureStdout(() => injectRetrieval("anything goes here"));
    expect(out).toBe("");
  });

  test("emits system-reminder when query matches a capture", async () => {
    seedCapture(
      "20260415-100000_db-mock",
      "Mocked database hid a migration bug",
      "Never mock the database in integration tests"
    );
    const { injectRetrieval } = await loadHandlers();
    const out = await captureStdout(() =>
      injectRetrieval("should I mock the database in this integration test")
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
    const { injectRetrieval } = await loadHandlers();
    const out = await captureStdout(() =>
      injectRetrieval("kubernetes autoscaler manifests in helm chart")
    );
    expect(out).toBe("");
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
