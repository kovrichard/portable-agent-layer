import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LEFTOVERS } from "../src/cli/leftovers";
import { linkFile } from "./lib/links";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

let DIR: string;
const saved = { ...process.env };
const at = (...parts: string[]) => resolve(DIR, ...parts);

beforeEach(() => {
  DIR = freshTestDir(import.meta.file);
  process.env.PAL_HOME = at("home");
  process.env.PAL_CLAUDE_DIR = at(".claude");
  process.env.PAL_OPENCODE_DIR = at(".opencode");
  process.env.PAL_COPILOT_DIR = at(".copilot");
});

afterEach(() => {
  for (const key of [
    "PAL_HOME",
    "PAL_CLAUDE_DIR",
    "PAL_OPENCODE_DIR",
    "PAL_COPILOT_DIR",
  ]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  removeOnceReleased(DIR);
});

function write(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

const json = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

function leftover(id: string) {
  const found = LEFTOVERS.find((l) => l.id === id);
  if (!found) throw new Error(`no leftover ${id}`);
  return found;
}

function cleanUp(id: string): string[] {
  const l = leftover(id);
  const found = l.find();
  if (found.length > 0) l.remove();
  expect(l.find()).toEqual([]);
  return found;
}

describe("Claude Code Grep()/Glob() rules", () => {
  test("removes path-scoped rules and keeps bare tool rules and the rest", () => {
    write(at(".claude", "settings.json"), {
      permissions: {
        allow: ["Read(//*)", "Grep(//*)", "Glob(//*)", "Grep", "Glob", "WebFetch"],
      },
      model: "keep",
    });

    expect(cleanUp("claude-file-tool-rules")).toEqual(["Grep(//*)", "Glob(//*)"]);
    expect(json(at(".claude", "settings.json"))).toEqual({
      permissions: { allow: ["Read(//*)", "Grep", "Glob", "WebFetch"] },
      model: "keep",
    });
  });

  test("nothing to do without Claude Code settings", () => {
    expect(leftover("claude-file-tool-rules").find()).toEqual([]);
  });
});

describe("PROJECTS.md loaded at startup", () => {
  test("removes it and keeps the other startup files", () => {
    write(at("home", "memory", "pal-settings.json"), {
      loadAtStartup: { files: ["telos/GOALS.md", "memory/PROJECTS.md"] },
    });

    cleanUp("startup-projects-md");

    expect(json(at("home", "memory", "pal-settings.json")).loadAtStartup.files).toEqual([
      "telos/GOALS.md",
    ]);
  });

  test("a malformed settings file is left alone", () => {
    write(at("home", "memory", "pal-settings.json"), "{ not json");

    expect(leftover("startup-projects-md").find()).toEqual([]);
  });
});

describe("opencode plugin under its old name", () => {
  test("removes pai-plugin.ts and keeps pal-plugin.ts", () => {
    write(at(".opencode", "plugins", "pai-plugin.ts"), "old");
    write(at(".opencode", "plugins", "pal-plugin.ts"), "current");

    cleanUp("opencode-pai-plugin");

    expect(existsSync(at(".opencode", "plugins", "pal-plugin.ts"))).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("Copilot instructions link", () => {
  test("removes a link to AGENTS.md", () => {
    write(at("home", "AGENTS.md"), "# agents");
    mkdirSync(at(".copilot"), { recursive: true });
    linkFile(at("home", "AGENTS.md"), at(".copilot", "copilot-instructions.md"));

    cleanUp("copilot-instructions-link");
  });

  test("leaves a copilot-instructions.md the user wrote", () => {
    write(at(".copilot", "copilot-instructions.md"), "my own instructions");

    expect(leftover("copilot-instructions-link").find()).toEqual([]);
  });
});

describe("debug.log.prev", () => {
  test("becomes debug.log.1 when that slot is free", () => {
    write(at("home", "debug", "debug.log.prev"), "old");

    cleanUp("debug-log-prev");

    expect(readFileSync(at("home", "debug", "debug.log.1"), "utf-8")).toBe("old");
  });

  test("is dropped when debug.log.1 already holds newer lines", () => {
    write(at("home", "debug", "debug.log.prev"), "old");
    write(at("home", "debug", "debug.log.1"), "newer");

    cleanUp("debug-log-prev");

    expect(readFileSync(at("home", "debug", "debug.log.1"), "utf-8")).toBe("newer");
  });
});
