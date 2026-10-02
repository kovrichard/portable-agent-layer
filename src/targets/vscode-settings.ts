/**
 * VS Code's settings.json is JSONC. PAL rewrites it only when it parses as
 * strict JSON, because a rewrite would drop the user's comments.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeJson } from "./lib";

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

/** VS Code runs the hooks in ~/.claude/settings.json only behind this setting, which defaults to off. */
export function claudeHooksInVscode(
  settingsPath: string
): "on" | "off" | "vscode-never-launched" {
  if (!existsSync(dirname(settingsPath))) return "vscode-never-launched";
  if (!existsSync(settingsPath)) return "off";
  const settings = parsed(readFileSync(settingsPath, "utf-8"), Bun.JSONC.parse);
  return settings?.["chat.useClaudeHooks"] === true ? "on" : "off";
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
