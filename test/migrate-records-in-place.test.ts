import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { v4PathsToBindings } from "../src/cli/migrations/v4-paths-to-bindings";
import { v5AttributionKeys } from "../src/cli/migrations/v5-attribution-keys";
import { v6HistorySlugs } from "../src/cli/migrations/v6-history-slugs";
import { v7RetiredSettingsKeys } from "../src/cli/migrations/v7-retired-settings-keys";
import { readBindings } from "../src/hooks/lib/bindings";
import {
  boundProject,
  homeFile,
  isaFile,
  legacyIsa,
  unboundProject,
  writeAt,
} from "./lib/migration-home-fixture";
import { freshTestDir } from "./lib/test-home";

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
});

const NOT_PENDING = { pending: false, detail: undefined };

describe("v4-paths-to-bindings", () => {
  test("counts only records whose frontmatter has a path key", () => {
    legacyIsa("old", "status: active\npath: /nowhere/old");
    legacyIsa("noted", 'status: active\nserves_note: "the path: is elsewhere"');
    unboundProject("fresh");
    mkdirSync(homeFile("memory", "projects", "no-isa"), { recursive: true });

    expect(v4PathsToBindings.check()).toEqual({
      pending: true,
      detail: "1 record(s) still store a path",
    });
  });

  test("is not pending once no record stores a path", () => {
    unboundProject("fresh");
    expect(v4PathsToBindings.check()).toEqual(NOT_PENDING);
  });

  test("rewrites a record so its path moves into a binding", () => {
    const dir = homeFile("checkouts", "old");
    writeAt(homeFile("checkouts", "old", "README.md"), "");
    legacyIsa("old", `status: active\nremote: example.com/old\npath: ${dir}`);

    expect(v4PathsToBindings.run()).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["old: path moved to a binding"],
    });
    expect(readFileSync(isaFile("old"), "utf-8")).not.toContain("path:");
    expect(readBindings().old).toBe(dir);
  });

  test("a dry run names each path and changes nothing", () => {
    legacyIsa("old", "status: active\npath: /nowhere/old");
    legacyIsa("blank", 'status: active\npath: ""');
    const before = readFileSync(isaFile("old"), "utf-8");

    const result = v4PathsToBindings.run(true);

    expect(result.migrated).toBe(2);
    expect(result.results.sort()).toEqual([
      "blank: would move (no path) to a binding",
      "old: would move /nowhere/old to a binding",
    ]);
    expect(readFileSync(isaFile("old"), "utf-8")).toBe(before);
  });

  test("leaves an unreadable record untouched", () => {
    legacyIsa("statusless", "path: /nowhere/x");

    expect(v4PathsToBindings.run()).toEqual({
      migrated: 0,
      skipped: 1,
      results: ["statusless: unreadable, left untouched"],
    });
  });
});

const OLD_STAMP = `${JSON.stringify({ id: "a", m: "box" })}\n${JSON.stringify({ id: "b", m: "box" })}\n`;

describe("v5-attribution-keys", () => {
  test("counts only .jsonl stores that still carry m", () => {
    writeAt(homeFile("memory", "signals", "ratings.jsonl"), OLD_STAMP);
    writeAt(homeFile("memory", "signals", "clean.jsonl"), '{"machine":"box"}\n');
    writeAt(homeFile("memory", "signals", "export.json"), OLD_STAMP);
    writeAt(homeFile("memory", "state", "threads.jsonl"), OLD_STAMP);

    expect(v5AttributionKeys.check()).toEqual({
      pending: true,
      detail: "2 file(s) still stamp origin as `m`",
    });
  });

  test("is not pending when no store carries m", () => {
    writeAt(homeFile("memory", "signals", "clean.jsonl"), '{"machine":"box"}\n');
    expect(v5AttributionKeys.check()).toEqual(NOT_PENDING);
  });

  test("reports each rewritten file by its path under the PAL home", () => {
    const ratings = homeFile("memory", "signals", "ratings.jsonl");
    writeAt(ratings, OLD_STAMP);

    expect(v5AttributionKeys.run(true)).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["/memory/signals/ratings.jsonl: would rewrite 2 record(s)"],
    });
    expect(readFileSync(ratings, "utf-8")).toBe(OLD_STAMP);

    expect(v5AttributionKeys.run()).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["/memory/signals/ratings.jsonl: 2 record(s) rewritten"],
    });
    expect(readFileSync(ratings, "utf-8")).not.toContain('"m"');
  });
});

const settingsFile = () => homeFile("memory", "pal-settings.json");
const RETIRED_SETTINGS = JSON.stringify({
  loadAtStartup: null,
  steering: { _docs: "x", keep: 1 },
  dynamicContext: { wisdom: true },
});

