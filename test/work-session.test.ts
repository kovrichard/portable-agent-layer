import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { captureWorkSession } from "../src/hooks/handlers/work-session";
import { readSession } from "../src/hooks/lib/work-tracking";
import { freshTestDir } from "./lib/test-home";

beforeEach(() => {
  const home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
});

function tail(from: number, to: number) {
  return Array.from({ length: to - from }, (_, k) => {
    const i = from + k;
    return { role: i % 2 === 0 ? "user" : "assistant", content: `m${i}`, id: `id${i}` };
  });
}

describe("a session's recorded length through a transcript tail", () => {
  test("the first stop records the tail's length and its newest id", async () => {
    await captureWorkSession(JSON.stringify(tail(0, 4)), "s1");
    expect(readSession("s1")).toMatchObject({ messageCount: 4, lastMessageId: "id3" });
  });

  test("a later tail that no longer starts at the beginning keeps the total growing", async () => {
    await captureWorkSession(JSON.stringify(tail(0, 4)), "s1");
    await captureWorkSession(JSON.stringify(tail(2, 8)), "s1");
    expect(readSession("s1")).toMatchObject({ messageCount: 8, lastMessageId: "id7" });
  });
});
