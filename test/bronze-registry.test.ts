import { beforeEach, describe, expect, test } from "bun:test";
import {
  bronzeStores,
  type RecordedStore,
  rawStores,
  type StoreGroup,
  type StoreName,
  storeDir,
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
  test("lists 17 stores under unique names", () => {
    const names = everyStore().map((store) => store.name);

    expect(names).toHaveLength(17);
    expect(new Set(names).size).toBe(17);
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

  test("storeDir gives the folder of the store it names", () => {
    const name: StoreName = "progress-tree";

    expect(storeDir(name)).toBe(storeNamed(name).dir());
  });

  test("storeNamed throws on a name no store has", () => {
    expect(() => storeNamed("not-a-store")).toThrow("not-a-store");
  });

  test("every store's folder lies inside the PAL home", () => {
    for (const store of everyStore()) {
      expect({ name: store.name, inside: isInside(HOME, store.dir()) }).toEqual({
        name: store.name,
        inside: true,
      });
    }
  });

  test("the bronze stores are the event log and its text", () => {
    expect(bronzeStores().map((store) => store.name)).toEqual(["events", "event-text"]);
  });

  test("only the ledger and ratings outside bronze are mirrored into the event log", () => {
    const mirrored = storesOutsideBronze()
      .filter((store) => store.alsoInEventLog)
      .map((store) => store.name);

    expect(mirrored).toEqual(["ledger", "ratings"]);
  });
});
