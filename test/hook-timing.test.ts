import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startHookTiming } from "../src/hooks/lib/hook-timing";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let home: string;

function timings(): Record<string, unknown>[] {
  const file = resolve(
    home,
    "memory",
    "events",
    `${new Date().toISOString().slice(0, 7)}.jsonl`
  );
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "hook_timing");
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("hook timing", () => {
  test("one event per run names the hook, its total and each handler's time", async () => {
    const timing = startHookTiming("stop");
    await timing.time("slow", Bun.sleep(30));
    await timing.time("fast", () => 1);
    timing.log("s1");
    const [event] = timings();
    const handlers = event?.handlers as Record<string, number>;
    expect(event).toMatchObject({ hook: "stop", session: "s1" });
    expect(handlers.slow).toBeGreaterThanOrEqual(25);
    expect(handlers.fast).toBeLessThan(handlers.slow as number);
    expect(event?.totalMs as number).toBeGreaterThanOrEqual(handlers.slow as number);
  });

  test("a handler that throws is still timed, and the error still reaches the caller", async () => {
    const timing = startHookTiming("stop");
    const failing = timing.time("broken", async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    timing.log(null);
    expect(Object.keys(timings()[0]?.handlers as object)).toEqual(["broken"]);
  });
});
