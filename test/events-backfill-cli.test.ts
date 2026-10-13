import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsCommand } from "../src/cli/events";
import { reload } from "../src/hooks/lib/settings";
import { runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

let home: string;

const promise = {
  id: 1,
  title: "a promise",
  due: "2026-09-02T10:00:00.000Z",
  status: "open",
  createdAt: "2026-09-01T10:00:00.000Z",
  snoozes: 0,
  nagCount: 0,
  nagMessageIds: [],
};
const promiseEventId = `promise:1:${promise.createdAt}:made`;

async function backfill(...args: string[]): Promise<string[]> {
  const printed: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => {
    printed.push(line);
  });
  try {
    await runCommand(eventsCommand, ["backfill", ...args], ["pal", "cli", "events"]);
  } finally {
    log.mockRestore();
  }
  return printed;
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory", "events"), { recursive: true });
  reload();
  writeFileSync(
    resolve(home, "memory", "commitments.json"),
    JSON.stringify({ nextId: 2, items: [promise] })
  );
});

describe("pal cli events backfill", () => {
  test("prints how many events each source appended, and nothing new the second time", async () => {
    expect(await backfill()).toContain("promises: 1");
    expect(await backfill()).toContain("promises: 0");
  });

  test("--since skips what happened before it", async () => {
    expect(await backfill("--since", "2026-09-02")).toContain("promises: 0");
  });

  test("an id in a file that is not a month log does not count as logged", async () => {
    writeFileSync(
      resolve(home, "memory", "events", "notes.txt"),
      `${JSON.stringify({ id: promiseEventId })}\n`
    );
    expect(await backfill()).toContain("promises: 1");
  });

  test("says so when the event log is off", async () => {
    writeFileSync(
      resolve(home, "memory", "pal-settings.json"),
      JSON.stringify({ eventLog: { enabled: false } })
    );
    reload();
    expect(await backfill()).toEqual(["The event log is off; nothing backfilled."]);
  });
});
