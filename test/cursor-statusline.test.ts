import { describe, expect, test } from "bun:test";
import { addStatuslineConfig, removeStatuslineConfig } from "../src/targets/lib";

const cursorStatuslineCommand =
  process.platform === "win32"
    ? "powershell -NoProfile -File ~/.cursor/statusline.ps1"
    : "~/.cursor/statusline.sh";

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

const onWindows = process.platform === "win32";

describe("claude statusline config", () => {
  test("addStatuslineConfig refreshes old Get-Content claude command", () => {
    const config = {
      statusLine: {
        type: "command",
        command:
          'powershell -NoProfile -Command "Get-Content -Raw ~/.claude/statusline.ps1"',
      },
    };
    const updated = addStatuslineConfig(config, "claude") as {
      statusLine: { command: string };
    };
    expect(updated.statusLine.command).not.toContain("Get-Content -Raw");
  });

  test.if(onWindows)(
    "addStatuslineConfig upgrades PAL command missing -ExecutionPolicy Bypass",
    () => {
      const config = {
        statusLine: {
          type: "command",
          command: "powershell -NoProfile -File ~/.claude/statusline.ps1",
        },
      };
      const updated = addStatuslineConfig(config, "claude") as {
        statusLine: { command: string };
      };
      expect(updated.statusLine.command).toBe(
        "powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/statusline.ps1"
      );
    }
  );

  test.if(onWindows)(
    "addStatuslineConfig preserves a command that already has Bypass",
    () => {
      const config = {
        statusLine: {
          type: "command",
          command:
            "powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/statusline.ps1",
        },
      };
      expect(addStatuslineConfig(config, "claude")).toBe(config);
    }
  );
});
