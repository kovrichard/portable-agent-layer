import { describe, expect, test } from "bun:test";
import { poCommand } from "../assets/plugins/dark-factory/scripts/task.mjs";

describe("poCommand", () => {
  test("without a settings file the command starts claude in the worktree with the plugin", () => {
    expect(
      poCommand({ id: "t1", worktree: "/w/t1", settingsFile: null, pluginDir: "/p" })
    ).toBe(
      'cd /w/t1 && claude --setting-sources local --plugin-dir /p "/dark-factory:build-with-agents t1"'
    );
  });

  test("with a settings file the command passes it as --settings", () => {
    expect(
      poCommand({
        id: "t1",
        worktree: "/w/t1",
        settingsFile: "/h/tasks/t1/role-settings.json",
        pluginDir: "/p",
      })
    ).toBe(
      'cd /w/t1 && claude --setting-sources local --settings /h/tasks/t1/role-settings.json --plugin-dir /p "/dark-factory:build-with-agents t1"'
    );
  });

  test("a worktree and plugin folder with spaces are quoted", () => {
    expect(
      poCommand({
        id: "t2",
        worktree: "/my dir/t2",
        settingsFile: null,
        pluginDir: "/p d",
      })
    ).toBe(
      'cd "/my dir/t2" && claude --setting-sources local --plugin-dir "/p d" "/dark-factory:build-with-agents t2"'
    );
  });

  test("an undefined settings file gives the same command as null", () => {
    expect(
      poCommand({ id: "t1", worktree: "/w/t1", settingsFile: undefined, pluginDir: "/p" })
    ).toBe(
      'cd /w/t1 && claude --setting-sources local --plugin-dir /p "/dark-factory:build-with-agents t1"'
    );
  });
});
