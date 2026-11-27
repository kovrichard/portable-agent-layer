import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/core/settings";
import { run } from "../src/tools/agent/project";
import { setSnooze } from "../src/tools/control-room/snooze";
import { setIscStatus } from "../src/tools/control-room/writes";
import { freshTestDir } from "./lib/test-home";

const savedHome = process.env.PAL_HOME;
let home: string;

function commitments(): Record<string, unknown>[] {
  const file = resolve(
    home,
    "records",
    "bronze",
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

const afterOpening = () => commitments().filter((e) => e.outcome !== "opened");

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

const openedIds = () =>
  commitments()
    .filter((e) => e.outcome === "opened")
    .map((e) => e.isc as string);

describe("a commitment", () => {
  test("opened when its ISC is added, under a new four-character id", () => {
    const [first, second] = openedIds();

    expect(commitments().map((e) => [e.iscProject, e.isc, e.outcome, e.surface])).toEqual(
      [
        ["goals", first, "opened", "cli"],
        ["goals", second, "opened", "cli"],
      ]
    );
    expect(first).toMatch(/^[0-9a-z]{4}$/);
    expect(second).not.toBe(first);
  });

  test("kept, reopened and dropped from the CLI, each once", async () => {
    const [first, second] = openedIds();
    await cli("complete-isc", "goals", first);
    await cli("complete-isc", "goals", first);
    await cli("reopen-isc", "goals", first);
    await cli("retire-isc", "goals", second);
    expect(
      afterOpening().map((e) => [e.iscProject, e.isc, e.outcome, e.surface])
    ).toEqual([
      ["goals", first, "kept", "cli"],
      ["goals", first, "reopened", "cli"],
      ["goals", second, "dropped", "cli"],
    ]);
  });

  test("kept and snoozed from the control room, and waking one is not a snooze", () => {
    const [first, second] = openedIds();
    setIscStatus("goals", first, true);
    setSnooze("goals", second, 7);
    setSnooze("goals", second, 0);
    expect(
      afterOpening().map((e) => [e.isc, e.outcome, e.surface, e.snoozeDays])
    ).toEqual([
      [first, "kept", "control-room", null],
      [second, "snoozed", "control-room", 7],
    ]);
  });

  test("never carries the criterion's text", async () => {
    await cli("complete-isc", "goals", openedIds()[0] as string);
    expect(JSON.stringify(commitments())).not.toContain("ship it");
  });
});
