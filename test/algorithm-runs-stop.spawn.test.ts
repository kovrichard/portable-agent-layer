import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runStopHandlers } from "../src/hooks/lib/stop";
import {
  algorithmReply,
  assistantText,
  bash,
  changes,
  edit,
  enterNode,
  inSandbox,
  makeSandbox,
  PAL_HEADER,
  prompt,
  type RunSandbox,
  runEvents,
  transcriptLines,
  userPrompt,
} from "./lib/algorithm-run-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const HOOKS = resolve(import.meta.dir, "../src/hooks");

function transcriptFile(
  box: RunSandbox,
  reply: string,
  calls: Record<string, unknown>[]
): string {
  const path = resolve(box.home, "transcript.jsonl");
  const lines = [
    userPrompt("earlier ask"),
    edit("earlier.ts"),
    assistantText(PAL_HEADER),
    userPrompt("next ask"),
    ...calls,
    assistantText(reply),
  ];
  writeFileSync(path, transcriptLines(lines).join("\n"));

  return path;
}

function stopHook(box: RunSandbox, reply: string, calls: Record<string, unknown>[] = []) {
  const result = spawnSync(
    "bun",
    ["run", resolve(HOOKS, "StopOrchestrator.ts"), "--agent=claude"],
    {
      input: JSON.stringify({
        session_id: "s1",
        transcript_path: transcriptFile(box, reply, calls),
        last_assistant_message: reply,
      }),
      encoding: "utf-8",
      cwd: box.project,
      env: process.env,
    }
  );

  return { status: result.status, stdout: result.stdout };
}

describe("the stop records ALGORITHM turns", () => {
  test("runStopHandlers appends the turn from the texts after the last prompt", async () => {
    const box = makeSandbox(freshTestDir(import.meta.file));
    await inSandbox(box, async () => {
      enterNode(box, "n1", "s1");
      prompt("s1", new Date());
      await runStopHandlers(
        [
          { role: "user", content: "earlier ask" },
          { role: "assistant", content: PAL_HEADER },
          { role: "user", content: "next ask" },
          { role: "assistant", content: "plain" },
        ],
        { sessionId: "s1" }
      );
      expect(runEvents()).toEqual([]);
      await runStopHandlers(
        [
          { role: "user", content: "next ask" },
          { role: "assistant", content: "looking" },
          { role: "assistant", content: algorithmReply(["OBSERVE"]) },
        ],
        { sessionId: "s1" }
      );
      expect(runEvents().map((e) => [e.change, e.source, e.headerFirst])).toEqual([
        ["turn", "transcript", false],
      ]);
    });
  });
});

describe("shadow mode", () => {
  test("the stop hook's output and exit code are the same with and without an over-open-run verdict", async () => {
    const box = makeSandbox(freshTestDir(import.meta.file));
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      prompt("s1", new Date());
      const started = stopHook(box, algorithmReply(["OBSERVE", "PLAN"]));
      prompt("s1", new Date());
      const overOpen = stopHook(box, algorithmReply(["OBSERVE", "PLAN"]));
      expect(changes()).toEqual(["turn", "superseded", "turn"]);
      expect(runEvents().map((e) => e.verdict ?? null)).toEqual([
        "started",
        null,
        "over-open-run",
      ]);
      expect(overOpen).toEqual(started);
      expect(started.status).toBe(0);
      expect(started.stdout).not.toContain("decision");
    });
  });

  test("the stop hook reads the turn's tool calls, and a would-nudge verdict changes nothing it returns", async () => {
    const box = makeSandbox(freshTestDir(import.meta.file));
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      const reply = algorithmReply(["OBSERVE", "PLAN", "EXECUTE"]);
      prompt("s1", new Date());
      const clean = stopHook(box, reply, [
        edit(),
        bash("bun test"),
        bash("pal cli algorithm-reflect --task t"),
      ]);
      prompt("s1", new Date());
      const nudged = stopHook(box, reply, [edit()]);
      expect(
        runEvents()
          .filter((e) => e.change === "turn")
          .map((e) => [e.runType, e.wouldNudge, e.exempt])
      ).toEqual([
        [["code"], [], null],
        [["code"], ["no-reflection", "no-check-after-edit"], null],
      ]);
      expect(nudged).toEqual(clean);
    });
  });
});
