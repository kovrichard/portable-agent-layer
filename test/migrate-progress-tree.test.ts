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
const KEY_PAIRS = [
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

describe("v9-progress-tree-names: settings keys", () => {
  describe.each(KEY_PAIRS)("%s → %s", (oldKey, newKey) => {
    test.each([true, false])("keeps the value %p under the new name", (value) => {
      writeSettings({ dynamicContext: { [oldKey]: value } });
      expect(pendingIds()).toContain(MIGRATION);

      quietly(() => runMigrate([]));

      expect(readSettings()).toEqual({ dynamicContext: { [newKey]: value } });
      expect(pendingIds()).not.toContain(MIGRATION);
    });

    test("when the key is missing, adds nothing and is not pending", () => {
      writeSettings({ dynamicContext: { wisdom: true } });
      expect(pendingIds()).not.toContain(MIGRATION);

      quietly(() => runMigrate([]));

      expect(readSettings()).toEqual({ dynamicContext: { wisdom: true } });
    });

    test("when both names exist, the new value wins and the old key goes", () => {
      writeSettings({ dynamicContext: { [oldKey]: true, [newKey]: false } });
      expect(pendingIds()).toContain(MIGRATION);

      quietly(() => runMigrate([]));

      expect(readSettings()).toEqual({ dynamicContext: { [newKey]: false } });
    });
  });

  test("renames all three, keeping other keys and their order", () => {
    writeSettings({
      identity: { ai: { name: "A" } },
      dynamicContext: {
        wisdom: true,
        workTree: true,
        claimChek: false,
        workTreeGate: false,
        workTreeDecisionGate: true,
        last: 1,
      },
    });

    quietly(() => runMigrate([]));

    const settings = readSettings();
    expect(settings.identity).toEqual({ ai: { name: "A" } });
    expect(settings.dynamicContext).toEqual({
      wisdom: true,
      progressTree: true,
      claimChek: false,
      progressTreeGate: false,
      progressTreeDecisionGate: true,
      last: 1,
    });
    expect(Object.keys(settings.dynamicContext)).toEqual([
      "wisdom",
      "progressTree",
      "claimChek",
      "progressTreeGate",
      "progressTreeDecisionGate",
      "last",
    ]);
  });

  test("a dry run reports the rename and leaves the file alone", () => {
    const before = { dynamicContext: { workTree: true, workTreeGate: false } };
    writeSettings(before);

    const output = quietly(() => runMigrate(["--dry-run"]));

    expect(output).toContain(MIGRATION);
    expect(readSettings()).toEqual(before);
    expect(pendingIds()).toContain(MIGRATION);
  });

  test("is not pending without a settings file or folders", () => {
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

describe("an install with the tree on keeps it on after migrating", () => {
  test("settings with workTree: true and old events show the same nodes", () => {
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

    expect(readSettings().dynamicContext).toEqual({
      progressTree: true,
      progressTreeGate: true,
    });
    expect(loadProgressTreeContext(scope)).toContain("Before the rename");
    expect(progressTreePromptLine("go on", scope)).toContain("Before the rename");
    expect(nodesWithStatus(readTree(scope), "active").map((n) => n.title)).toEqual([
      "Before the rename",
    ]);
  });
});

describe("the schema and the template name only the new keys", () => {
  const assets = resolve(import.meta.dir, "..", "assets");
  const schema = JSON.parse(
    readFileSync(resolve(assets, "schema", "pal-settings.schema.json"), "utf-8")
  ).properties.dynamicContext.properties;
  const template = JSON.parse(
    readFileSync(resolve(assets, "templates", "pal-settings.json"), "utf-8")
  ).dynamicContext;

  test.each(KEY_PAIRS)("%s is replaced by %s in both", (oldKey, newKey) => {
    expect(schema[newKey]?.type).toBe("boolean");
    expect(schema[oldKey]).toBeUndefined();
    expect(template[newKey]).toBe(false);
    expect(oldKey in template).toBe(false);
  });

  test("the gates' descriptions say Needs progressTree.", () => {
    for (const key of ["progressTreeGate", "progressTreeDecisionGate"]) {
      expect(schema[key].description).toEndWith("Needs progressTree.");
    }
  });
});

describe("AGENTS.md.template", () => {
  const rule = "- **Keep the progress tree true**";

  test("renders the progress-tree rule with the key on and omits it off", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    writeSettings({ dynamicContext: { progressTree: true } });
    reload();
    expect(buildClaudeMd()).toContain(rule);

    writeSettings({ dynamicContext: { progressTree: false } });
    reload();
    const off = buildClaudeMd();
    expect(off).not.toContain(rule);
    expect(off).not.toContain("{{IF");
  });

  test("the template block is keyed on progressTree", () => {
    const template = readFileSync(
      resolve(import.meta.dir, "..", "assets", "templates", "AGENTS.md.template"),
      "utf-8"
    );
    expect(template).toContain("{{IF progressTree}}");
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
