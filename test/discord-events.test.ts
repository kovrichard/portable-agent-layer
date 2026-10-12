import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsCommand } from "../src/cli/events";
import { reload } from "../src/hooks/lib/settings";
import { runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

const savedHome = process.env.PAL_HOME;
let home: string;

function nags(): Record<string, unknown>[] {
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
    .filter((e) => e.type === "discord_nag");
}

async function events(...args: string[]): Promise<number> {
  const quiet = [
    spyOn(console, "log").mockImplementation(() => {}),
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(process.stderr, "write").mockImplementation(() => true),
  ];
  try {
    return await runCommand(eventsCommand, args, ["pal", "cli", "events"]);
  } finally {
    for (const spy of quiet) spy.mockRestore();
  }
}

beforeEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  reload();
});

describe("pal cli events discord-nag", () => {
  test("records a nag sent and the answer with its response time", async () => {
    expect(await events("discord-nag", "sent", "--kind", "standup")).toBe(0);
    expect(
      await events("discord-nag", "answered", "--kind", "standup", "--after-sec", "95.4")
    ).toBe(0);
    expect(nags().map((e) => [e.stage, e.kind, e.responseSec])).toEqual([
      ["sent", "standup", null],
      ["answered", "standup", 95],
    ]);
  });

  test("refuses an unknown stage, an answer without its time, and a negative time", async () => {
    expect(await events("discord-nag", "ignored")).not.toBe(0);
    expect(await events("discord-nag", "answered")).not.toBe(0);
    expect(await events("discord-nag", "answered", "--after-sec", "-3")).not.toBe(0);
    expect(nags()).toEqual([]);
  });
});
