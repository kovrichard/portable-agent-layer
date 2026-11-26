import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyPendingMigrations,
  checkPendingMigrations,
  runMigrate,
} from "../src/cli/migrate";
import { raw, reload, settingsPath } from "../src/core/settings";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const ID = "v13-settings-to-root";
const SETTINGS = '{"identity":{"principal":{"name":"Ada"}}}';
let HOME: string;

const OLD = () => resolve(HOME, "memory", "pal-settings.json");
const NEW = () => resolve(HOME, "settings.json");

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
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
  writeFileSync(OLD(), SETTINGS);
  reload();
});

describe("before the owner runs it", () => {
  test("install leaves the settings in memory/ and PAL keeps reading them there", () => {
    applyPendingMigrations();
    expect(existsSync(NEW())).toBe(false);
    expect(settingsPath()).toBe(OLD());
    expect(reload().identity?.principal?.name).toBe("Ada");
  });

  test("a home that has both files but never ran the move is not swept", () => {
    writeFileSync(NEW(), '{"other":true}');
    applyPendingMigrations();
    expect(readFileSync(OLD(), "utf-8")).toBe(SETTINGS);
    expect(readFileSync(NEW(), "utf-8")).toBe('{"other":true}');
  });

  test("the doctor lists it with the command that runs it", () => {
    expect(checkPendingMigrations().find((m) => m.id === ID)?.detail).toBe(
      `run it yourself: pal cli migrate ${ID}`
    );
  });
});

describe("run by its owner", () => {
  test("moves the file byte for byte and PAL reads it at the root", () => {
    expect(printedBy([ID, "--force"])).toContain("hashes checked");
    expect(readFileSync(NEW(), "utf-8")).toBe(SETTINGS);
    expect(existsSync(OLD())).toBe(false);
    expect(settingsPath()).toBe(NEW());
    reload();
    expect(raw().identity?.principal?.name).toBe("Ada");
  });

  test("a newer copy an old process wrote to the old path wins, and the other is kept", () => {
    printedBy([ID, "--force"]);
    writeFileSync(OLD(), '{"late":true}');
    const later = new Date(Date.now() + 60_000);
    utimesSync(OLD(), later, later);
    const swept = applyPendingMigrations().filter((line) => line.startsWith(ID));
    expect(swept.join("\n")).toContain("swept 1 late file");
    expect(readFileSync(NEW(), "utf-8")).toBe('{"late":true}');
    expect(existsSync(OLD())).toBe(false);
  });

  test("before any sweep, a late copy at the old path is not read", () => {
    printedBy([ID, "--force"]);
    writeFileSync(OLD(), '{"late":true}');
    expect(settingsPath()).toBe(NEW());
    expect(reload().identity?.principal?.name).toBe("Ada");
  });

  test("an older copy at the old path does not replace the moved file", () => {
    printedBy([ID, "--force"]);
    writeFileSync(OLD(), '{"stale":true}');
    const earlier = new Date(Date.now() - 60_000);
    utimesSync(OLD(), earlier, earlier);
    applyPendingMigrations();
    expect(readFileSync(NEW(), "utf-8")).toBe(SETTINGS);
    expect(existsSync(OLD())).toBe(false);
  });

  test("undo puts the file back in memory/", () => {
    printedBy([ID, "--force"]);
    printedBy(["--undo", ID]);
    expect(readFileSync(OLD(), "utf-8")).toBe(SETTINGS);
    expect(existsSync(NEW())).toBe(false);
    expect(settingsPath()).toBe(OLD());
  });
});
