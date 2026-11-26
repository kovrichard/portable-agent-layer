import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LEFTOVERS } from "../src/cli/leftovers";
import { turnsSince } from "../src/opinions/interaction";
import { backfillTurns } from "../src/tools/lib/backfill/turns";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const at = (path: string) => resolve(HOME, path);

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
});

function write(path: string, content: string): void {
  mkdirSync(dirname(at(path)), { recursive: true });
  writeFileSync(at(path), content);
}

const retired = () => {
  const found = LEFTOVERS.find((l) => l.id === "retired-learned-stores");
  if (!found) throw new Error("no retired-learned-stores leftover");

  return found;
};

const OLD_TURNS = "memory/signals/interaction/2026-10.jsonl";
const oldTurn = `${JSON.stringify({ ts: "2026-10-12T10:00:00.000Z", session: "s1", channel: null, chars: 5 })}\n`;

describe("learned stores no PAL reads any more", () => {
  test.each([
    "memory/relationship/2026-09/2026-09-01.md",
    "memory/relationship/reflections/2026-09-01_weekly-reflection.md",
    "memory/self-model/current.md",
    "memory/learning/session/2026/10/note.md",
    "memory/learning/failures-digest.md",
    "memory/learning/.retrieval-index.json",
  ])("removes %s", (path) => {
    write(path, "x");

    retired().remove();

    expect(existsSync(at(path))).toBe(false);
  });

  test("keeps the opinions, the failures and wisdom's notes", () => {
    const kept = [
      "memory/relationship/opinions.json",
      "memory/relationship/opinions-context.md",
      "memory/learning/failures/2026/10/f.md",
      "memory/wisdom/frames/workflow.md",
    ];

    for (const path of kept) write(path, "x");

    retired().remove();

    expect(kept.filter((path) => !existsSync(at(path)))).toEqual([]);
  });

  test("keeps the old turns while the event log lacks one of them", () => {
    write(OLD_TURNS, oldTurn);

    expect(retired().find()).toEqual([]);
  });

  test("removes the old turns once the event log holds every one, and still reads them", () => {
    write(OLD_TURNS, oldTurn);
    backfillTurns(new Set());

    retired().remove();

    expect(existsSync(at("memory/signals/interaction"))).toBe(false);
    expect(turnsSince(new Date(0)).map((turn) => turn.session)).toEqual(["s1"]);
  });
});
