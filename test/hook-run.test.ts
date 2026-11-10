import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  logHookRun,
  noteHookPayload,
  noteHookPayloadText,
  recordHookRunOnExit,
} from "../src/hooks/lib/hook-run";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
  noteHookPayload({});
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

describe("a logged hook run", () => {
  test("names the entry without its folder or extension, with the rounded duration", () => {
    logHookRun("/pal/src/hooks/StopOrchestrator.ts", 2, 41.6);

    expect(hookRuns()).toEqual([
      expect.objectContaining({
        hook: "StopOrchestrator",
        event: null,
        session: null,
        durationMs: 42,
        exitCode: 2,
        project: null,
      }),
    ]);
  });

  test("strips a .js or .mjs extension too", () => {
    logHookRun("hooks/a.js", 0, 1);
    logHookRun("hooks/b.mjs", 0, 1);

    expect(hookRuns().map((r) => r.hook)).toEqual(["a", "b"]);
  });

  test("without a duration it counts from process start", () => {
    logHookRun("X.ts", 0);

    const [run] = hookRuns();
    expect(Number.isInteger(run.durationMs)).toBe(true);
    expect(run.durationMs as number).toBeGreaterThan(0);
  });

  test("carries the event and session of the payload the hook read", () => {
    noteHookPayload({ hook_event_name: "Stop", session_id: "s1" });
    logHookRun("X.ts", 0, 1);

    expect(hookRuns()[0]).toMatchObject({ event: "Stop", session: "s1" });
  });
});

describe("the payload a hook read", () => {
  test("takes each runtime's own names for the event and the session", () => {
    noteHookPayload({ hookEventName: "agentStop", sessionId: "cp1" });
    logHookRun("X.ts", 0, 1);
    noteHookPayload({ hook_event_name: "stop", conversation_id: "cur1" });
    logHookRun("X.ts", 0, 1);

    expect(hookRuns().map((r) => [r.event, r.session])).toEqual([
      ["agentStop", "cp1"],
      ["stop", "cur1"],
    ]);
  });

  test("skips empty or non-text values for the next name", () => {
    noteHookPayload({
      hook_event_name: "",
      hookEventName: "E",
      session_id: 7,
      sessionId: "s",
    });
    logHookRun("X.ts", 0, 1);

    expect(hookRuns()[0]).toMatchObject({ event: "E", session: "s" });
  });

  test("a payload that is not an object changes nothing", () => {
    noteHookPayload({ hook_event_name: "Stop", session_id: "s1" });
    noteHookPayload(null);
    noteHookPayload("text");
    logHookRun("X.ts", 0, 1);

    expect(hookRuns()[0]).toMatchObject({ event: "Stop", session: "s1" });
  });

  test("read as text, it is parsed; text that is not JSON changes nothing", () => {
    noteHookPayloadText('{"hook_event_name":"PreToolUse","session_id":"t1"}');
    noteHookPayloadText("not json");
    logHookRun("X.ts", 0, 1);

    expect(hookRuns()[0]).toMatchObject({ event: "PreToolUse", session: "t1" });
  });
});

describe("recording a run on exit", () => {
  test("logs once the process exits, with its exit code", () => {
    const listeners: ((code: number) => void)[] = [];
    recordHookRunOnExit("/x/SkillGuard.ts", (listener) => listeners.push(listener));

    expect(hookRuns()).toEqual([]);
    for (const listener of listeners) listener(3);
    expect(hookRuns()).toEqual([
      expect.objectContaining({ hook: "SkillGuard", exitCode: 3 }),
    ]);
  });
});
