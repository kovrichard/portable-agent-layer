import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { storeLocation } from "../src/bronze/bronze";
import { eventsSince } from "../src/bronze/events";
import {
  applyPendingMigrations,
  checkPendingMigrations,
  runMigrate,
} from "../src/cli/migrate";
import { collectExportFiles } from "../src/core/export";
import { reload } from "../src/core/settings";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const ID = "v16-bronze-to-records";
let HOME: string;

const at = (...parts: string[]) => resolve(HOME, ...parts);

const EVENT = {
  v: 1,
  id: "e-old",
  ts: "2026-10-01T10:00:00.000Z",
  type: "turn",
  session: null,
  words: 3,
};

const OLD_FILES: Record<string, string> = {
  "memory/events/2026-10.jsonl": `${JSON.stringify(EVENT)}\n`,
  "memory/content/events/2026-10.jsonl": '{"id":"e-old","prompt":"hi"}\n',
  "memory/content/tool-output/2026-10.jsonl": '{"id":"t1","output":"four"}\n',
};

const MOVED_TO: Record<string, string> = {
  "memory/events/2026-10.jsonl": "records/bronze/events/2026-10.jsonl",
  "memory/content/events/2026-10.jsonl": "records/bronze/event-text/2026-10.jsonl",
  "memory/content/tool-output/2026-10.jsonl": "records/bronze/tool-output/2026-10.jsonl",
};

const STAYS: Record<string, string> = {
  "memory/knowledge/People/ada.md": "# Ada\n",
  "memory/state/sessions.json": "{}",
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

const oldEventIds = () =>
  eventsSince("turn", new Date("2026-09-01T00:00:00.000Z"))
    .map((event) => event.id)
    .filter((id) => id === "e-old");

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
  reload();

  for (const [rel, body] of Object.entries({ ...OLD_FILES, ...STAYS })) write(rel, body);
});

describe("before the owner runs it", () => {
  test("install leaves bronze where it is, and PAL keeps reading and writing it there", () => {
    applyPendingMigrations();

    for (const rel of Object.keys(OLD_FILES)) expect(existsSync(at(rel))).toBe(true);
    expect(existsSync(at("records", "bronze"))).toBe(false);
    expect(storeLocation("events")).toBe(at("memory", "events"));
    expect(oldEventIds()).toEqual(["e-old"]);
  });

  test("the doctor lists it with the command that runs it", () => {
    expect(checkPendingMigrations().find((m) => m.id === ID)?.ownerRun).toBe(true);
  });

  test("a dry run names each store and moves nothing", () => {
    const printed = printedBy([ID, "--dry-run"]).replaceAll(/\\+/g, "/");
    expect(printed).toContain("records/bronze/event-text");
    expect(printed).toContain("records/bronze/tool-output");
    expect(existsSync(at("records", "bronze"))).toBe(false);
  });
});

describe("run by its owner", () => {
  test("moves each bronze store byte for byte and leaves the rest of memory/", () => {
    expect(printedBy([ID, "--force"])).toContain("hashes checked");

    for (const [from, to] of Object.entries(MOVED_TO)) {
      expect({ to, body: readFileSync(at(to), "utf-8").split("\n")[0] }).toEqual({
        to,
        body: OLD_FILES[from].split("\n")[0],
      });
      expect(existsSync(at(from))).toBe(false);
    }

    for (const [rel, body] of Object.entries(STAYS))
      expect(readFileSync(at(rel), "utf-8")).toBe(body);
    expect(checkPendingMigrations().some((m) => m.id === ID)).toBe(false);
  });

  test("PAL reads the old events and writes new ones in records/bronze/", () => {
    printedBy([ID, "--force"]);

    expect(storeLocation("events")).toBe(at("records", "bronze", "events"));
    expect(storeLocation("event-text")).toBe(at("records", "bronze", "event-text"));
    expect(storeLocation("tool-output")).toBe(at("records", "bronze", "tool-output"));
    expect(oldEventIds()).toEqual(["e-old"]);
    expect(existsSync(at("memory", "events"))).toBe(false);
  });

  test("an export still leaves out the event text and tool output", () => {
    printedBy([ID, "--force"]);
    const files = collectExportFiles();

    expect(files).toContain("records/bronze/events/2026-10.jsonl");
    expect(
      files.filter((f) => f.includes("event-text") || f.includes("tool-output"))
    ).toEqual([]);
  });

  test("an event a hook appended to the old log is folded in by the next install", () => {
    printedBy([ID, "--force"]);
    const late = { ...EVENT, id: "e-late", ts: "2026-10-02T10:00:00.000Z" };
    write("memory/events/2026-10.jsonl", `${JSON.stringify(late)}\n`);
    const swept = applyPendingMigrations().filter((line) => line.startsWith(ID));

    expect(swept.join("\n")).toContain("swept 1 late file(s)");
    expect(readFileSync(at("records/bronze/events/2026-10.jsonl"), "utf-8")).toContain(
      "e-late"
    );
    expect(existsSync(at("memory/events/2026-10.jsonl"))).toBe(false);
  });

  test("undo puts every file back and PAL reads memory/ again", () => {
    printedBy([ID, "--force"]);
    printedBy(["--undo", ID]);

    for (const rel of Object.keys(OLD_FILES))
      expect(readFileSync(at(rel), "utf-8").split("\n")[0]).toBe(
        OLD_FILES[rel].split("\n")[0]
      );
    expect(storeLocation("event-text")).toBe(at("memory", "content", "events"));
  });
});

describe("a home that started on the new layout", () => {
  test("has nothing to move and writes bronze under records/bronze/", () => {
    const fresh = resolve(freshTestDir(import.meta.file), "fresh");
    process.env.PAL_HOME = fresh;

    expect(checkPendingMigrations().some((m) => m.id === ID)).toBe(false);
    expect(storeLocation("events")).toBe(resolve(fresh, "records", "bronze", "events"));
  });
});
