import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  claudeHooksInVscode,
  enableCopilotInstructions,
} from "../src/targets/vscode-settings";

const ROOT = resolve(tmpdir(), `pal-vscode-settings-${process.pid}`);
const USER_DIR = resolve(ROOT, "Code", "User");
const SETTINGS = resolve(USER_DIR, "settings.json");
const ENABLED = { "~/.copilot/instructions": true };

beforeEach(() => mkdirSync(USER_DIR, { recursive: true }));
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

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
    rmSync(USER_DIR, { recursive: true, force: true });

    expect(enableCopilotInstructions(SETTINGS)).toBe("vscode-never-launched");
    expect(existsSync(SETTINGS)).toBe(false);
  });
});

describe("whether VS Code runs the hooks PAL registers for Claude", () => {
  test("it does when chat.useClaudeHooks is on, comments and all", () => {
    writeFileSync(SETTINGS, '{\n  // hooks\n  "chat.useClaudeHooks": true,\n}\n');
    expect(claudeHooksInVscode(SETTINGS)).toBe("on");
  });

  test("it does not when the setting is missing, since VS Code defaults it to off", () => {
    writeFileSync(SETTINGS, JSON.stringify({ "editor.fontSize": 14 }));
    expect(claudeHooksInVscode(SETTINGS)).toBe("off");
  });

  test("it does not when the setting is turned off", () => {
    writeFileSync(SETTINGS, JSON.stringify({ "chat.useClaudeHooks": false }));
    expect(claudeHooksInVscode(SETTINGS)).toBe("off");
  });

  test("it does not when VS Code was launched but never saved a setting", () => {
    expect(claudeHooksInVscode(SETTINGS)).toBe("off");
  });

  test("there is nothing to say when VS Code was never launched", () => {
    rmSync(USER_DIR, { recursive: true });
    expect(claudeHooksInVscode(SETTINGS)).toBe("vscode-never-launched");
  });
});
