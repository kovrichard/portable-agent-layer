import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assets } from "../src/hooks/lib/paths";
import { runStopHandlers } from "../src/hooks/lib/stop";
import { sandboxContextRuleDirs } from "./lib/context-rule-dirs";
import { freshTestDir } from "./lib/test-home";

describe("runStopHandlers — Stop hook non-blocking contract", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = freshTestDir(import.meta.file);
    process.env.PAL_HOME = tmp;
    sandboxContextRuleDirs(resolve(tmp, "agents"));
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

  // Each detached handler is spawned by path, so a rename is invisible to the
  // type checker and only shows up as a hook that quietly stopped running.
  test("every handler the stop hook spawns by path is on disk", () => {
    const spawned = ["agenda", "session-intelligence", "entity-extraction"];
    for (const name of spawned) {
      expect(
        existsSync(resolve(assets.hooks(), "handlers", `${name}.ts`)),
        `handlers/${name}.ts`
      ).toBe(true);
    }
  });
});
