import { beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { ledgerPath, recordAction, recordBlocked } from "../src/hooks/lib/ledger";
import { writeProject } from "../src/hooks/lib/projects";
import { reload } from "../src/hooks/lib/settings";
import { backfillEvents } from "../src/tools/lib/backfill";
import { freshTestDir } from "./lib/test-home";

let home: string;
let project: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  project = resolve(home, "repo");
  process.env.PAL_HOME = resolve(home, "pal");
  mkdirSync(resolve(home, "pal", "memory", "ledger"), { recursive: true });
  mkdirSync(resolve(project, "src"), { recursive: true });
  reload();
  const now = new Date().toISOString();
  writeProject({
    name: "repo",
    path: project,
    status: "active",
    created: now,
    updated: now,
  });
});

function setEventLog(enabled: boolean): void {
  writeFileSync(
    resolve(home, "pal", "memory", "pal-settings.json"),
    JSON.stringify({ eventLog: { enabled } })
  );
  reload();
}

function beforeStreaming<T>(record: () => T): T {
  setEventLog(false);
  const entry = record();
  setEventLog(true);
  return entry;
}

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, "pal", dir, "events");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const actions = () => logLines("memory").filter((e) => e.type === "action");

const anEdit = () =>
  recordAction({
    tool: "Edit",
    target: resolve(project, "src", "secret-name.ts"),
    outcome: "applied",
    before: "a\nb\n",
    after: "a\nc\nd\n",
  });

describe("ledger entries stream live as action events", () => {
  test("an applied edit carries its line counts and sizes, in its project", () => {
    const entry = anEdit();

    expect(actions()).toEqual([
      expect.objectContaining({
        id: `ledger:${entry.id}`,
        ts: entry.ts,
        project: "repo",
        tool: "Edit",
        outcome: "applied",
        fileExt: ".ts",
        change: "hunks",
        linesAdded: 2,
        linesRemoved: 1,
        beforeBytes: 4,
        afterBytes: 6,
      }),
    ]);
    expect(JSON.stringify(logLines("memory"))).not.toContain("secret-name");
    expect(backfillEvents()).toMatchObject({ ledger: 0 });
  });

  test("a blocked command keeps the command and reason out of the event", () => {
    recordBlocked({
      tool: "Bash",
      target: project,
      command: "rm -rf ./private-dir",
      reason: "a private reason",
    });

    expect(actions()).toEqual([
      expect.objectContaining({
        outcome: "blocked",
        project: "repo",
        fileExt: null,
        change: "none",
        linesAdded: null,
      }),
    ]);
    expect(JSON.stringify(logLines("memory"))).not.toContain("private");
    expect(logLines("memory/content")).toEqual([
      expect.objectContaining({
        command: "rm -rf ./private-dir",
        reason: "a private reason",
      }),
    ]);
  });
});

describe("ledger entries from before streaming are backfilled", () => {
  test("an entry is logged once, under the id it would have streamed with", () => {
    const entry = beforeStreaming(anEdit);

    expect(backfillEvents()).toMatchObject({ ledger: 1 });
    expect(backfillEvents()).toMatchObject({ ledger: 0 });
    expect(actions()).toEqual([
      expect.objectContaining({ id: `ledger:${entry.id}`, linesAdded: 2 }),
    ]);
  });

  test("the rows the test suite leaked before it was sandboxed are left out", () => {
    const leaked = { ...beforeStreaming(anEdit), id: "leaked", command: "rm -rf /" };
    appendFileSync(
      ledgerPath(),
      `${JSON.stringify({ ...leaked, ts: "2026-09-06T09:13:07.065Z" })}\n`
    );
    appendFileSync(
      ledgerPath(),
      `${JSON.stringify({ ...leaked, id: "real", ts: "2026-09-24T09:00:00.000Z" })}\n`
    );

    backfillEvents();
    expect(actions().map((e) => e.id)).not.toContain("ledger:leaked");
    expect(actions().map((e) => e.id)).toContain("ledger:real");
  });
});
