import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dir, "..", "src");

const HAND_BUILT_MEMORY_PATH = /paths\.memory\(\)|["']memory["']\s*[,)]/g;

const WHERE_PATHS_ARE_DEFINED = ["core/paths.ts", "bronze/bronze.ts"];

const isFrozenMigration = (file: string) => file.startsWith("cli/migrations/");

/**
 * Files that still build a path under memory/ themselves, with how many times.
 * Moving a store to another folder misses these, so the list may only shrink:
 * a new path goes through `paths` or the store registry instead.
 */
const KNOWN_TODAY: Record<string, number> = {
  "cli/index.ts": 2,
  "cli/leftovers.ts": 3,
  "cli/legacy-opinions.ts": 2,
  "context/semi-static.ts": 1,
  "core/actor.ts": 2,
  "core/export.ts": 1,
  "core/log.ts": 1,
  "core/machine.ts": 1,
  "core/settings.ts": 1,
  "progress/parked-history.ts": 1,
  "progress/scheduled-prompts.ts": 1,
  "tools/lib/backfill/promises.ts": 1,
};

function handBuiltMemoryPaths(): Record<string, number> {
  const found: Record<string, number> = {};

  for (const file of readdirSync(SRC, { recursive: true }).map(String)) {
    const name = file.replaceAll("\\", "/");
    const skipped =
      !name.endsWith(".ts") ||
      WHERE_PATHS_ARE_DEFINED.includes(name) ||
      isFrozenMigration(name);

    if (skipped) continue;
    const count = readFileSync(resolve(SRC, file), "utf-8").match(
      HAND_BUILT_MEMORY_PATH
    )?.length;

    if (count) found[name] = count;
  }

  return found;
}

describe("paths under memory/", () => {
  test("no file builds more of them by hand than it did when the list was pinned", () => {
    const grown = Object.entries(handBuiltMemoryPaths())
      .filter(([file, count]) => count > (KNOWN_TODAY[file] ?? 0))
      .map(([file, count]) => `${file}: ${count}`);

    expect(grown).toEqual([]);
  });
});
