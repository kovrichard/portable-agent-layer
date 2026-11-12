/**
 * VS Code's settings.json is JSONC. PAL rewrites it only when it parses as
 * strict JSON, because a rewrite would drop the user's comments.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { writeJson } from "./json-file";

const LOCATIONS_KEY = "chat.instructionsFilesLocations";
const COPILOT_INSTRUCTIONS = "~/.copilot/instructions";

type Settings = Record<string, unknown>;

type InstructionsOutcome =
  | "enabled"
  | "already-enabled"
  | "needs-manual-edit"
  | "vscode-never-launched";

function parsed(raw: string, parse: (text: string) => unknown): Settings | null {
  try {
    const value = parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Settings)
      : null;
  } catch {
    return null;
  }
}

function locationsOf(settings: Settings): Settings {
  const locations = settings[LOCATIONS_KEY];
  return typeof locations === "object" && locations !== null
    ? (locations as Settings)
    : {};
}

function writeEnabled(settingsPath: string, settings: Settings): InstructionsOutcome {
  writeJson(settingsPath, {
    ...settings,
    [LOCATIONS_KEY]: { ...locationsOf(settings), [COPILOT_INSTRUCTIONS]: true },
  });
  return "enabled";
}

export function enableCopilotInstructions(settingsPath: string): InstructionsOutcome {
  if (!existsSync(dirname(settingsPath))) return "vscode-never-launched";
  if (!existsSync(settingsPath)) return writeEnabled(settingsPath, {});
  const raw = readFileSync(settingsPath, "utf-8");
  const settings = parsed(raw, Bun.JSONC.parse);
  if (settings && locationsOf(settings)[COPILOT_INSTRUCTIONS] === true)
    return "already-enabled";
  const strict = parsed(raw, JSON.parse);
  return strict ? writeEnabled(settingsPath, strict) : "needs-manual-edit";
}

/** Resolve the VS Code user settings.json path cross-platform. Returns null on unknown platforms. */
export function vscodeSettingsFile(): string | null {
  const h = homedir();
  if (process.platform === "darwin") {
    return resolve(h, "Library", "Application Support", "Code", "User", "settings.json");
  }
  if (process.platform === "linux") {
    return resolve(
      process.env.XDG_CONFIG_HOME ?? resolve(h, ".config"),
      "Code",
      "User",
      "settings.json"
    );
  }
  if (process.platform === "win32") {
    return resolve(
      process.env.APPDATA ?? resolve(h, "AppData", "Roaming"),
      "Code",
      "User",
      "settings.json"
    );
  }
  return null;
}
