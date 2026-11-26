import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eventsSince } from "../src/bronze/events";
import { reload } from "../src/core/settings";
import { capturePalBugSignal, judgePalBug } from "../src/hooks/handlers/pal-bug";
import type { inference } from "../src/inference/inference";
import {
  namesPalSurface,
  PAL_BUG_SYSTEM,
  palBugJudgment,
  palBugSchema,
  palBugUser,
  parsePalBug,
} from "../src/report/pal-bug";
import { listSignals } from "../src/report/signals";
import { freshTestDir } from "./lib/test-home";

const CONFIG = resolve(import.meta.dir, "../eval/pal-bug/promptfoo.yaml");

interface EvalCase {
  description: string;
  vars: { message: string; expect: "bug" | "none" };
}

async function evalConfig(): Promise<{ prompts: { raw: string }[]; tests: EvalCase[] }> {
  return Bun.YAML.parse(await Bun.file(CONFIG).text()) as {
    prompts: { raw: string }[];
    tests: EvalCase[];
  };
}

beforeEach(() => {
  process.env.PAL_HOME = resolve(freshTestDir(import.meta.file), "home");
  reload();
});

describe("the pre-filter", () => {
  test("lets every eval positive through to the judge", async () => {
    const missed = (await evalConfig()).tests
      .filter((c) => c.vars.expect === "bug")
      .map((c) => c.vars.message)
      .filter((message) => !namesPalSurface(message));

    expect(missed).toEqual([]);
  });

  test("holds back messages that name no PAL surface", () => {
    for (const message of [
      "the build is red again",
      "rename the button to Save",
      "give me more context on the client",
      "palette colours look off",
    ])
      expect(namesPalSurface(message)).toBe(false);
  });
});

describe("parsePalBug", () => {
  test("keeps the surface of a bug and drops it otherwise", () => {
    expect(parsePalBug('{"pal_bug":true,"surface":" stop-hook "}')).toEqual({
      palBug: true,
      surface: "stop-hook",
    });
    expect(parsePalBug('{"pal_bug":false,"surface":"stop-hook"}')).toEqual({
      palBug: false,
      surface: "",
    });
    expect(parsePalBug('{"pal_bug":true}')).toEqual({ palBug: true, surface: "" });
  });

  test("no verdict from missing or broken output", () => {
    expect(parsePalBug('{"pal_bug":"yes"}')).toBeNull();
    expect(parsePalBug("null")).toBeNull();
    expect(parsePalBug("not json")).toBeNull();
    expect(parsePalBug(undefined)).toBeNull();
  });
});

describe("the judgment", () => {
  test("asks the small tier with the shipped prompt and schema", () => {
    const judgment = palBugJudgment("doctor fails", "s1");

    expect(judgment).toMatchObject({
      caller: "pal-bug",
      state: { message: "doctor fails" },
      sessionId: "s1",
    });
    expect(judgment.fallback?.request).toMatchObject({
      system: PAL_BUG_SYSTEM,
      user: palBugUser("doctor fails"),
      jsonSchema: palBugSchema(),
      caller: "pal-bug",
      sessionId: "s1",
    });
    expect(judgment.fallback?.parse('{"pal_bug":true,"surface":"doctor"}')).toEqual({
      pal_bug: { noul: true },
    });
    expect(judgment.fallback?.parse("x")).toBeNull();
  });

  test("a long message is cut at 800 characters", () => {
    expect(palBugUser("x".repeat(900))).toContain(`${"x".repeat(800)}\n</message>`);
  });

  test("the eval sends the user prompt palBugUser builds", async () => {
    const raw = (await evalConfig()).prompts[0].raw;

    expect(raw.replace("{{message}}", "Broken.").trimEnd()).toBe(palBugUser("Broken."));
  });

  test("the verdict lands in bronze as a judge_call and nothing else happens", async () => {
    const infer = (async () => ({
      success: true,
      output: '{"pal_bug":true,"surface":"doctor"}',
    })) as unknown as typeof inference;
    await judgePalBug("doctor fails badly", "s1", { infer });

    expect(eventsSince("judge_call", new Date(0))).toEqual([
      expect.objectContaining({
        caller: "pal-bug",
        mode: "off",
        route: "fallback",
        fallbackAnswers: { pal_bug: { noul: true } },
      }),
    ]);
    expect(listSignals(new Date(0))).toEqual([
      expect.objectContaining({
        trigger: "message",
        surface: "doctor",
        verdict: true,
        message: "doctor fails badly",
      }),
    ]);
  });

  test("a judge that gives no answer still leaves the message to label", async () => {
    const infer = (async () => ({
      success: false,
      output: "",
    })) as unknown as typeof inference;
    await judgePalBug("the hook hangs", "s1", { infer });

    expect(listSignals(new Date(0))).toEqual([
      expect.objectContaining({ verdict: null, surface: "", message: "the hook hangs" }),
    ]);
  });
});

describe("capturePalBugSignal", () => {
  function deps(canInfer = true) {
    const spawned: string[][] = [];

    return {
      spawned,
      deps: {
        canInfer: () => canInfer,
        spawn: (_script: string, args: string[]) => {
          spawned.push(args);
        },
      },
    };
  }

  test("spawns the judge with the cleaned message", () => {
    const { spawned, deps: d } = deps();
    capturePalBugSignal("  the stop hook hangs  ", "s1", d);

    expect(spawned).toEqual([
      ["--pal-bug", "s1", Buffer.from("the stop hook hangs").toString("base64")],
    ]);
  });

  test("leaves alone messages without a PAL surface, commands and system text", () => {
    const { spawned, deps: d } = deps();
    capturePalBugSignal("the build is red", "s1", d);
    capturePalBugSignal("/pal-analyze hooks", "s1", d);
    capturePalBugSignal("<task-notification>hook done</task-notification>", "s1", d);

    expect(spawned).toEqual([]);
  });

  test("does nothing when no agent can infer", () => {
    const { spawned, deps: d } = deps(false);
    capturePalBugSignal("doctor fails", undefined, d);

    expect(spawned).toEqual([]);
  });
});
