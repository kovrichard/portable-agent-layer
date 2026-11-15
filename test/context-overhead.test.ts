import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/core/settings";
import { buildClaudeMd } from "../src/hooks/lib/claude-md";
import { logContextInjected } from "../src/hooks/lib/context-overhead";
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

function storedText(): Record<string, unknown>[] {
  const file = resolve(home, "memory", "content", "events", "2026-09.jsonl");
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((row) => row.type === "context_injected");
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
    writeMemory(["relationship", "opinions-context.md"], "  model  \n");
    mkdirSync(resolve(home, "docs"), { recursive: true });
    writeFileSync(resolve(home, "docs", "STEERING_RULES.md"), "lessons");
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

  test("stores the text of each tier under the event's id and time", () => {
    writeMemory(["relationship", "opinions-context.md"], "  model  \n");
    mkdirSync(resolve(home, "docs"), { recursive: true });
    writeFileSync(resolve(home, "docs", "STEERING_RULES.md"), "lessons");
    logContextInjected({ session_id: "s1" }, "the reminder", NOW);
    const [event] = injected();

    expect(storedText()).toEqual([
      {
        id: event?.id,
        ts: NOW.toISOString(),
        type: "context_injected",
        instructions: buildClaudeMd(),
        semiStatic: [
          { path: "memory/relationship/opinions-context.md", text: "model" },
          { path: "docs/STEERING_RULES.md", text: "lessons" },
        ],
        dynamic: "the reminder",
      },
    ]);
  });

  test("each size field equals the length of the text stored for it", () => {
    writeMemory(["relationship", "opinions-context.md"], "opinions here");
    logContextInjected(null, "dynamic part", NOW);
    const [row] = storedText();
    const semiStatic = row?.semiStatic as { text: string }[];

    expect(injected()[0]).toMatchObject({
      instructionsChars: String(row?.instructions).length,
      semiStaticChars: semiStatic.reduce((sum, file) => sum + file.text.length, 0),
      dynamicChars: String(row?.dynamic).length,
    });
    expect(injected()[0]?.semiStaticChars).toBe("opinions here".length);
  });

  test("a source that cannot be read is stored as an empty text", () => {
    mkdirSync(resolve(home, "docs", "STEERING_RULES.md"), { recursive: true });
    logContextInjected(null, "", NOW);

    expect(storedText()[0]?.semiStatic).toEqual([
      { path: "memory/relationship/opinions-context.md", text: "" },
      { path: "docs/STEERING_RULES.md", text: "" },
    ]);
  });

  test("a log that cannot be written never blocks the hook", () => {
    writeFileSync(resolve(home, "memory", "events"), "not a directory");
    expect(() => logContextInjected(null, "reminder", NOW)).not.toThrow();
  });
});
