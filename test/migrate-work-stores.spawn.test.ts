import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { storeLocation } from "../src/bronze/bronze";
import {
  applyPendingMigrations,
  checkPendingMigrations,
  runMigrate,
} from "../src/cli/migrate";
import { reload } from "../src/core/settings";
import { readAllProjects } from "../src/progress/projects";
import { readSchedules } from "../src/progress/scheduled-prompts";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const ID = "v15-work-stores";
let HOME: string;

const at = (...parts: string[]) => resolve(HOME, ...parts);

const SCHEDULE = {
  id: "s1",
  scope: "user",
  from: "09:00",
  to: null,
  days: null,
  repeat: "daily",
  text: "Stand up.",
};

const OLD_FILES: Record<string, string> = {
  "memory/projects/alpha/ISA.md": '---\nname: "alpha"\nstatus: "active"\n---\n',
  "memory/projects/alpha/history.jsonl": '{"h":1}\n',
  "memory/state/unbound-history/loose.jsonl": '{"u":1}\n',
  "memory/progress-tree/events.jsonl": '{"p":1}\n',
  "memory/work/fix-it/ISA.md": "---\ntask: fix it\n---\n",
  "memory/schedules.json": JSON.stringify([SCHEDULE]),
};

const MOVED_TO: Record<string, string> = {
  "memory/projects/alpha/ISA.md": "work/projects/alpha/ISA.md",
  "memory/projects/alpha/history.jsonl": "work/projects/alpha/history.jsonl",
  "memory/state/unbound-history/loose.jsonl": "work/unbound-history/loose.jsonl",
  "memory/progress-tree/events.jsonl": "work/progress-tree/events.jsonl",
  "memory/work/fix-it/ISA.md": "work/tasks/fix-it/ISA.md",
  "memory/schedules.json": "work/schedules/schedules.json",
};

const STAYS: Record<string, string> = {
  "memory/commitments.json": '{"items":[]}',
  "memory/state/sessions.json": "{}",
  "memory/knowledge/People/ada.md": "# Ada\n",
  "memory/signals/ratings.jsonl": '{"rating":9}\n',
};

function write(rel: string, body: string): void {
  mkdirSync(dirname(at(rel)), { recursive: true });
  writeFileSync(at(rel), body);
}

function printedBy(args: string[]): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => lines.push(parts.join(" "));

  try {
    runMigrate(args);
  } finally {
    console.log = original;
  }

  return lines.join("\n");
}

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
  reload();

  for (const [rel, body] of Object.entries({ ...OLD_FILES, ...STAYS })) write(rel, body);
});

describe("before the owner runs it", () => {
  test("install leaves every work store where it is, and PAL keeps reading it there", () => {
    applyPendingMigrations();

    for (const rel of Object.keys(OLD_FILES)) expect(existsSync(at(rel))).toBe(true);
    expect(existsSync(at("work"))).toBe(false);
    expect(readAllProjects().map((p) => p.name)).toEqual(["alpha"]);
    expect(readSchedules().map((s) => s.id)).toEqual(["s1"]);
  });

  test("the doctor lists it with the command that runs it", () => {
    expect(checkPendingMigrations().find((m) => m.id === ID)?.ownerRun).toBe(true);
  });

  test("a dry run names each store and moves nothing", () => {
    const printed = printedBy([ID, "--dry-run"]).replaceAll(/\\+/g, "/");
    expect(printed).toContain("work/projects");
    expect(printed).toContain("work/schedules/schedules.json");
    expect(printed).not.toContain("commitments.json");
    expect(existsSync(at("work"))).toBe(false);
  });

  test("the records move leaves every work store alone", () => {
    printedBy(["v14-records-stores", "--force"]);

    for (const rel of Object.keys(OLD_FILES)) expect(existsSync(at(rel))).toBe(true);
    expect(existsSync(at("work"))).toBe(false);
  });
});

describe("run by its owner", () => {
  test("moves each store byte for byte and leaves the rest of memory/", () => {
    expect(printedBy([ID, "--force"])).toContain("hashes checked");

    for (const [from, to] of Object.entries(MOVED_TO)) {
      expect({ to, body: readFileSync(at(to), "utf-8") }).toEqual({
        to,
        body: OLD_FILES[from],
      });
      expect(existsSync(at(from))).toBe(false);
    }

    for (const [rel, body] of Object.entries(STAYS))
      expect(readFileSync(at(rel), "utf-8")).toBe(body);
    expect(checkPendingMigrations().some((m) => m.id === ID)).toBe(false);
  });

  test("PAL reads every moved store from work/", () => {
    printedBy([ID, "--force"]);

    expect(storeLocation("project-history")).toBe(at("work", "projects"));
    expect(storeLocation("progress-tree")).toBe(at("work", "progress-tree"));
    expect(storeLocation("unbound-history")).toBe(at("work", "unbound-history"));
    expect(storeLocation("task-isas")).toBe(at("work", "tasks"));
    expect(readAllProjects().map((p) => p.name)).toEqual(["alpha"]);
    expect(readSchedules().map((s) => s.id)).toEqual(["s1"]);
  });

  test("a late append to the old progress tree is folded in by the next install", () => {
    printedBy([ID, "--force"]);
    write("memory/progress-tree/events.jsonl", '{"p":1}\n{"p":2}\n');
    const swept = applyPendingMigrations().filter((line) => line.startsWith(ID));

    expect(swept.join("\n")).toContain("swept 1 late file(s)");
    expect(readFileSync(at("work/progress-tree/events.jsonl"), "utf-8")).toBe(
      '{"p":1}\n{"p":2}\n'
    );
    expect(existsSync(at("memory/progress-tree/events.jsonl"))).toBe(false);
  });

  test("undo puts every file back and PAL reads memory/ again", () => {
    printedBy([ID, "--force"]);
    printedBy(["--undo", ID]);

    for (const [rel, body] of Object.entries(OLD_FILES))
      expect(readFileSync(at(rel), "utf-8")).toBe(body);
    expect(existsSync(at("work", "projects"))).toBe(false);
    expect(storeLocation("project-history")).toBe(at("memory", "projects"));
  });
});

describe("a home that started on the new layout", () => {
  test("has nothing to move and writes its projects under work/", () => {
    const fresh = resolve(freshTestDir(import.meta.file), "fresh");
    process.env.PAL_HOME = fresh;

    expect(checkPendingMigrations().some((m) => m.id === ID)).toBe(false);
    expect(storeLocation("project-history")).toBe(resolve(fresh, "work", "projects"));
    expect(storeLocation("schedules")).toBe(resolve(fresh, "work", "schedules"));
  });
});
