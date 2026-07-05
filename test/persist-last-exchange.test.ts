import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME = resolve(import.meta.dir, "../.test-home-persist");
const STATE = resolve(HOME, "memory", "state");
const HANDOFF = resolve(STATE, "last-handoff.json");
const CWD = "/fake/project";

const messages = [
  { role: "user", content: "raw auto snapshot user msg" },
  { role: "assistant", content: "raw auto snapshot assistant msg" },
];

type Entry = {
  timestamp: string;
  title: string;
  status: string;
  handoff: string;
  artifacts: string[];
  source?: string;
};

function seedHandoff(entry: Entry) {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(HANDOFF, JSON.stringify({ [CWD]: entry }, null, 2));
}

function readEntry(): Entry {
  return JSON.parse(readFileSync(HANDOFF, "utf-8"))[CWD];
}

function deliberate(overrides: Partial<Entry> = {}): Entry {
  return {
    timestamp: new Date().toISOString(),
    title: "The curated plan",
    status: "in-progress",
    handoff: "THE FULL PLAN — step 1, step 2, step 3",
    artifacts: [],
    source: "deliberate",
    ...overrides,
  };
}

async function runPersist() {
  const { persistLastExchange } = await import(
    "../src/hooks/handlers/persist-last-exchange"
  );
  persistLastExchange(messages, "sess-1", CWD);
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("persistLastExchange — handoff protection (ISC-39)", () => {
  test("preserves a fresh deliberate in-progress handoff", async () => {
    seedHandoff(deliberate());
    await runPersist();
    const entry = readEntry();
    expect(entry.handoff).toBe("THE FULL PLAN — step 1, step 2, step 3");
    expect(entry.source).toBe("deliberate");
    expect(entry.handoff).not.toContain("raw auto snapshot");
  });

  test("overwrites an auto snapshot with the newer exchange", async () => {
    seedHandoff(deliberate({ source: "auto", handoff: "stale auto text" }));
    await runPersist();
    const entry = readEntry();
    expect(entry.handoff).toContain("raw auto snapshot");
    expect(entry.source).toBe("auto");
  });

  test("overwrites a stale (>7d) deliberate handoff", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    seedHandoff(deliberate({ timestamp: eightDaysAgo }));
    await runPersist();
    expect(readEntry().handoff).toContain("raw auto snapshot");
  });

  test("overwrites a deliberate handoff already marked completed", async () => {
    seedHandoff(deliberate({ status: "completed" }));
    await runPersist();
    expect(readEntry().handoff).toContain("raw auto snapshot");
  });

  test("still writes last-exchange/latest.json even when handoff is preserved", async () => {
    seedHandoff(deliberate());
    await runPersist();
    // handoff preserved…
    expect(readEntry().handoff).not.toContain("raw auto snapshot");
    // …but CompactRecover's raw exchange is unaffected
    const latest = resolve(STATE, "last-exchange", "latest.json");
    expect(existsSync(latest)).toBe(true);
    expect(readFileSync(latest, "utf-8")).toContain("raw auto snapshot user msg");
  });
});
