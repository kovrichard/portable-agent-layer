import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { archivePathIn } from "../src/bronze/bronze";
import { archiveLayoutFor as layoutFor } from "../src/cli/archive-layout";
import { collectExportFiles } from "../src/core/export";
import {
  buildManifest,
  DATA_LAYOUT,
  newerLayoutRefusal,
} from "../src/core/export-manifest";
import { mergeArchive } from "../src/core/import-merge";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
let QUARANTINE: string;

const entry = (path: string, text: string) => ({ path, data: () => Buffer.from(text) });

beforeEach(() => {
  const dir = freshTestDir(import.meta.file);
  HOME = resolve(dir, "home");
  QUARANTINE = resolve(dir, "quarantine");
  process.env.PAL_HOME = HOME;
});

describe("the archive's data layout", () => {
  test("a new export says which layout its paths follow", () => {
    expect(buildManifest({ id: "m", label: "m", os: "linux" }, 0).layout).toBe(
      DATA_LAYOUT
    );
  });

  test("an archive from this layout or an older one imports", () => {
    expect(newerLayoutRefusal({ layout: DATA_LAYOUT })).toBeNull();
    expect(newerLayoutRefusal({ layout: 1 })).toBeNull();
    expect(newerLayoutRefusal(null)).toBeNull();
  });

  test("an archive from a newer layout is refused with what to do", () => {
    expect(newerLayoutRefusal({ layout: DATA_LAYOUT + 1 })).toContain("pal cli update");
  });
});

describe("importing raw transcripts from either layout", () => {
  test("an old-layout raw path is refused like a new one, before or after the move", () => {
    const archive = [
      entry("memory/content/claude/-p/s.jsonl.gz", "old"),
      entry("records/raw/claude/-p/t.jsonl.gz", "new"),
    ];
    expect(mergeArchive(archive, HOME, QUARANTINE, layoutFor(HOME)).skipped).toEqual([
      "records/raw/claude/-p/s.jsonl.gz",
      "records/raw/claude/-p/t.jsonl.gz",
    ]);
    mkdirSync(resolve(HOME, "memory", "content", "claude"), { recursive: true });
    expect(mergeArchive(archive, HOME, QUARANTINE, layoutFor(HOME)).skipped).toHaveLength(
      2
    );
    expect(existsSync(resolve(HOME, "records"))).toBe(false);
  });
});

describe("archivePathIn", () => {
  test("a moved store's path lands in its former folder until this machine runs the move", () => {
    mkdirSync(resolve(HOME, "memory", "content", "claude"), { recursive: true });
    expect(archivePathIn("records/raw/claude/-p/s.gz", HOME)).toBe(
      "memory/content/claude/-p/s.gz"
    );
    mkdirSync(resolve(HOME, "records", "raw", "claude"), { recursive: true });
    expect(archivePathIn("memory/content/claude/-p/s.gz", HOME)).toBe(
      "records/raw/claude/-p/s.gz"
    );
  });

  test("a path no move touches is kept as it is", () => {
    expect(archivePathIn("memory/signals/ratings.jsonl", HOME)).toBe(
      "memory/signals/ratings.jsonl"
    );
  });
});

describe("the settings file across layouts", () => {
  const settingsIn = (...parts: string[]) =>
    readFileSync(resolve(HOME, ...parts), "utf-8");

  test("an old archive's memory/pal-settings.json lands at the root of a moved home", () => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(resolve(HOME, "settings.json"), "{}");
    mergeArchive(
      [entry("memory/pal-settings.json", '{"a":1}')],
      HOME,
      QUARANTINE,
      layoutFor(HOME)
    );
    expect(existsSync(resolve(HOME, "memory", "pal-settings.json"))).toBe(false);
    expect(existsSync(resolve(QUARANTINE, "settings.json"))).toBe(true);
  });

  test("a new archive's settings.json lands in memory/ while this home has not moved", () => {
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    writeFileSync(resolve(HOME, "memory", "pal-settings.json"), '{"a":1}');
    mergeArchive([entry("settings.json", '{"a":1}')], HOME, QUARANTINE, layoutFor(HOME));
    expect(existsSync(resolve(HOME, "settings.json"))).toBe(false);
    expect(settingsIn("memory", "pal-settings.json")).toBe('{"a":1}');
  });

  test("an export carries the settings file from the PAL home's root", () => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(resolve(HOME, "settings.json"), "{}");
    expect(collectExportFiles()).toContain("settings.json");
  });
});

describe("a merge without a layout", () => {
  test("writes every path where the archive names it", () => {
    mergeArchive([entry("telos/GOALS.md", "# Goals\n")], HOME, QUARANTINE);
    expect(readFileSync(resolve(HOME, "telos", "GOALS.md"), "utf-8")).toBe("# Goals\n");
  });
});
