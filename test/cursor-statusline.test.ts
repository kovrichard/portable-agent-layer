import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { platform } from "../src/core/paths";
import { addStatuslineConfig, removeStatuslineConfig } from "../src/targets/statusline";

const onWindows = process.platform === "win32";

const windowsCommand = (dir: string, flags: string) =>
  `powershell ${flags} -File "${resolve(dir, "statusline.ps1")}"`;
const claudeWindowsCommand = () =>
  windowsCommand(platform.claudeDir(), "-NoProfile -ExecutionPolicy Bypass");

const cursorStatuslineCommand = onWindows
  ? windowsCommand(platform.cursorDir(), "-NoProfile")
  : "~/.cursor/statusline.sh";

type StatusLine = { statusLine: { command: string } };

describe("cursor statusline config", () => {
  test("addStatuslineConfig sets PAL defaults when absent", () => {
    const updated = addStatuslineConfig({}, "cursor");
    expect(updated.statusLine).toEqual({
      type: "command",
      command: cursorStatuslineCommand,
      padding: 2,
      updateIntervalMs: 300,
      timeoutMs: 2000,
    });
  });

  test("addStatuslineConfig preserves user command", () => {
    const config = {
      statusLine: {
        type: "command",
        command: "jq -r '.model.display_name'",
      },
    };
    expect(addStatuslineConfig(config, "cursor")).toBe(config);
  });

  test("addStatuslineConfig refreshes PAL command", () => {
    const config = {
      statusLine: {
        type: "command",
        command: "~/.cursor/statusline.sh",
        padding: 0,
      },
    };
    const updated = addStatuslineConfig(config, "cursor");
    expect(updated.statusLine).toEqual({
      type: "command",
      command: cursorStatuslineCommand,
      padding: 2,
      updateIntervalMs: 300,
      timeoutMs: 2000,
    });
  });

  test("a PAL command with a Windows absolute path is recognised as PAL's", () => {
    const config = {
      statusLine: {
        type: "command",
        command: 'powershell -NoProfile -File "C:\\Users\\me\\.cursor\\statusline.ps1"',
      },
    };
    expect(removeStatuslineConfig(config, "cursor").statusLine).toBeUndefined();
  });

  test("removeStatuslineConfig removes only PAL command", () => {
    const pal = {
      statusLine: { type: "command", command: "~/.cursor/statusline.sh" },
    };
    expect(removeStatuslineConfig(pal, "cursor").statusLine).toBeUndefined();

    const custom = {
      statusLine: { type: "command", command: "jq -r '.model.display_name'" },
    };
    expect(removeStatuslineConfig(custom, "cursor")).toBe(custom);
  });

  test("removeStatuslineConfig on claude removes unconditionally", () => {
    const config = {
      statusLine: { type: "command", command: "jq -r '.model.display_name'" },
    };
    expect(removeStatuslineConfig(config, "claude").statusLine).toBeUndefined();
  });
});

describe("antigravity statusline config", () => {
  test("addStatuslineConfig points agy at the script in antigravity-cli", () => {
    expect(addStatuslineConfig({}, "antigravity").statusLine).toEqual({
      type: "command",
      command: onWindows
        ? windowsCommand(
            platform.antigravityCliDir(),
            "-NoProfile -ExecutionPolicy Bypass"
          )
        : "~/.gemini/antigravity-cli/statusline.sh",
      padding: 2,
    });
  });

  test("a user's own statusLine is kept on install and on uninstall", () => {
    const config = { statusLine: { type: "command", command: "~/bin/my-line" } };
    expect(addStatuslineConfig(config, "antigravity")).toBe(config);
    expect(removeStatuslineConfig(config, "antigravity").statusLine).toBe(
      config.statusLine
    );
  });

  test("uninstall removes PAL's statusLine", () => {
    const installed = addStatuslineConfig({}, "antigravity");
    expect(removeStatuslineConfig(installed, "antigravity").statusLine).toBeUndefined();
  });
});

describe("claude statusline config", () => {
  test("addStatuslineConfig refreshes old Get-Content claude command", () => {
    const config = {
      statusLine: {
        type: "command",
        command:
          'powershell -NoProfile -Command "Get-Content -Raw ~/.claude/statusline.ps1"',
      },
    };
    const updated = addStatuslineConfig(config, "claude") as StatusLine;
    expect(updated.statusLine.command).not.toContain("Get-Content -Raw");
  });

  test("on Windows a fresh install runs the script by its absolute path", () => {
    const updated = addStatuslineConfig({}, "claude", "win32") as StatusLine;
    expect(updated.statusLine.command).toBe(claudeWindowsCommand());
  });

  test("on Windows a PAL command missing -ExecutionPolicy Bypass is upgraded", () => {
    const config = {
      statusLine: {
        type: "command",
        command: `powershell -NoProfile -File "${resolve(platform.claudeDir(), "statusline.ps1")}"`,
      },
    };
    const updated = addStatuslineConfig(config, "claude", "win32") as StatusLine;
    expect(updated.statusLine.command).toBe(claudeWindowsCommand());
  });

  test("on Windows a PAL command with a tilde path is upgraded", () => {
    const config = {
      statusLine: {
        type: "command",
        command:
          "powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/statusline.ps1",
      },
    };
    const updated = addStatuslineConfig(config, "claude", "win32") as StatusLine;
    expect(updated.statusLine.command).toBe(claudeWindowsCommand());
  });

  test("on Windows the current absolute command is kept", () => {
    const statusLine = {
      type: "command",
      command: claudeWindowsCommand(),
      refreshInterval: 5,
    };
    const updated = addStatuslineConfig({ statusLine }, "claude", "win32");
    expect(updated.statusLine).toBe(statusLine);
  });

  test("on Windows PAL's bash command is kept", () => {
    const statusLine = {
      type: "command",
      command: "~/.claude/statusline.sh",
      refreshInterval: 5,
    };
    const updated = addStatuslineConfig({ statusLine }, "claude", "win32");
    expect(updated.statusLine).toBe(statusLine);
  });

  test("the target defaults to claude", () => {
    const updated = addStatuslineConfig({}) as StatusLine;
    expect(updated.statusLine.command).toContain(".claude");
  });

  test("outside Windows a PowerShell command is left alone", () => {
    const command = "powershell -NoProfile -File ~/.claude/statusline.ps1";
    const config = { statusLine: { type: "command", command, refreshInterval: 5 } };
    const updated = addStatuslineConfig(config, "claude", "linux") as StatusLine;
    expect(updated.statusLine.command).toBe(command);
  });
});
