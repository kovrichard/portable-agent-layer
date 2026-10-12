import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { recordAction, recordBlocked } from "../src/hooks/lib/ledger";
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

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, "pal", dir, "events");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const actions = () => logLines("memory").filter((e) => e.type === "action");

describe("ledger entries become action events", () => {
  test("an applied edit carries its line counts and sizes, in its project", () => {
    const entry = recordAction({
      tool: "Edit",
      target: resolve(project, "src", "secret-name.ts"),
      outcome: "applied",
      before: "a\nb\n",
      after: "a\nc\nd\n",
    });

    expect(backfillEvents()).toMatchObject({ ledger: 1 });
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
  });

  test("a blocked command keeps the command and reason out of the event", () => {
    recordBlocked({
      tool: "Bash",
      target: project,
      command: "rm -rf ./private-dir",
      reason: "a private reason",
    });

    backfillEvents();
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

  test("a second run appends nothing", () => {
    recordBlocked({ tool: "Bash", target: project, command: "x", reason: "y" });
    backfillEvents();
    expect(backfillEvents()).toMatchObject({ ledger: 0 });
    expect(actions()).toHaveLength(1);
  });
});
