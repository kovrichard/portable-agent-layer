import { beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  applyPendingMigrations,
  checkPendingMigrations,
  runMigrate,
} from "../src/cli/migrate";
import { appendEvent, nodesWithStatus, readTree } from "../src/hooks/lib/progress-tree";
import {
  loadProgressTreeContext,
  progressTreePromptLine,
} from "../src/hooks/lib/progress-tree-context";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const MIGRATION = "v9-progress-tree-names";
const RETIRED_KEY_PAIRS = [
  ["workTree", "progressTree"],
  ["workTreeGate", "progressTreeGate"],
  ["workTreeDecisionGate", "progressTreeDecisionGate"],
] as const;

let HOME: string;

const settingsFile = () => resolve(HOME, "memory", "pal-settings.json");
const oldFolder = () => resolve(HOME, "memory", "work-tree");
const newFolder = () => resolve(HOME, "memory", "progress-tree");

function writeSettings(value: unknown): void {
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(value));
}

const readSettings = () => JSON.parse(readFileSync(settingsFile(), "utf-8"));
const pendingIds = () => checkPendingMigrations().map((m) => m.id);

function writeEvents(folder: string, lines: string[]): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, "events.jsonl"), `${lines.join("\n")}\n`);
}

const readEventLines = (folder: string) =>
  readFileSync(resolve(folder, "events.jsonl"), "utf-8").trim().split("\n");

function quietly(fn: () => void): string {
  const captured: string[] = [];
  const log = console.log;
  console.log = (...parts: unknown[]) => captured.push(parts.join(" "));
  try {
    fn();
  } finally {
    console.log = log;
  }
  return captured.join("\n");
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
  reload();
});

describe("the progress tree's old settings", () => {
  test.each(
    RETIRED_KEY_PAIRS
  )("one run removes the setting as %s and as %s", (oldKey, newKey) => {
    writeSettings({
      dynamicContext: { opinions: true, [oldKey]: true, [newKey]: false },
    });

    quietly(() => runMigrate([]));

    expect(readSettings()).toEqual({ dynamicContext: { opinions: true } });
    expect(checkPendingMigrations()).toEqual([]);
  });

  test("v9 leaves settings to v7 and is not pending without the old folder", () => {
    writeSettings({ dynamicContext: { workTree: true } });
    expect(pendingIds()).not.toContain(MIGRATION);
  });
});

describe("v9-progress-tree-names: data folder", () => {
  const OLD_1 = '{"type":"open","id":"old-1"}';
  const OLD_2 = '{"type":"open","id":"old-2"}';
  const NEW_1 = '{"type":"open","id":"new-1"}';

  test("is pending while memory/work-tree exists, even without settings", () => {
    writeEvents(oldFolder(), [OLD_1]);
    expect(pendingIds()).toContain(MIGRATION);
  });

  test("moves memory/work-tree to memory/progress-tree", () => {
    writeEvents(oldFolder(), [OLD_1, OLD_2]);

    quietly(() => runMigrate([]));

    expect(existsSync(oldFolder())).toBe(false);
    expect(readEventLines(newFolder())).toEqual([OLD_1, OLD_2]);
    expect(pendingIds()).not.toContain(MIGRATION);
  });

  test("with both folders, old lines go before the new file's own, none lost or doubled", () => {
    writeEvents(oldFolder(), [OLD_1, OLD_2]);
    writeEvents(newFolder(), [NEW_1]);

    quietly(() => runMigrate([]));

    expect(existsSync(oldFolder())).toBe(false);
    expect(readEventLines(newFolder())).toEqual([OLD_1, OLD_2, NEW_1]);
    expect(pendingIds()).not.toContain(MIGRATION);
  });

  test("a dry run reports the move and changes nothing", () => {
    writeEvents(oldFolder(), [OLD_1]);
    writeEvents(newFolder(), [NEW_1]);

    const output = quietly(() => runMigrate(["--dry-run"]));

    expect(output).toContain(MIGRATION);
    expect(readEventLines(oldFolder())).toEqual([OLD_1]);
    expect(readEventLines(newFolder())).toEqual([NEW_1]);
    expect(pendingIds()).toContain(MIGRATION);
  });

  test("running twice changes nothing the second time", () => {
    writeSettings({ dynamicContext: { workTree: true } });
    writeEvents(oldFolder(), [OLD_1]);

    quietly(() => runMigrate([]));
    expect(applyPendingMigrations().filter((l) => l.startsWith(MIGRATION))).toEqual([]);
    expect(readEventLines(newFolder())).toEqual([OLD_1]);
  });
});

