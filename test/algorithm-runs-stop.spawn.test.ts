import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runStopHandlers } from "../src/hooks/lib/stop";
import {
  algorithmReply,
  changes,
  enterNode,
  inSandbox,
  makeSandbox,
  PAL_HEADER,
  prompt,
  type RunSandbox,
  runEvents,
} from "./lib/algorithm-run-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const HOOKS = resolve(import.meta.dir, "../src/hooks");

function transcriptFile(box: RunSandbox, reply: string): string {
  const path = resolve(box.home, "transcript.jsonl");
  const lines = [
    { type: "user", message: { content: "earlier ask" } },
    { type: "assistant", message: { content: [{ type: "text", text: PAL_HEADER }] } },
    { type: "user", message: { content: "next ask" } },
    { type: "assistant", message: { content: [{ type: "text", text: reply }] } },
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n"));

  return path;
}

function stopHook(box: RunSandbox, reply: string) {
  const result = spawnSync(
    "bun",
    ["run", resolve(HOOKS, "StopOrchestrator.ts"), "--agent=claude"],
    {
      input: JSON.stringify({
        session_id: "s1",
        transcript_path: transcriptFile(box, reply),
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
});
