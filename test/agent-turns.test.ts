import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hookSessionId } from "../src/hooks/lib/hook-turn";
import { observeTurn, type TurnEvent } from "../src/hooks/lib/interaction";
import { reload } from "../src/hooks/lib/settings";
import { stopTurn } from "../src/hooks/lib/stop";

// stopTurn can spawn detached children that keep writing into PAL_HOME after the
// test returns; .gitignore covers .test-home-* for that reason.
const HOME = resolve(import.meta.dir, "../.test-home-agent-turns");
const savedHome = process.env.PAL_HOME;

beforeEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  process.env.PAL_HOME = HOME;
  reload();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  reload();
  rmSync(HOME, { recursive: true, force: true });
});

function loggedTurns(): TurnEvent[] {
  const dir = resolve(HOME, "memory", "signals", "interaction");
  if (!existsSync(dir)) return [];
  const month = new Date().toISOString().slice(0, 7);
  return readFileSync(resolve(dir, `${month}.jsonl`), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function transcriptFile(name: string, lines: unknown[]): string {
  const path = resolve(HOME, name);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

/** The next prompt carries the shape of the reply that answered the last one. */
function replyFiledFor(session: string): TurnEvent["reply"] {
  observeTurn("thanks, next one", session);
  return loggedTurns().at(-1)?.reply ?? null;
}

describe("codex", () => {
  const prompt = { session_id: "thr_1", turn_id: "t1", prompt: "rename the column" };

  test("files the reply it hands over even when its transcript is unreadable", async () => {
    observeTurn(prompt.prompt, hookSessionId(prompt));
    const stop = {
      session_id: "thr_1",
      turn_id: "t1",
      stop_hook_active: false,
      transcript_path: transcriptFile("rollout.jsonl", [
        { type: "response_item", payload: { type: "message", role: "assistant" } },
      ]),
      last_assistant_message: "Renamed it in both tables.",
    };
    await stopTurn(stop);

    expect(replyFiledFor("thr_1")).toMatchObject({ words: 5 });
  });

  test("files the reply when no transcript is offered at all", async () => {
    observeTurn(prompt.prompt, hookSessionId(prompt));
    await stopTurn({ session_id: "thr_1", last_assistant_message: "Done." });

    expect(replyFiledFor("thr_1")).toMatchObject({ words: 1 });
  });
});
