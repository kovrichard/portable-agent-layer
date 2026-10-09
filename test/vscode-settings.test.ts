import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { enableCopilotInstructions } from "../src/targets/vscode-settings";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const ROOT = testHome(import.meta.file);
const USER_DIR = resolve(ROOT, "Code", "User");
const SETTINGS = resolve(USER_DIR, "settings.json");
const ENABLED = { "~/.copilot/instructions": true };

beforeEach(() => {
  removeOnceReleased(ROOT);
  mkdirSync(USER_DIR, { recursive: true });
});

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(SETTINGS, "utf-8"));
}

describe("enabling ~/.copilot/instructions in VS Code settings", () => {
  test("merges the entry into plain JSON settings, keeping the rest", () => {
    writeFileSync(
      SETTINGS,
      JSON.stringify({
        "editor.fontSize": 14,
        "chat.instructionsFilesLocations": { "~/other": true },
      })
    );

    expect(enableCopilotInstructions(SETTINGS)).toBe("enabled");
    expect(settings()).toEqual({
      "editor.fontSize": 14,
      "chat.instructionsFilesLocations": { "~/other": true, ...ENABLED },
    });
  });

  test("never rewrites settings that carry comments", () => {
    const commented = '{\n  // my font\n  "editor.fontSize": 14,\n}\n';
    writeFileSync(SETTINGS, commented);

    expect(enableCopilotInstructions(SETTINGS)).toBe("needs-manual-edit");
    expect(readFileSync(SETTINGS, "utf-8")).toBe(commented);
  });

  test("leaves commented settings alone when the entry is already there", () => {
    const commented =
      '{\n  // mine\n  "chat.instructionsFilesLocations": { "~/.copilot/instructions": true },\n}\n';
    writeFileSync(SETTINGS, commented);

    expect(enableCopilotInstructions(SETTINGS)).toBe("already-enabled");
    expect(readFileSync(SETTINGS, "utf-8")).toBe(commented);
  });

  test("never rewrites settings it cannot parse", () => {
    writeFileSync(SETTINGS, "{ not json");

    expect(enableCopilotInstructions(SETTINGS)).toBe("needs-manual-edit");
    expect(readFileSync(SETTINGS, "utf-8")).toBe("{ not json");
  });

  test("creates the settings file when VS Code has a profile but no settings yet", () => {
    expect(enableCopilotInstructions(SETTINGS)).toBe("enabled");
    expect(settings()).toEqual({ "chat.instructionsFilesLocations": ENABLED });
  });

  test("skips a VS Code that has never been launched", () => {
    removeOnceReleased(USER_DIR);

    expect(enableCopilotInstructions(SETTINGS)).toBe("vscode-never-launched");
    expect(existsSync(SETTINGS)).toBe(false);
  });
});
