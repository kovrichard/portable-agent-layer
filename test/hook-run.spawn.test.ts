import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const HOOKS = resolve(import.meta.dir, "..", "src", "hooks");
let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  mkdirSync(resolve(home, "memory"), { recursive: true });
});

function hookRuns(): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").split("\n"))
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "hook_run");
}

function runHook(file: string, stdin: string, env: Record<string, string> = {}): number {
  const result = Bun.spawnSync(["bun", resolve(HOOKS, file), "--agent=claude"], {
    stdin: new TextEncoder().encode(stdin),
    env: { ...process.env, PAL_HOME: home, PAL_AGENT: "claude", ...env },
  });
  return result.exitCode;
}

describe("a PAL hook run", () => {
  test("logs its hook, event, session, exit code and how long it took", () => {
    const payload = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      prompt: "hi",
    });
    expect(runHook("PromptTransformed.ts", payload)).toBe(0);

    const [run] = hookRuns();
    expect(run).toMatchObject({
      hook: "PromptTransformed",
      event: "UserPromptSubmit",
      session: "s1",
      exitCode: 0,
    });
    expect(run.durationMs as number).toBeGreaterThan(0);
  });

  test("a hook that exits before reading its input is still logged", () => {
    runHook("PromptTransformed.ts", "{}", { PAL_SPAWNED_INFERENCE: "1" });

    expect(hookRuns()).toEqual([
      expect.objectContaining({ hook: "PromptTransformed", event: null }),
    ]);
  });
});

describe("every hook entry point", () => {
  test("starts by recording its run", () => {
    const entries = readdirSync(HOOKS).filter((f) => f.endsWith(".ts"));
    const missing = entries.filter(
      (f) => !readFileSync(resolve(HOOKS, f), "utf-8").includes("recordHookRunOnExit();")
    );
    expect(missing).toEqual([]);
  });
});
