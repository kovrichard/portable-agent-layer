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
  sessionId?: string;
  lastUser?: string;
  lastAssistant?: string;
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

  test("a new session replaces an earlier session's summary", async () => {
    seedHandoff(deliberate({ source: "auto", handoff: "stale auto text" }));
    await runPersist();
    const entry = readEntry();
    expect(entry.handoff).toBe("");
    expect(entry.lastUser).toBe("raw auto snapshot user msg");
    expect(entry.lastAssistant).toBe("raw auto snapshot assistant msg");
    expect(entry.source).toBe("auto");
  });

  test("the same session keeps its summary and refreshes the exchange beside it", async () => {
    seedHandoff(
      deliberate({ source: "auto", handoff: "Next: run the gates", sessionId: "sess-1" })
    );
    await runPersist();
    const entry = readEntry();
    expect(entry.handoff).toBe("Next: run the gates");
    expect(entry.lastUser).toBe("raw auto snapshot user msg");
  });

  test("a summary landing after the exchange keeps the exchange", async () => {
    const { persistLastExchange, writeAutoHandoff } = await import(
      "../src/hooks/handlers/persist-last-exchange"
    );
    persistLastExchange(messages, "sess-1", CWD);
    writeAutoHandoff(CWD, {
      title: "Summary",
      status: "in-progress",
      handoff: "Next: ship it",
      sessionId: "sess-1",
    });
    const entry = readEntry();
    expect(entry.handoff).toBe("Next: ship it");
    expect(entry.lastUser).toBe("raw auto snapshot user msg");
  });

  test("a protected deliberate note keeps its text and still gets the exchange", async () => {
    seedHandoff(deliberate());
    await runPersist();
    const entry = readEntry();
    expect(entry.handoff).toBe("THE FULL PLAN — step 1, step 2, step 3");
    expect(entry.lastUser).toBe("raw auto snapshot user msg");
  });

  test("overwrites a stale (>7d) deliberate handoff", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    seedHandoff(deliberate({ timestamp: eightDaysAgo }));
    await runPersist();
    expect(readEntry().source).toBe("auto");
    expect(readEntry().lastUser).toContain("raw auto snapshot");
  });

  test("overwrites a deliberate handoff already marked completed", async () => {
    seedHandoff(deliberate({ status: "completed" }));
    await runPersist();
    expect(readEntry().source).toBe("auto");
    expect(readEntry().lastUser).toContain("raw auto snapshot");
  });

  test("keeps the closing paragraph of a long reply, cut at a word", async () => {
    const { persistLastExchange } = await import(
      "../src/hooks/handlers/persist-last-exchange"
    );
    const reply = `First the verdict, at length.\n\n${"word ".repeat(80)}ask?`;
    persistLastExchange([messages[0], { role: "assistant", content: reply }], "s", CWD);
    const kept = readEntry().lastAssistant ?? "";
    expect(kept.startsWith("word word")).toBe(true);
    expect(kept.endsWith("…")).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(301);
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

  test("files the handoff under the folder the session started in, not where it cd'd to", async () => {
    const saved = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = CWD;
    try {
      const { persistLastExchange } = await import(
        "../src/hooks/handlers/persist-last-exchange"
      );
      persistLastExchange(messages, "sess-1");
      expect(readEntry().lastUser).toBe("raw auto snapshot user msg");
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = saved;
    }
  });
});
