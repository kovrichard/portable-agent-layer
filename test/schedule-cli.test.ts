import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scheduleCommand } from "../src/cli/schedule";
import { scopeOf } from "../src/hooks/lib/progress-tree";
import { readSchedules, type Schedule } from "../src/hooks/lib/scheduled-prompts";
import { type Command, runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

let home: string;
let printed: string[];
let errors: string[];

beforeEach(() => {
  mock.restore();
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  printed = [];
  errors = [];
  spyOn(console, "log").mockImplementation((...args) => printed.push(args.join(" ")));
  spyOn(console, "error").mockImplementation((...args) => errors.push(args.join(" ")));
});

function schedule(...args: string[]): Promise<number> {
  return runCommand(scheduleCommand as Command, args, ["pal", "cli", "schedule"]);
}

function only(): Schedule {
  const [stored] = readSchedules();
  return stored;
}

function registerProject(name: string): void {
  const dir = resolve(home, "memory", "projects", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: ${name}\nstatus: active\ncreated: 2026-09-01T00:00:00.000Z\nupdated: 2026-09-01T00:00:00.000Z\npath: ${resolve(home, "elsewhere")}\n---\n\n## Goal\n\nnone\n`
  );
}

describe("pal cli schedule add", () => {
  test("defaults to the current folder, once a day until midnight, and says so", async () => {
    expect(await schedule("add", "--from", "20:00", "suggest", "night", "tasks")).toBe(0);
    const stored = only();
    expect(stored).toMatchObject({
      scope: scopeOf(process.cwd()),
      from: "20:00",
      to: null,
      days: null,
      repeat: "daily",
      text: "suggest night tasks",
    });
    expect(printed).toEqual([
      `Scheduled ${stored.id} for ${scopeOf(process.cwd())}: daily, 20:00–24:00. Remove it with \`pal cli schedule remove ${stored.id}\`.`,
    ]);
  });

  test("--user schedules for every project", async () => {
    await schedule("add", "--from", "08:00", "--to", "09:00", "--user", "plan the day");
    expect(only()).toMatchObject({ scope: "user", to: "09:00" });
    expect(printed[0]).toContain("for you, in every project: daily, 08:00–09:00.");
  });

  test("--project takes a registered project", async () => {
    registerProject("game");
    await schedule("add", "--from", "20:00", "--project", "game", "--every-session", "x");
    expect(only()).toMatchObject({ scope: "game", repeat: "every-session" });
  });

  test("--project refuses a name that is not registered, and stores nothing", async () => {
    expect(await schedule("add", "--from", "20:00", "--project", "gmae", "x")).toBe(1);
    expect(errors.join("\n")).toContain('no registered project "gmae"');
    expect(readSchedules()).toEqual([]);
  });

  test.each([
    [
      ["--from", "20:00", "--user", "--project", "game"],
      "give --user or --project, not both",
    ],
    [
      ["--from", "20:00", "--every-session", "--every-prompt"],
      "give --every-session or --every-prompt, not both",
    ],
    [["--to", "21:00"], "give the start time with --from <HH:MM>"],
    [["--from", "7pm"], 'Not a time of day: "7pm". Use HH:MM.'],
  ])("%p is refused", async (flags, message) => {
    expect(await schedule("add", ...flags, "text")).toBe(1);
    expect(errors.join("\n")).toContain(message);
    expect(readSchedules()).toEqual([]);
  });

  test("--every-prompt and --days are stored", async () => {
    await schedule(
      "add",
      "--from",
      "22:00",
      "--to",
      "02:00",
      "--days",
      "mon-fri",
      "--every-prompt",
      "x"
    );
    expect(only()).toMatchObject({
      to: "02:00",
      days: [1, 2, 3, 4, 5],
      repeat: "every-prompt",
    });
  });
});

describe("pal cli schedule list and remove", () => {
  test("list says when there is nothing", async () => {
    expect(await schedule("list")).toBe(0);
    expect(await schedule("list", "--here")).toBe(0);
    expect(printed).toEqual(["No schedules.", "No schedule applies here."]);
  });

  test("list --here leaves out another project's schedule", async () => {
    registerProject("game");
    await schedule("add", "--from", "20:00", "--project", "game", "theirs");
    await schedule("add", "--from", "00:00", "--user", "mine");
    const mine = readSchedules()[1];
    printed = [];
    await schedule("list", "--here");
    expect(printed).toEqual([`${mine.id}  user  00:00–24:00  daily  mine  [open now]`]);
  });

  test("remove deletes by id and reports an unknown id", async () => {
    await schedule("add", "--from", "20:00", "x");
    const { id } = only();
    printed = [];
    expect(await schedule("remove", id)).toBe(0);
    expect(await schedule("remove", id)).toBe(1);
    expect(printed).toEqual([`Removed ${id}.`]);
    expect(errors).toEqual([`No schedule ${id}.`]);
  });
});
