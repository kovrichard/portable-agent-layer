import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { recordAdoptedActor } from "../src/bronze/actor-adoption";
import { eventsSince } from "../src/bronze/events";
import { actorDisplayName, readActorRegistry } from "../src/core/actor";
import { mergeArchive, summarize } from "../src/core/import-merge";
import { freshTestDir } from "./lib/test-home";

const ACTOR = "memory/actor.json";
const actorJson = (id: string, label: string) =>
  `${JSON.stringify({ id, label, createdAt: "2026-11-01T00:00:00.000Z" }, null, 2)}\n`;
const MINE = actorJson("bbbb2222-0000-0000-0000-000000000000", "laptop me");
const THEIRS = actorJson("aaaa1111-0000-0000-0000-000000000000", "Rico");

let HOME: string;
let QUARANTINE: string;

beforeEach(async () => {
  HOME = freshTestDir(import.meta.file);
  QUARANTINE = resolve(HOME, "backups", "incoming");
  process.env.PAL_HOME = HOME;
  (await import("../src/core/settings")).reload();
  mkdirSync(dirname(resolve(HOME, ACTOR)), { recursive: true });
  writeFileSync(resolve(HOME, ACTOR), MINE);
});

function importActor(body: string) {
  const result = mergeArchive(
    [{ path: ACTOR, data: () => Buffer.from(body) }],
    HOME,
    QUARANTINE
  );
  if (result.replacedActor) recordAdoptedActor(result.replacedActor, HOME);

  return result;
}

describe("import meeting another install's actor", () => {
  test("adopts it and keeps the local file in quarantine", () => {
    const result = importActor(THEIRS);

    expect(result.replacedActor).toBe(MINE);
    expect(result.conflicts).toEqual([]);
    expect(readFileSync(resolve(HOME, ACTOR), "utf-8")).toBe(THEIRS);
    expect(readFileSync(resolve(QUARANTINE, `${ACTOR}.local`), "utf-8")).toBe(MINE);
    expect(summarize(result)).toContain("adopted the incoming actor");
  });

  test("keeps the old id as an alias that names the adopted person", () => {
    importActor(THEIRS);
    const registry = readActorRegistry();

    expect(registry).toContainEqual({
      id: "bbbb2222-0000-0000-0000-000000000000",
      label: "laptop me",
      aliasOf: "aaaa1111-0000-0000-0000-000000000000",
    });
    expect(actorDisplayName("bbbb2222-0000-0000-0000-000000000000", registry)).toBe(
      "Rico"
    );
  });

  test("logs the switch in bronze", () => {
    importActor(THEIRS);

    expect(eventsSince("actor_adopted", new Date(0)).map((e) => [e.from, e.to])).toEqual([
      ["bbbb2222-0000-0000-0000-000000000000", "aaaa1111-0000-0000-0000-000000000000"],
    ]);
  });

  test("the same actor with another label stays a conflict, local kept", () => {
    const result = importActor(
      actorJson("bbbb2222-0000-0000-0000-000000000000", "renamed")
    );

    expect(result.replacedActor).toBeNull();
    expect(result.conflicts).toEqual([ACTOR]);
    expect(readFileSync(resolve(HOME, ACTOR), "utf-8")).toBe(MINE);
    expect(eventsSince("actor_adopted", new Date(0))).toEqual([]);
  });
});

describe("an alias in the registry", () => {
  test("does not make its person's label look shared", () => {
    const registry = [
      { id: "aaaa1111-0000-0000-0000-000000000000", label: "Rico" },
      {
        id: "bbbb2222-0000-0000-0000-000000000000",
        label: "Rico",
        aliasOf: "aaaa1111-0000-0000-0000-000000000000",
      },
    ];

    expect(actorDisplayName("aaaa1111-0000-0000-0000-000000000000", registry)).toBe(
      "Rico"
    );
  });
});
