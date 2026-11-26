import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyPendingMigrations,
  checkPendingMigrations,
  runMigrate,
} from "../src/cli/migrate";
import { paths, stateDir } from "../src/core/paths";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const ID = "v17-state-to-root";
let HOME: string;

const OLD = (...p: string[]) => resolve(HOME, "memory", "state", ...p);
const NEW = (...p: string[]) => resolve(HOME, "state", ...p);
const ADAPTATION = (name: string) => resolve(HOME, "memory", "adaptation", name);

function writeOld(name: string, body: string): void {
  mkdirSync(resolve(OLD(name), ".."), { recursive: true });
  writeFileSync(OLD(name), body);
}

function quietly(args: string[]): string {
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
  writeOld("collector-cursors.json", '{"claude":1}');
  writeOld("sessions.json", '{"s":1}');
  writeOld("last-exchange/latest.json", '{"turn":1}');
  writeOld("reaction-samples.json", '{"samples":[]}');
  writeOld("reaction-audit.json", '{"at":"2026-11-26"}');
  writeOld("threads.jsonl", '{"id":"t"}\n');
  writeOld("progress/legacy.json", '{"name":"legacy"}');
  writeOld("signal-cache.json", "{}");
});

describe("before the owner runs it", () => {
  test("install moves nothing and PAL keeps using memory/state", () => {
    applyPendingMigrations();
    expect(existsSync(NEW())).toBe(false);
    expect(stateDir()).toBe(OLD());
  });

  test("the doctor lists it with the command that runs it", () => {
    expect(checkPendingMigrations().find((m) => m.id === ID)?.detail).toBe(
      `run it yourself: pal cli migrate ${ID}`
    );
  });
});

describe("run by its owner", () => {
  test("moves the machine files and folders to state/, byte for byte", () => {
    expect(quietly([ID, "--force"])).toContain("hashes checked");
    expect(readFileSync(NEW("collector-cursors.json"), "utf-8")).toBe('{"claude":1}');
    expect(readFileSync(NEW("sessions.json"), "utf-8")).toBe('{"s":1}');
    expect(readFileSync(NEW("last-exchange", "latest.json"), "utf-8")).toBe('{"turn":1}');
    expect(existsSync(OLD("sessions.json"))).toBe(false);
    expect(stateDir()).toBe(NEW());
  });

  test("moves the reaction audit's files to memory/adaptation", () => {
    quietly([ID, "--force"]);
    expect(readFileSync(ADAPTATION("reaction-samples.json"), "utf-8")).toBe(
      '{"samples":[]}'
    );
    expect(existsSync(ADAPTATION("reaction-audit.json"))).toBe(true);
    expect(existsSync(OLD("reaction-audit.json"))).toBe(false);
  });

  test("leaves legacy and dead files where the old migrations and leftovers look", () => {
    quietly([ID, "--force"]);
    expect(existsSync(OLD("threads.jsonl"))).toBe(true);
    expect(existsSync(OLD("progress", "legacy.json"))).toBe(true);
    expect(paths.legacyProjects()).toBe(OLD("progress"));
    expect(existsSync(OLD("signal-cache.json"))).toBe(true);
  });

  test("is no longer pending afterwards, and undo puts the files back", () => {
    quietly([ID, "--force"]);
    expect(checkPendingMigrations().some((m) => m.id === ID)).toBe(false);
    quietly(["--undo", ID]);
    expect(readFileSync(OLD("sessions.json"), "utf-8")).toBe('{"s":1}');
  });
});
