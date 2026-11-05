import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  roleSettingsFrom,
  writeRoleSettings,
} from "../assets/plugins/dark-factory/scripts/settings.mjs";
import { freshTestDir } from "./lib/test-home";

const ATTRIBUTION = { commit: "Co-authored by Jarvis", pr: "Co-authored by [Jarvis]" };

let root: string;
let env: Record<string, string>;

function writeJson(file: string, value: unknown) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function roleSettingsEvent() {
  return readFileSync(join(env.DARK_FACTORY_HOME, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((e) => e.event === "role_settings");
}

beforeEach(() => {
  root = freshTestDir("dark-factory-settings");
  env = { HOME: join(root, "home"), DARK_FACTORY_HOME: join(root, "factory") };
});

describe("roleSettingsFrom", () => {
  test("keeps attribution and other preferences", () => {
    const user = {
      attribution: ATTRIBUTION,
      includeCoAuthoredBy: false,
      autoMemoryEnabled: false,
    };
    expect(roleSettingsFrom(user)).toEqual(user);
  });

  test("drops the user's hooks and every key that breaks an isolated role", () => {
    const settings = roleSettingsFrom({
      attribution: ATTRIBUTION,
      hooks: { Stop: [] },
      permissions: { allow: ["Bash(touch *)"] },
      enabledPlugins: { "x@y": true },
      extraKnownMarketplaces: { y: {} },
    });
    expect(settings).toEqual({ attribution: ATTRIBUTION });
  });

  test("nothing left to pass gives null", () => {
    expect(roleSettingsFrom({ hooks: {} })).toBeNull();
  });
});

describe("writeRoleSettings", () => {
  test("writes the user's attribution to a file the role can load", () => {
    writeJson(join(env.HOME, ".claude/settings.json"), {
      attribution: ATTRIBUTION,
      hooks: { Stop: [] },
    });
    const file = writeRoleSettings({ id: "t1" }, env);
    expect(file).not.toBeNull();
    expect(JSON.parse(readFileSync(file as string, "utf8"))).toEqual({
      attribution: ATTRIBUTION,
    });
  });

  test("CLAUDE_CONFIG_DIR is where the user settings live when set", () => {
    const configDir = join(root, "config");
    writeJson(join(configDir, "settings.json"), { includeCoAuthoredBy: false });
    const file = writeRoleSettings(
      { id: "t1" },
      { ...env, CLAUDE_CONFIG_DIR: configDir }
    );
    expect(JSON.parse(readFileSync(file as string, "utf8"))).toEqual({
      includeCoAuthoredBy: false,
    });
  });

  test("records which keys were passed and which were dropped, never their values", () => {
    writeJson(join(env.HOME, ".claude/settings.json"), {
      attribution: ATTRIBUTION,
      hooks: { Stop: [] },
      permissions: { allow: ["x"] },
    });
    writeRoleSettings({ id: "t1" }, env);
    expect(roleSettingsEvent()).toMatchObject({
      task: "t1",
      passed: ["attribution"],
      dropped: ["hooks", "permissions"],
    });
    expect(JSON.stringify(roleSettingsEvent())).not.toContain("Jarvis");
  });

  test("a missing or broken user settings file writes no file", () => {
    expect(writeRoleSettings({ id: "t1" }, env)).toBeNull();
    mkdirSync(join(env.HOME, ".claude"), { recursive: true });
    writeFileSync(join(env.HOME, ".claude/settings.json"), "{ not json");
    expect(writeRoleSettings({ id: "t1" }, env)).toBeNull();
  });
});
