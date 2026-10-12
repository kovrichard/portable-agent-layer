import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import { run } from "../src/tools/agent/project";
import { setSnooze } from "../src/tools/control-room/snooze";
import { setIscStatus } from "../src/tools/control-room/writes";
import { freshTestDir } from "./lib/test-home";

const savedHome = process.env.PAL_HOME;
let home: string;

function commitments(): Record<string, unknown>[] {
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
    .filter((e) => e.type === "commitment");
}

async function cli(...args: string[]): Promise<void> {
  const quiet = spyOn(console, "log").mockImplementation(() => {});
  try {
    await run(args);
  } finally {
    quiet.mockRestore();
  }
}

beforeEach(async () => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  reload();
  await cli("create", "goals", "--path", resolve(home, "goals"));
  await cli("add-isc", "goals", "ship it");
  await cli("add-isc", "goals", "not anymore");
});

describe("a commitment", () => {
  test("kept, reopened and dropped from the CLI, each once", async () => {
    await cli("complete-isc", "goals", "1");
    await cli("complete-isc", "goals", "1");
    await cli("reopen-isc", "goals", "1");
    await cli("retire-isc", "goals", "2");
    expect(commitments().map((e) => [e.iscProject, e.isc, e.outcome, e.surface])).toEqual(
      [
        ["goals", 1, "kept", "cli"],
        ["goals", 1, "reopened", "cli"],
        ["goals", 2, "dropped", "cli"],
      ]
    );
  });

  test("kept and snoozed from the control room, and waking one is not a snooze", () => {
    setIscStatus("goals", 1, true);
    setSnooze("goals", 2, 7);
    setSnooze("goals", 2, 0);
    expect(commitments().map((e) => [e.isc, e.outcome, e.surface, e.snoozeDays])).toEqual(
      [
        [1, "kept", "control-room", null],
        [2, "snoozed", "control-room", 7],
      ]
    );
  });

  test("never carries the criterion's text", async () => {
    await cli("complete-isc", "goals", "1");
    expect(JSON.stringify(commitments())).not.toContain("ship it");
  });
});
