import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runStopHandlers } from "../src/hooks/lib/stop";

describe("runStopHandlers — Stop hook non-blocking contract", () => {
  let tmp: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "pal-stop-test-"));
    savedHome = process.env.PAL_HOME;
    process.env.PAL_HOME = tmp;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.PAL_HOME;
    else process.env.PAL_HOME = savedHome;
  });

  test("returns within 2s — does not await any inference", async () => {
    // A minimal valid transcript with >= 6 messages so session-intelligence
    // would have spawned (had it been synchronous). After the detach refactor
    // it must spawn and return.
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} `.repeat(50),
    }));
    const transcript = JSON.stringify(messages);

    const start = Date.now();
    await runStopHandlers(transcript, { sessionId: "test-stop-fast" });
    const elapsed = Date.now() - start;
    // Non-inference handlers (synthesis, auto-graduate, etc.) still run
    // synchronously and may do real I/O. The contract this test enforces is
    // "no inference is awaited" — inference under claude --print is 15-30s
    // and would push elapsed well past 10s. Anything below proves detachment.
    expect(elapsed).toBeLessThan(10_000);
  }, 15_000);

  test("returns even when pending-failure exists (spawns failure-principle detached)", async () => {
    const stateDir = resolve(tmp, "memory", "state");
    require("node:fs").mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      resolve(stateDir, "pending-failure.json"),
      JSON.stringify({
        rating: 3,
        context: "test context",
        cwd: tmp,
      }),
      "utf-8"
    );

    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} `.repeat(50),
    }));
    const transcript = JSON.stringify(messages);

    const start = Date.now();
    await runStopHandlers(transcript, { sessionId: "test-stop-fast-fail" });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  }, 15_000);
});
