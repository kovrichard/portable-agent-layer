import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  bronzeStores,
  type RecordedStore,
  rawStores,
  type StoreGroup,
  type StoreName,
  storeDir,
  storeLocation,
  storeNamed,
  storesOutsideBronze,
} from "../src/bronze/bronze";
import { isInside } from "../src/core/paths";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

const everyStore = (): RecordedStore[] => [
  ...rawStores(),
  ...bronzeStores(),
  ...storesOutsideBronze(),
];

const groupOf = (stores: RecordedStore[]): StoreGroup[] => [
  ...new Set(stores.map((store) => store.group)),
];

describe("the store registry", () => {
  test("lists 21 stores under unique names", () => {
    const names = everyStore().map((store) => store.name);

    expect(names).toHaveLength(21);
    expect(new Set(names).size).toBe(21);
  });

  test("each group function returns only its own group", () => {
    expect(groupOf(rawStores())).toEqual(["raw"]);
    expect(groupOf(bronzeStores())).toEqual(["bronze"]);
    expect(groupOf(storesOutsideBronze())).toEqual(["outside"]);
  });

  test("storeNamed returns each store by its name", () => {
    for (const store of everyStore()) {
      expect(storeNamed(store.name)).toBe(store);
    }
  });

  test("storeDir gives the store's location under the PAL home and creates it", () => {
    const name: StoreName = "progress-tree";
    const dir = storeDir(name);

    expect(dir).toBe(resolve(HOME, "work", "progress-tree"));
    expect(existsSync(dir)).toBe(true);
  });

  test("storeLocation gives the same folder without creating it", () => {
    const location = storeLocation("transcripts");

    expect(location).toBe(resolve(HOME, "records", "raw", "claude"));
    expect(existsSync(location)).toBe(false);
  });

  test("storeDir resolves the same location under another home", () => {
    const other = resolve(HOME, "other-home");

    expect(storeDir("import-log", other)).toBe(resolve(other, "records", "import-log"));
  });

  test("every location is relative to a data folder, with forward slashes", () => {
    const underADataFolder = /^(memory|records|work|state)(\/[a-z-]+)+$/;

    for (const store of everyStore()) {
      expect({ name: store.name, location: store.location }).toEqual({
        name: store.name,
        location: expect.stringMatching(underADataFolder),
      });

      if (store.formerLocation)
        expect(store.formerLocation).toMatch(/^memory(\/[a-z-]+)*$/);
    }
  });

  test("storeNamed throws on a name no store has", () => {
    expect(() => storeNamed("not-a-store")).toThrow("not-a-store");
  });

  test("every store's folder lies inside the PAL home", () => {
    for (const store of everyStore()) {
      expect({ name: store.name, inside: isInside(HOME, storeDir(store.name)) }).toEqual({
        name: store.name,
        inside: true,
      });
    }
  });

  test("the bronze stores are the event log, its text and the tool output", () => {
    expect(bronzeStores().map((store) => store.name)).toEqual([
      "events",
      "event-text",
      "tool-output",
    ]);
  });

  test("the tool output is an append-only monthly bronze store mirrored in the event log", () => {
    expect(storeNamed("tool-output")).toMatchObject({
      name: "tool-output",
      group: "bronze",
      files: "<YYYY-MM>.jsonl",
      appendOnly: true,
      alsoInEventLog: true,
    });
  });

  test("only the ledger and ratings outside bronze are mirrored into the event log", () => {
    const mirrored = storesOutsideBronze()
      .filter((store) => store.alsoInEventLog)
      .map((store) => store.name);

    expect(mirrored).toEqual(["ledger", "ratings"]);
  });
});
