import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClaudeMd } from "../src/hooks/lib/claude-md";
import { logContextInjected } from "../src/hooks/lib/context-overhead";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

let home: string;
const NOW = new Date("2026-09-10T10:00:00.000Z");

function injected(): Record<string, unknown>[] {
  const file = resolve(home, "memory", "events", "2026-09.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "context_injected");
}

function writeMemory(path: string[], content: string) {
  mkdirSync(resolve(home, "memory", ...path.slice(0, -1)), { recursive: true });
  writeFileSync(resolve(home, "memory", ...path), content);
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("logContextInjected", () => {
  test("logs each tier's size in chars against the session", () => {
    writeMemory(["self-model", "current.md"], "  model  \n");
    writeMemory(["learning", "failures-digest.md"], "lessons");
    logContextInjected({ session_id: "s1" }, "reminder", NOW);
    expect(injected()).toMatchObject([
      {
        ts: NOW.toISOString(),
        session: "s1",
        instructionsChars: buildClaudeMd().length,
        semiStaticChars: "model".length + "lessons".length,
        dynamicChars: "reminder".length,
      },
    ]);
  });

  test("absent semi-static files count as nothing injected", () => {
    logContextInjected(null, "", NOW);
    expect(injected()).toMatchObject([
      { session: null, semiStaticChars: 0, dynamicChars: 0 },
    ]);
  });

  test("a log that cannot be written never blocks the hook", () => {
    writeFileSync(resolve(home, "memory", "events"), "not a directory");
    expect(() => logContextInjected(null, "reminder", NOW)).not.toThrow();
  });
});