describe("v9-progress-tree-names: what it reports", () => {
  const EVENT = '{"type":"open","id":"old-1"}';
  const v9Lines = () =>
    applyPendingMigrations()
      .filter((line) => line.startsWith(`${MIGRATION}: `))
      .map((line) => line.slice(MIGRATION.length + 2));
  const v9Detail = () => checkPendingMigrations().find((m) => m.id === MIGRATION)?.detail;

  test("names the old folder and reports the move", () => {
    writeSettings({ dynamicContext: { workTree: true } });
    writeEvents(oldFolder(), [EVENT]);
    expect(v9Detail()).toBe("memory/work-tree/");
    expect(v9Lines()).toEqual(["memory/work-tree/: moved to memory/progress-tree/"]);
  });

  test("with both folders it reports how many events it appended", () => {
    writeEvents(oldFolder(), [EVENT, '{"type":"open","id":"old-2"}']);
    writeEvents(newFolder(), ['{"type":"open","id":"new-1"}']);
    expect(v9Lines()).toEqual([
      "memory/work-tree/: 2 event(s) appended before memory/progress-tree/events.jsonl",
    ]);
  });

  test.each([
    [false, "memory/work-tree/: would move to memory/progress-tree/"],
    [
      true,
      "memory/work-tree/: would append its events before memory/progress-tree/events.jsonl",
    ],
  ])("a dry run with the new folder present=%p says what it would do", (both, line) => {
    writeEvents(oldFolder(), [EVENT]);
    if (both) writeEvents(newFolder(), [EVENT]);
    expect(quietly(() => runMigrate(["--dry-run"]))).toContain(line);
  });

  test("an old folder holding other files is kept and counted as skipped", () => {
    writeEvents(oldFolder(), [EVENT]);
    writeFileSync(resolve(oldFolder(), "notes.txt"), "mine");
    writeEvents(newFolder(), ['{"type":"open","id":"new-1"}']);

    const output = quietly(() => runMigrate([]));

    expect(output).toContain(
      "memory/work-tree/: 1 event(s) appended before memory/progress-tree/events.jsonl"
    );
    expect(output).toContain(
      "memory/work-tree/: skipped (holds files other than events.jsonl)"
    );
    expect(output).toContain("Migrated: 1 | Skipped: 1");
    expect(readFileSync(resolve(oldFolder(), "notes.txt"), "utf-8")).toBe("mine");
  });

  test("an old folder without events appends none", () => {
    mkdirSync(oldFolder(), { recursive: true });
    writeFileSync(resolve(oldFolder(), "notes.txt"), "mine");
    writeEvents(newFolder(), [EVENT]);

    expect(v9Lines()).toEqual([
      "memory/work-tree/: 0 event(s) appended before memory/progress-tree/events.jsonl",
      "memory/work-tree/: skipped (holds files other than events.jsonl)",
    ]);
    expect(readEventLines(newFolder())).toEqual([EVENT]);
  });
});

describe("an install from before the rename", () => {
  test("shows its old events and keeps no old setting", () => {
    const scope = resolve(HOME, "some-folder");
    mkdirSync(scope, { recursive: true });
    writeSettings({ dynamicContext: { workTree: true, workTreeGate: true } });
    mkdirSync(oldFolder(), { recursive: true });
    appendEvent(
      scope,
      "n1",
      "open",
      { title: "Before the rename", parent: null },
      resolve(oldFolder(), "events.jsonl")
    );
    reload();
    expect(loadProgressTreeContext(scope)).toBe("");

    applyPendingMigrations();
    reload();

    expect(readSettings().dynamicContext).toEqual({});
    expect(loadProgressTreeContext(scope)).toContain("Before the rename");
    expect(progressTreePromptLine("go on", scope)).toContain("Before the rename");
    expect(nodesWithStatus(readTree(scope), "active").map((n) => n.title)).toEqual([
      "Before the rename",
    ]);
  });
});

describe("the schema and the template name no progress-tree switch", () => {
  const assets = resolve(import.meta.dir, "..", "assets");
  const schema = JSON.parse(
    readFileSync(resolve(assets, "schema", "pal-settings.schema.json"), "utf-8")
  ).properties.dynamicContext.properties;
  const template = JSON.parse(
    readFileSync(resolve(assets, "templates", "pal-settings.json"), "utf-8")
  ).dynamicContext;

  test.each(RETIRED_KEY_PAIRS)("%s and %s are in neither", (oldKey, newKey) => {
    for (const key of [oldKey, newKey]) {
      expect(schema[key]).toBeUndefined();
      expect(key in template).toBe(false);
    }
  });
});

describe("the old names are gone from src/ and assets/", () => {
  const ALLOWED = resolve(import.meta.dir, "..", "src", "cli", "migrate.ts");
  const OLD_NAME = /workTree|work-tree/;

  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = resolve(dir, name);
      if (name === "node_modules" || name === "dist") return [];
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
  }

  test("only migrate.ts mentions workTree or work-tree", () => {
    const root = resolve(import.meta.dir, "..");
    const offenders = ["src", "assets"]
      .flatMap((dir) => filesUnder(resolve(root, dir)))
      .filter((file) => file !== ALLOWED)
      .filter((file) => OLD_NAME.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });
});