describe("v7-retired-settings-keys", () => {
  test("names every retired key and ignores a section that is not an object", () => {
    writeAt(settingsFile(), RETIRED_SETTINGS);

    expect(v7RetiredSettingsKeys.check()).toEqual({
      pending: true,
      detail: "steering._docs, dynamicContext.wisdom",
    });
  });

  test("a dry run reports the keys and leaves the file", () => {
    writeAt(settingsFile(), RETIRED_SETTINGS);

    expect(v7RetiredSettingsKeys.run(true)).toEqual({
      migrated: 2,
      skipped: 0,
      results: ["pal-settings.json: would remove steering._docs, dynamicContext.wisdom"],
    });
    expect(readFileSync(settingsFile(), "utf-8")).toBe(RETIRED_SETTINGS);
  });

  test("removes the retired keys and keeps the rest", () => {
    writeAt(settingsFile(), RETIRED_SETTINGS);

    expect(v7RetiredSettingsKeys.run().results).toEqual([
      "pal-settings.json: removed steering._docs, dynamicContext.wisdom",
    ]);
    expect(JSON.parse(readFileSync(settingsFile(), "utf-8"))).toEqual({
      loadAtStartup: null,
      steering: { keep: 1 },
      dynamicContext: {},
    });
  });

  test.each([
    ["no settings file", undefined],
    ["no retired key", '{"steering":{"keep":1}}'],
  ])("does nothing with %s", (_label, content) => {
    if (content) writeAt(settingsFile(), content);
    const nothing = { migrated: 0, skipped: 0, results: [] };

    expect(v7RetiredSettingsKeys.check()).toEqual(NOT_PENDING);
    expect(v7RetiredSettingsKeys.run()).toEqual(nothing);
    expect(existsSync(settingsFile()) && readFileSync(settingsFile(), "utf-8")).toBe(
      content ?? false
    );
  });
});

const HISTORY_LINE = '{"ts":"2026-01-01T00:00:00.000Z","summary":"worked"}\n';
const orphanHistory = (slug: string) =>
  homeFile("memory", "projects", slug, "history.jsonl");
const parkedHistory = (file: string) =>
  homeFile("memory", "state", "unbound-history", file);

describe("v6-history-slugs", () => {
  test("counts orphan folders and parked files whose project has appeared", () => {
    boundProject("app", undefined, "workdir");
    writeAt(orphanHistory("stray"), HISTORY_LINE);
    writeAt(parkedHistory("workdir.jsonl"), HISTORY_LINE);
    writeAt(parkedHistory("workdir.json5"), HISTORY_LINE);
    writeAt(parkedHistory("ghost.jsonl"), HISTORY_LINE);

    expect(v6HistorySlugs.check()).toEqual({
      pending: true,
      detail: "2 history file(s) filed under a directory name",
    });
  });

  test("is not pending when every history file sits with its project", () => {
    boundProject("app");
    writeAt(orphanHistory("app"), HISTORY_LINE);
    writeAt(parkedHistory("ghost.jsonl"), HISTORY_LINE);

    expect(v6HistorySlugs.check()).toEqual(NOT_PENDING);
  });

  test("parks an orphan no project owns, even beside unrelated and unbound projects", () => {
    boundProject("app");
    unboundProject("pathless");
    writeAt(orphanHistory("stray"), HISTORY_LINE);

    expect(v6HistorySlugs.run()).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["stray: 1 entr(ies) moved to unbound-history"],
    });
    expect(readFileSync(parkedHistory("stray.jsonl"), "utf-8")).toBe(HISTORY_LINE);
    expect(existsSync(homeFile("memory", "projects", "stray"))).toBe(false);
  });

  test("files parked history under the project now checked out under that name", () => {
    boundProject("app", undefined, "workdir");
    writeAt(parkedHistory("workdir.jsonl"), HISTORY_LINE);

    expect(v6HistorySlugs.run()).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["workdir: 1 entr(ies) moved to project app"],
    });
    expect(readFileSync(orphanHistory("app"), "utf-8")).toBe(HISTORY_LINE);
    expect(existsSync(parkedHistory("workdir.jsonl"))).toBe(false);
    expect(existsSync(parkedHistory(""))).toBe(true);
  });

  test("a dry run names the destination and moves nothing", () => {
    boundProject("app", undefined, "workdir");
    writeAt(orphanHistory("workdir"), HISTORY_LINE);

    expect(v6HistorySlugs.run(true)).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["workdir: would move to project app"],
    });
    expect(existsSync(orphanHistory("workdir"))).toBe(true);
  });

  test("skips a file whose destination cannot be written", () => {
    boundProject("app", undefined, "workdir");
    mkdirSync(orphanHistory("app"), { recursive: true });
    writeAt(parkedHistory("workdir.jsonl"), HISTORY_LINE);

    const { migrated, skipped, results } = v6HistorySlugs.run();

    expect({ migrated, skipped }).toEqual({ migrated: 0, skipped: 1 });
    expect(results[0]).toStartWith("workdir: skipped (");
    expect(existsSync(parkedHistory("workdir.jsonl"))).toBe(true);
  });
});
