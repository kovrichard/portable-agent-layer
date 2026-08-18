import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runStopHandlers } from "../src/hooks/lib/stop";

// runStopHandlers spawns detached children that keep writing into PAL_HOME after
// the test returns, so this directory can reappear after cleanup — .gitignore
// covers .test-home-* for exactly that reason.
const HOME = resolve(import.meta.dir, "../.test-home-stop-handlers");
const savedHome = process.env.PAL_HOME;

function transcriptOf(...contents: string[]): string {
  return JSON.stringify(
    contents.map((content, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content,
    }))
  );
}

function cachePath(): string {
  return resolve(HOME, "memory", "state", "last-responses.json");
}

function readCache(): Record<string, { response: string; ts: string }> {
  return JSON.parse(readFileSync(cachePath(), "utf-8"));
}

function seedCache(entries: Record<string, { response: string; ts: string }>) {
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
  writeFileSync(cachePath(), JSON.stringify(entries), "utf-8");
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
});

describe("runStopHandlers — transcript gate", () => {
  test("does nothing for a transcript with fewer than two messages", async () => {
    await runStopHandlers(transcriptOf("only one"), { sessionId: "s1" });

    expect(existsSync(cachePath())).toBe(false);
  });

  test("does nothing for an unparseable transcript", async () => {
    await runStopHandlers("not json at all", { sessionId: "s1" });

    expect(existsSync(cachePath())).toBe(false);
  });
});

describe("runStopHandlers — last-response cache", () => {
  test("caches the last assistant message under the session id", async () => {
    await runStopHandlers(transcriptOf("q", "the answer"), { sessionId: "sess-a" });

    expect(readCache()["sess-a"].response).toBe("the answer");
    expect(readCache()["sess-a"].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("prefers an explicitly supplied last assistant message", async () => {
    await runStopHandlers(transcriptOf("q", "from transcript"), {
      sessionId: "sess-a",
      lastAssistantMessage: "supplied directly",
    });

    expect(readCache()["sess-a"].response).toBe("supplied directly");
  });

  test("writes no cache when there is no session id", async () => {
    await runStopHandlers(transcriptOf("q", "an answer"));

    expect(existsSync(cachePath())).toBe(false);
  });

  test("truncates a long response to 2000 characters", async () => {
    await runStopHandlers(transcriptOf("q", "x".repeat(5000)), { sessionId: "sess-a" });

    expect(readCache()["sess-a"].response).toHaveLength(2000);
  });

  test("overwrites the entry for the same session", async () => {
    await runStopHandlers(transcriptOf("q", "first"), { sessionId: "sess-a" });
    await runStopHandlers(transcriptOf("q", "second"), { sessionId: "sess-a" });

    const cache = readCache();
    expect(Object.keys(cache)).toEqual(["sess-a"]);
    expect(cache["sess-a"].response).toBe("second");
  });

  test("keeps entries belonging to other sessions", async () => {
    await runStopHandlers(transcriptOf("q", "one"), { sessionId: "sess-a" });
    await runStopHandlers(transcriptOf("q", "two"), { sessionId: "sess-b" });

    expect(Object.keys(readCache()).sort()).toEqual(["sess-a", "sess-b"]);
  });

  test("starts a fresh cache when the existing file is corrupt", async () => {
    mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
    writeFileSync(cachePath(), "{ not json", "utf-8");

    await runStopHandlers(transcriptOf("q", "recovered"), { sessionId: "sess-a" });

    expect(readCache()["sess-a"].response).toBe("recovered");
  });

  test("caps the cache at twenty sessions, evicting the oldest", async () => {
    const seeded: Record<string, { response: string; ts: string }> = {};
    for (let i = 0; i < 20; i++) {
      seeded[`old-${String(i).padStart(2, "0")}`] = {
        response: "r",
        ts: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      };
    }
    seedCache(seeded);

    await runStopHandlers(transcriptOf("q", "newest"), { sessionId: "fresh" });

    const cache = readCache();
    expect(Object.keys(cache)).toHaveLength(20);
    expect(cache.fresh).toBeDefined();
    expect(cache["old-00"]).toBeUndefined();
    expect(cache["old-19"]).toBeDefined();
  });

  test("leaves the cache untouched at exactly twenty sessions", async () => {
    const seeded: Record<string, { response: string; ts: string }> = {};
    for (let i = 0; i < 19; i++) {
      seeded[`keep-${String(i).padStart(2, "0")}`] = {
        response: "r",
        ts: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      };
    }
    seedCache(seeded);

    await runStopHandlers(transcriptOf("q", "twentieth"), { sessionId: "fresh" });

    const cache = readCache();
    expect(Object.keys(cache)).toHaveLength(20);
    expect(cache["keep-00"]).toBeDefined();
  });
});

describe("runStopHandlers — pending failure claim", () => {
  function pendingPath(): string {
    return resolve(HOME, "memory", "state", "pending-failure.json");
  }

  test("claims a pending failure by moving it out of the state directory", async () => {
    mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
    writeFileSync(
      pendingPath(),
      JSON.stringify({ rating: 3, context: "bad", cwd: HOME }),
      "utf-8"
    );

    await runStopHandlers(transcriptOf("q", "an answer"), { sessionId: "sess-a" });

    expect(existsSync(pendingPath())).toBe(false);
  });

  test("completes normally when no pending failure exists", async () => {
    await runStopHandlers(transcriptOf("q", "an answer"), { sessionId: "sess-a" });

    expect(existsSync(pendingPath())).toBe(false);
    expect(readCache()["sess-a"]).toBeDefined();
  });
});
